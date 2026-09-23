/**
 * 远程提取 Worker — 节点侧（另一台电脑的绿角犀 App）
 *
 * 职责：
 *   1. 生成机器 fingerprint（mac+hostname hash）
 *   2. POST /remote-fetch/instances/bind 注册 → 拿 token
 *   3. 30s POST /instances/:id/heartbeat 续期
 *   4. 10s GET /fetch-jobs/pending 拉待处理任务
 *   5. 用户确认 → POST /confirm（decision=accept/reject）
 *   6. accept 后 → 本地扫描 zone.sourcePath → POST /api/v1/assets/sync 批量上传
 *   7. POST /fetch-jobs/:id/execute 收尾
 *
 * 配置优先级（从上到下）：
 *   环境变量 CENTRAL_BACKEND_URL / CENTRAL_JWT
 *   本地 ~/.aie-remote-worker.json
 *   默认本机 127.0.0.1:3001（开发/同机模式）
 *
 * 运行：在 Electron 主进程 require() 启动，或 standalone `node remote-fetch-worker.cjs`
 */

const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

// ===================== 配置 =====================

const CONFIG = {
  centralUrl: process.env.CENTRAL_BACKEND_URL || 'http://127.0.0.1:3001',
  localBackend: process.env.LOCAL_BACKEND_URL || 'http://127.0.0.1:3001',
  localJwt: process.env.WORKER_LOCAL_JWT || '',
  instanceToken: null,
  instanceId: null,
  machineName: os.hostname(),
  pollInterval: 10000,   // 拉任务间隔
  heartbeatInterval: 30000,
  maxFileSize: 7 * 1024 * 1024,  // 7MB (base64 后 ~9.3MB + JSON 包装 <11mb body limit)
  maxFilesPerJob: 500,
  maxDepth: 8,
  skipDirs: new Set(['node_modules', '.git', 'AppData', '$RECYCLE.BIN', 'System Volume Information', '.cache', '.Trash-1000']),
  skipExt: ['.html', '.htm', '.svg', '.js', '.mjs', '.vbs', '.xht'],  // 与后端 DANGEROUS_EXT 一致
  tokenPath: null,
};

const processing = new Set();  // 正在处理的 Job ID（防重入）

// 持久化路径
try {
  const userData = process.env.APPDATA ? path.join(process.env.APPDATA, 'aie-desktop') : path.join(os.homedir(), '.aie');
  CONFIG.tokenPath = path.join(userData, 'remote-worker-token.json');
} catch {
  CONFIG.tokenPath = path.join(os.homedir(), '.aie-remote-worker.json');
}

// ===================== 工具 =====================

function log(level, msg) {
  const ts = new Date().toISOString().substring(11, 19);
  console.log(`[WF ${ts}] [${level}] ${msg}`);
}

function genFingerprint() {
  // mac 地址（取第一个非空网卡）+ hostname + cpu 架构
  const nets = os.networkInterfaces();
  let mac = '';
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        mac = iface.mac; break;
      }
    }
    if (mac) break;
  }
  const raw = `${mac}|${os.hostname()}|${os.arch()}|${os.platform()}`;
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 24);
}

function readTokenFile() {
  try {
    if (fs.existsSync(CONFIG.tokenPath)) {
      return JSON.parse(fs.readFileSync(CONFIG.tokenPath, 'utf8'));
    }
  } catch {}
  return null;
}

function writeTokenFile(data) {
  try {
    fs.mkdirSync(path.dirname(CONFIG.tokenPath), { recursive: true });
    fs.writeFileSync(CONFIG.tokenPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    log('warn', `写 token 文件失败: ${e.message}`);
  }
}

function httpFetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({
      method: opts.method || 'GET',
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
      timeout: opts.timeout || 8000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const json = body ? JSON.parse(body) : {};
          if (res.statusCode >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${json.error || body.substring(0, 200)}`));
          } else {
            resolve(json);
          }
        } catch {
          resolve({ raw: body, status: res.statusCode });
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body));
    req.end();
  });
}

async function api(method, path, body, token = CONFIG.instanceToken, tokenType = 'instance') {
  // tokenType: 'instance' → x-instance-token header; 'jwt' → Authorization: Bearer
  const headers = {};
  if (token) {
    if (tokenType === 'instance') {
      headers['x-instance-token'] = token;
    } else {
      headers['Authorization'] = 'Bearer ' + token;
    }
  }
  if (body) headers['Content-Type'] = 'application/json';
  return httpFetch(CONFIG.centralUrl + path, { method, headers, body, timeout: 15000 });
}

// ===================== 绑定 =====================

async function bind() {
  const fp = genFingerprint();
  log('info', `尝试绑定 fingerprint=${fp} name=${CONFIG.machineName}`);
  try {
      const r = await httpFetch(CONFIG.centralUrl + '/api/v1/remote-fetch/instances/bind', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + (CONFIG.localJwt || ''),
    },
    body: JSON.stringify({ name: CONFIG.machineName, fingerprint: fp }),
  });
    if (r.data && r.data.token) {
      CONFIG.instanceToken = r.data.token;
      CONFIG.instanceId = r.data.id;
      writeTokenFile({ instanceId: r.data.id, fingerprint: fp, token: r.data.token, boundAt: Date.now() });
      log('ok', `绑定成功 instanceId=${r.data.id}`);
      return true;
    }
    log('error', `绑定响应无 token: ${JSON.stringify(r).substring(0, 200)}`);
    return false;
  } catch (e) {
    log('warn', `绑定失败（可能需要登录获取 JWT）: ${e.message}`);
    log('info', `提示：设置 WORKER_LOCAL_JWT 或 CENTRAL_BACKEND_URL 环境变量后重试`);
    return false;
  }
}

// ===================== 心跳 =====================

async function heartbeat() {
  if (!CONFIG.instanceId || !CONFIG.instanceToken) return;
  try {
    await api('POST', `/api/v1/remote-fetch/instances/${CONFIG.instanceId}/heartbeat`, {});
  } catch (e) {
    log('warn', `心跳失败: ${e.message}`);
    // token 过期 → 重新绑
    if (e.message.includes('401') || e.message.includes('revoked')) {
      log('info', '令牌可能已失效，尝试重新绑定...');
      CONFIG.instanceToken = null;
      await bind();
    }
  }
}

// ===================== 文件扫描 =====================

const EXT_KEYWORDS = new Set(['pdf','docx','doc','xlsx','xls','pptx','ppt','txt','md','csv','jpg','jpeg','png','gif','webp','bmp','zip','rar','7z','mp3','mp4','wav','mov','apk','json','py']);

function matchFile(name, keywords) {
  const lower = name.toLowerCase();
  for (const kw of keywords) {
    if (!kw) continue;
    const k = kw.toLowerCase();
    if (EXT_KEYWORDS.has(k) && lower.endsWith('.' + k)) return true;
    if (lower.includes(k)) return true;
  }
  return false;
}

function shouldSkip(name) {
  const lower = name.toLowerCase();
  for (const ext of CONFIG.skipExt) if (lower.endsWith(ext)) return true;
  return false;
}

async function scanDirectory(root, keywords = null, maxFiles = CONFIG.maxFilesPerJob) {
  const results = [];
  const deadline = Date.now() + 30000; // 30s 上限
  let count = 0;

  async function walk(dir, depth) {
    if (Date.now() > deadline || count >= maxFiles || depth > CONFIG.maxDepth) return;
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }

    for (const e of entries) {
      if (count >= maxFiles) return;
      if (CONFIG.skipDirs.has(e.name) || e.name.startsWith('.')) continue;

      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
      } else if (e.isFile()) {
        if (shouldSkip(e.name)) continue;
        if (keywords && keywords.length > 0 && !matchFile(e.name, keywords)) continue;

        let stat;
        try { stat = await fs.promises.stat(full); } catch { continue; }
        if (stat.size === 0 || stat.size > CONFIG.maxFileSize) continue;

        try {
          const buf = await fs.promises.readFile(full);
          results.push({
            name: e.name,
            localPath: full,
            size: stat.size,
            localMtime: Math.floor(stat.mtimeMs),
            base64: buf.toString('base64'),
          });
          count++;
        } catch { /* skip unreadable */ }
      }
    }
  }

  await walk(root, 0);
  return results;
}

// ===================== 拉任务 + 执行 =====================

async function pollAndProcess() {
  if (!CONFIG.instanceId || !CONFIG.instanceToken) return;
  try {
    const r = await api('GET', '/api/v1/remote-fetch/fetch-jobs/pending');
    const jobs = r.data || [];
    for (const job of jobs) {
      if (processing.has(job.id)) continue;  // 跳过正在处理的
      await processJob(job);
    }
  } catch (e) {
    log('warn', `拉任务失败: ${e.message}`);
  }
}

async function processJob(job) {
  processing.add(job.id);
  try {
  log('info', `处理任务 ${job.id} status=${job.status} sourcePath=${job.resourceZone?.sourcePath || job.sourcePath}`);

  if (job.status === 'pending') {
    // 确认（可扩展：让用户交互确认；默认 accept）
    log('info', `自动确认任务（默认 accept）`);
    try {
      await api('POST', `/api/v1/remote-fetch/fetch-jobs/${job.id}/confirm`, { decision: 'confirm' });
    } catch (e) {
      log('warn', `确认失败: ${e.message}`);
      return;
    }
    job.status = 'dispatched';
  }

  if (job.status !== 'dispatched') return;

  // 检查 sourcePath 在本机是否存在（ResourceZone 可能是另一台电脑的路径）
  const sourcePath = job.resourceZone?.sourcePath || job.sourcePath;
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    log('warn', `sourcePath 不存在: ${sourcePath} — 可能是远端路径，跳过`);
    // 不标记 failed，让管理员处理
    return;
  }

  log('info', `开始扫描: ${sourcePath}`);
  let files;
  try {
    files = await scanDirectory(sourcePath);
  } catch (e) {
    log('error', `扫描失败: ${e.message}`);
    return;
  }
  log('info', `扫描完成 ${files.length} 个文件`);

  if (files.length === 0) {
    log('info', '没有匹配的文件，跳过上传');
    try {
      await api('POST', `/api/v1/remote-fetch/fetch-jobs/${job.id}/execute`, { resultCount: 0 });
    } catch { /* ignore */ }
    return;
  }

  // 自适应分批上传（按请求体字节数动态切，防止 413）
  // 后端 express.json limit = 11mb，留 1mb 安全余量
  const MAX_BODY_BYTES = 10 * 1024 * 1024;  // 10MB 软上限
  const spaceId = job.spaceId;
  let totalCount = 0;

  // 预构造 item 数组（去掉 base64 先，估算大小）
  const allItems = files.map((f) => ({
    name: f.name,
    base64: f.base64,
    localPath: f.localPath,
    localMtime: f.localMtime,
  }));

  // 贪心装箱：逐件累加，超上限就切
  const batches = [];
  let cur = [];
  let curBytes = 0;
  const OVERHEAD = 200;  // JSON 包装固定开销（spaceId/autoTag/括号逗号等）

  for (const item of allItems) {
    // 单个 item 的 base64 就是最大体积，加个 200 字节 name/path/mtime 余量
    const itemBytes = item.base64.length + 200;
    if (cur.length > 0 && curBytes + itemBytes + OVERHEAD > MAX_BODY_BYTES) {
      batches.push(cur);
      cur = []; curBytes = 0;
    }
    cur.push(item);
    curBytes += itemBytes;
  }
  if (cur.length > 0) batches.push(cur);

  log('info', `自适应分批: ${allItems.length} 个文件 → ${batches.length} 批次`);

  for (let bi = 0; bi < batches.length; bi++) {
    const batch = batches[bi];
    const retryQueue = [batch];  // 待上传队列（413 时拆两半入队头）
    let uploaded = 0;

    for (let attempt = 0; attempt < 5 && retryQueue.length > 0; attempt++) {
      const cur = retryQueue.shift();
      if (!cur || cur.length === 0) continue;

      const syncBody = { spaceId, autoTag: true, items: cur };
      const bodyStr = JSON.stringify(syncBody);
      const bodyMB = (Buffer.byteLength(bodyStr) / 1024 / 1024).toFixed(2);
      log('info', `  批次 ${bi + 1} (尝试${attempt + 1}) ${cur.length} items, body=${bodyMB}MB`);

      try {
        const r = await httpFetch(`${CONFIG.centralUrl}/api/v1/assets/sync`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${CONFIG.localJwt || ''}`,
          },
          body: bodyStr,
          timeout: 30000,
        });
        uploaded += cur.length;
        log('ok', `批次 ${bi + 1}: ${r.data?.created || r.data?.updated || 'ok'} items`);
      } catch (e) {
        const msg = (e.message || '').split('\n')[0];
        const is413 = msg.includes('413') || msg.includes('Request Entity Too Large') || msg.includes('请求体过大');
        if (is413 && cur.length > 1) {
          // 对半拆 → 前半入队头、后半入队尾
          const mid = Math.floor(cur.length / 2);
          const first = cur.slice(0, mid);
          const second = cur.slice(mid);
          log('warn', `  413! body=${bodyMB}MB, 拆 ${cur.length}→${first.length}+${second.length}`);
          retryQueue.unshift(first);
          retryQueue.push(second);
          continue;
        } else if (is413 && cur.length === 1) {
          // 单个文件 413 — 超过后端 limit，跳过
          log('warn', `  413! 单文件仍超限，跳过: ${cur[0].name} (${(cur[0].base64.length / 1024 / 1024).toFixed(1)}MB)`);
          continue;
        } else {
          log('error', `  失败: ${msg}`);
          break;  // 其他错误（timeout、5xx 等）跳过整个当前批次剩余
        }
      }
    }
    totalCount += uploaded;
  }

  // 标记任务完成
  try {
    await api('POST', `/api/v1/remote-fetch/fetch-jobs/${job.id}/execute`, { resultCount: totalCount });
    log('ok', `任务完成 ${job.id} — 共上传 ${totalCount} 个文件`);
  } catch (e) {
    log('warn', `标记完成失败: ${e.message}`);
  }
  } finally {
    processing.delete(job.id);
  }
}

// ===================== 启动 =====================

async function start() {
  log('info', '===== 远程提取 Worker 启动 =====');
  log('info', `centralUrl=${CONFIG.centralUrl}`);
  log('info', `fingerprint=${genFingerprint()}`);
  log('info', `hostname=${CONFIG.machineName}`);

  // 尝试恢复 token
  const saved = readTokenFile();
  if (saved && saved.token) {
    CONFIG.instanceToken = saved.token;
    CONFIG.instanceId = saved.instanceId;
    log('info', `恢复已保存的 token instanceId=${CONFIG.instanceId}`);
    // 验证 token 有效性
    try {
      const h = await api('POST', `/api/v1/remote-fetch/instances/${CONFIG.instanceId}/heartbeat`, {});
      if (h.data?.online) {
        log('ok', '心跳 OK，token 有效');
      }
    } catch (e) {
      log('warn', `恢复的 token 可能过期: ${e.message}`);
      CONFIG.instanceToken = null;
      CONFIG.instanceId = null;
    }
  }

  // 没有 token 就尝试绑定
  if (!CONFIG.instanceToken) {
    const ok = await bind();
    if (!ok) {
      log('warn', '绑定失败 — worker 停留在未绑定状态，30s 后重试');
      // 定时重试
      setInterval(() => bind().then((ok) => {
        if (ok) clearInterval(this);
      }), 30000);
    }
  }

  // 心跳循环
  setInterval(() => heartbeat(), CONFIG.heartbeatInterval);

  // 拉任务循环
  setInterval(() => pollAndProcess(), CONFIG.pollInterval);

  // 立即跑一次
  setTimeout(pollAndProcess, 2000);
}

// 如果 standalone 运行：node remote-fetch-worker.cjs
if (require.main === module) {
  start().catch((e) => { console.error('Worker 启动失败:', e); process.exit(1); });
}

// 导出供 main.cjs require
module.exports = { start, CONFIG, genFingerprint };


