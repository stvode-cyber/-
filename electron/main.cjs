// TODO: [空DB假hash] 预防：数据库初始化必须先校验 dev.db 文件存在且非空，再对比 .db-version hash；空文件 + 旧 hash → P2021
// TODO: [打包版心跳500] 预防：改完 electron-builder extraResources 后必须跑打包 → 解压检查 resources/ 目录，确保 cloud-jwt-public.pem 等资源在位
// TODO: [打包版公钥缺失降级] 预防：main.cjs 启动时检测 cloud-jwt-public.pem，缺失则强制 AUTH_MODE=local，不能让用户看到 500
// TODO: [宠物浮窗不自动启动] 预防：createPetWindow() 不得在 app.whenReady 中调用，必须托盘右键/设置页按钮手动触发
// Electron 主进程：启动后端 + 加载前端
// - app.whenReady: 启动后端子进程，等待端口就绪后创建窗口
// - app.quit: 杀死后端子进程

const { app, BrowserWindow, shell, ipcMain, dialog, screen, session, Tray, Menu, nativeImage } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { createCacheStore } = require('./cacheStore.cjs');

// ---- 修复：productName 含中文（"绿角犀"），Electron 默认用其作为 userData 目录名，
//      中文路径会导致 process_singleton 的 lockfile 创建失败（Error code: 5 ACCESS_DENIED）。
//      在 app ready 前显式设置纯英文 userData 路径绕过此问题。
// 注意：app.isPackaged 在 app ready 前不可靠，统一设置英文路径（开发模式无副作用）
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'aie-desktop'));
} catch (e) {
  console.error('设置 userData 路径失败:', e.message);
}

// ---- 单实例锁 ----
// 之前用 --no-singleton 禁用 Electron 原生锁 + 手动端口检测，但端口检测有竞态窗口：
// 两次快速启动 < 后端启动耗时（~2s），第二次也会通过 → 两个主窗口。
// 现在中文 userData 已修复 → 恢复 requestSingleInstanceLock（Electron 官方方案）。
// 端口检测保留作为双重兜底。
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  console.log('已有实例在运行，本实例退出');
  app.quit();
  return;
}

// 用户第二次双击 exe → 触发此事件 → 把第一个实例的窗口拉到前台
app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

// ---- 防多实例：检测后端端口是否已被占用（双重兜底）----
function isPortInUse(port) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(true));
    tester.once('listening', () => {
      tester.close(() => resolve(false));
    });
    tester.listen(port, BACKEND_HOST);
  });
}

// ---- 配置 ----
const BACKEND_PORT = 3001; // 后端监听端口
const BACKEND_HOST = '127.0.0.1';
const CLOUD_BACKEND_URL = 'http://47.116.59.141:3001'; // L3 公网云中枢
let backendProcess = null;

// Worker JWT 持久化路径（跨 Electron 重启保留登录态）
let WORKER_JWT_PATH = null;

// 检测后端可达性 — 智能选择 centralUrl
async function probeBackend(url, timeoutMs = 2000) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = http.request({ host: u.hostname, port: u.port, path: '/health', method: 'GET' }, (res) => {
      res.resume(); resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
    req.end();
  });
}
let mainWindow = null;
let backendReady = false;
let tray = null;
// 是否正在主动退出（区别于「关闭按钮 → 最小化到托盘」）
let isQuitting = false;

// ---- 路径（打包后 / 开发模式）----
// 开发模式：electron/resources/{backend,frontend}
// 打包模式：resources/{backend,frontend} （通过 extraResources 放置，不在 asar 内）
function getBackendPath() {
  if (app.isPackaged) {
    // extraResources 直接放在 resources 目录下，不在 app.asar 内
    return path.join(process.resourcesPath, 'backend');
  } else {
    return path.join(__dirname, 'resources', 'backend');
  }
}

function getFrontendPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'frontend');
  } else {
    // DEV 也与 PKG 保持一致：sync-dist.ps1 / build-desktop.cjs 都把 dist 平铺到 resources/frontend 根目录
    return path.join(__dirname, 'resources', 'frontend');
  }
}

// ---- 数据库路径（用户数据目录，确保可写）----
function getDatabasePath() {
  const userData = app.getPath('userData');
  const dbDir = path.join(userData, 'data');
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  return path.join(dbDir, 'aie.db');
}

// ---- 后端日志（用户数据目录）----
function getLogPath() {
  const userData = app.getPath('userData');
  const logDir = path.join(userData, 'logs');
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, 'backend.log');
}

// ---- LLM 配置持久化（铁律⑨：智能模式为重点项，只要打开就必须激活）----
// 机制：首次从 backend/.env 提取 LLM_* 持久化到 userData/llm.env，
// 之后每次启动注入后端环境变量（dotenv 不覆盖已注入值 → 注入优先）。
// 收益：打包资源里没有 .env、或重打包排除 .env，都不再导致智能模式失效。
function getLLMEnvPath() {
  return path.join(app.getPath('userData'), 'llm.env');
}

/** 解析 env 文件中的 LLM_* 配置 */
function parseEnvFile(filePath) {
  const result = {};
  if (!filePath || !fs.existsSync(filePath)) return result;
  try {
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*(LLM_[A-Z_]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
      if (m) result[m[1]] = m[2];
    }
  } catch { /* ignore */ }
  return result;
}

/** 首次启动：从 backend/.env 提取 LLM 配置持久化到 userData */
function ensureLLMConfig() {
  const llmEnvPath = getLLMEnvPath();
  if (fs.existsSync(llmEnvPath)) return; // 已持久化，不动
  const candidates = [
    path.join(getBackendPath(), '.env'),
    path.join(__dirname, 'resources', 'backend', '.env'),
  ];
  for (const c of candidates) {
    const cfg = parseEnvFile(c);
    if (cfg.LLM_PROVIDER && cfg.LLM_PROVIDER !== 'none') {
      fs.writeFileSync(llmEnvPath, Object.entries(cfg).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      console.log(`✅ LLM 配置已持久化到 userData: ${llmEnvPath}`);
      return;
    }
  }
  console.warn('⚠️ 未找到 LLM 配置（backend/.env 缺失或无 LLM_*），智能模式无法激活');
}

/** 读取持久化的 LLM 配置（含首次提取），返回注入用环境变量 */
function getLLMEnv() {
  ensureLLMConfig();
  const env = parseEnvFile(getLLMEnvPath());

  // 上架默认（AI 云端网关）：本机没有 LLM key 时，把 LLM 补全请求转发到云端服务器，
  // 由服务器持有的 key 调上游。本地零配置即可用 AI，key 不外泄。
  const hasLocalKey = !!env.LLM_API_KEY && env.LLM_PROVIDER !== 'none';
  if (!hasLocalKey) {
    env.LLM_ROUTING = 'cloud';
    env.LLM_GATEWAY_URL = 'http://47.116.59.141:3001/api/v1/ai/proxy';
    delete env.LLM_API_KEY; // 不注入空 key，避免后端误用
  } else {
    env.LLM_ROUTING = env.LLM_ROUTING || 'local';
  }
  return env;
}

/** 读取打包内置的云端 RSA 公钥（用于本地后端以 RS256 验签云端签发的身份令牌）。
 *  只带公钥、不带私钥——公钥只能验签、不能伪造，可随安装包安全分发（上架激活方案）。 */
function getCloudPublicKey() {
  try {
    const p = path.join(getBackendPath(), 'cloud-jwt-public.pem');
    if (fs.existsSync(p)) {
      const pem = fs.readFileSync(p, 'utf8').trim();
      if (pem && pem.includes('BEGIN PUBLIC KEY')) return pem;
    }
  } catch { /* ignore */ }
  return null;
}

// ---- 人设持久化（铁律⑨重点项：老朋友人设打开必激活，重打包不丢）----
// 优先级：userData/agent-persona.txt > backend/config/agent-config.json 的 personaPrompt
function getPersonaPath() {
  return path.join(app.getPath('userData'), 'agent-persona.txt');
}

function readPersonaFromConfig() {
  try {
    const cfgPath = path.join(getBackendPath(), 'config', 'agent-config.json');
    if (!fs.existsSync(cfgPath)) return '';
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    return typeof cfg.personaPrompt === 'string' ? cfg.personaPrompt : '';
  } catch { return ''; }
}

/** 首次启动：从 agent-config.json 提取人设持久化到 userData */
function ensurePersonaConfig() {
  const personaPath = getPersonaPath();
  if (fs.existsSync(personaPath)) return; // 已持久化，不动
  const persona = readPersonaFromConfig();
  if (persona && persona.trim()) {
    fs.writeFileSync(personaPath, persona, 'utf8');
    console.log(`✅ 人设已持久化到 userData: ${personaPath}`);
  }
}

/** 读取持久化的人设（注入 AGENT_PERSONA_PROMPT，后端 env 优先级最高） */
function getPersonaEnv() {
  ensurePersonaConfig();
  const personaPath = getPersonaPath();
  if (fs.existsSync(personaPath)) {
    const persona = fs.readFileSync(personaPath, 'utf8').trim();
    if (persona) return { AGENT_PERSONA_PROMPT: persona };
  }
  // 兜底：userData 没有就直接用配置文件里的（保证"打开必激活"）
  const fallback = readPersonaFromConfig();
  return fallback ? { AGENT_PERSONA_PROMPT: fallback } : {};
}

// ---- JWT 密钥管理（#1 修复：移除硬编码兜底，首次启动生成强随机密钥并持久化）----
function getJwtSecret() {
  const userData = app.getPath('userData');
  const keyFile = path.join(userData, 'jwt-secret.key');
  // 已存在则读取
  try {
    if (fs.existsSync(keyFile)) {
      const existing = fs.readFileSync(keyFile, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
  } catch { /* ignore */ }
  // 生成 32 字节随机十六进制（64 字符）
  const secret = crypto.randomBytes(32).toString('hex');
  try {
    fs.writeFileSync(keyFile, secret, { mode: 0o600 });
    console.log('✅ 已生成新的 JWT 密钥并持久化到 userData');
  } catch (e) {
    console.error('❌ JWT 密钥持久化失败:', e.message);
    throw new Error('无法持久化 JWT 密钥，应用拒绝以不安全状态启动');
  }
  return secret;
}

// ---- 数据库 schema 版本检查（#9 修复：避免每次启动都跑 prisma db push）----
function getSchemaHash() {
  try {
    const schemaPath = path.join(getBackendPath(), 'prisma', 'schema.prisma');
    const content = fs.readFileSync(schemaPath, 'utf8');
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  } catch {
    return null;
  }
}

function isDbInitialized() {
  // #修复：标记存在但数据库文件不存在/为空 → 必须重新初始化
  const userData = app.getPath('userData');
  const marker = path.join(userData, '.db-version');
  const dbPath = getDatabasePath();
  const currentHash = getSchemaHash();
  if (!currentHash) return false;
  // 检查数据库文件是否存在且有内容
  if (!fs.existsSync(dbPath) || (fs.existsSync(dbPath) && fs.statSync(dbPath).size <= 0)) {
    return false;
  }
  try {
    const existing = fs.readFileSync(marker, 'utf8').trim();
    if (existing === currentHash) return true;
  } catch { /* ignore */ }
  return false;
}

function markDbInitialized() {
  const userData = app.getPath('userData');
  const marker = path.join(userData, '.db-version');
  const currentHash = getSchemaHash();
  if (currentHash) {
    try { fs.writeFileSync(marker, currentHash); } catch { /* ignore */ }
  }
}

// ---- 安全：setWindowOpenHandler 公共函数（#8 修复：非 http(s) 一律 deny）----
function attachSafeWindowOpen(win) {
  if (!win || !win.webContents) return;
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 仅 http(s) 经系统浏览器打开；file:// data: javascript: 等一律 deny
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

// ---- 检查端口是否就绪 ----
function waitForBackend(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      const req = http.get(
        { host: BACKEND_HOST, port: BACKEND_PORT, path: '/health', timeout: 2000 },
        (res) => {
          if (res.statusCode === 200) {
            backendReady = true;
            resolve();
          } else {
            retry();
          }
          res.resume();
        }
      );
      req.on('error', () => retry());
      req.on('timeout', () => { req.destroy(); retry(); });
    }
    function retry() {
      if (Date.now() - start > timeoutMs) {
        reject(new Error('后端启动超时'));
      } else {
        setTimeout(check, 500);
      }
    }
    check();
  });
}

// ---- 初始化数据库（#9 修复：schema 未变时跳过；Electron 43 兼容：改为复制预建数据库）----
function initDatabase() {
  return new Promise((resolve, reject) => {
    // 幂等检查：schema hash 与上次一致则跳过
    if (isDbInitialized()) {
      console.log('✅ 数据库 schema 已是最新，跳过初始化');
      return resolve();
    }

    const backendPath = getBackendPath();
    const dbPath = getDatabasePath();
    const logFile = getLogPath();
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });

    console.log('初始化数据库...');
    logStream.write('\n=== 数据库初始化 ===\n');

    // Electron 43 的 ELECTRON_RUN_AS_NODE 模式与 prisma 引擎不兼容
    // 改为复制预建的 dev.db（已含 schema，无数据）到 userData 目录
    const templateDb = path.join(backendPath, 'prisma', 'dev.db');

    try {
      // 确保 data 目录存在
      const dbDir = path.dirname(dbPath);
      if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

      const hasExistingDb = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0;
      if (!hasExistingDb && fs.existsSync(templateDb)) {
        // 复制预建数据库（含 schema，无数据）
        fs.copyFileSync(templateDb, dbPath);
        // 清理可能残留的 WAL/SHM 文件（旧实例遗留），避免 SQLite 写入冲突
        for (const suffix of ['-wal', '-shm', '-journal']) {
          const f = dbPath + suffix;
          if (fs.existsSync(f)) { try { fs.unlinkSync(f); } catch { /* ignore */ } }
        }
        const msg = `已复制预建数据库模板: ${templateDb} -> ${dbPath}`;
        console.log(`✅ ${msg}`);
        logStream.write(msg + '\n');
      } else {
        // 回退：尝试 prisma db push（开发模式或旧版 Electron）
        logStream.write('预建数据库不存在，尝试 prisma db push...\n');
        const isDev = !app.isPackaged;
        const cmd = isDev ? 'node' : process.execPath;
        const prismaEntry = path.join(backendPath, 'node_modules', 'prisma', 'build', 'index.js');
        const args = [prismaEntry, 'db', 'push', '--skip-generate'];
        const env = { ...process.env, DATABASE_URL: `file:${dbPath}` };
        if (!isDev) env.ELECTRON_RUN_AS_NODE = '1';

        const proc = spawn(cmd, args, {
          cwd: backendPath, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
        });
        let output = '';
        proc.stdout.on('data', (d) => { const m = d.toString(); output += m; logStream.write(m); });
        proc.stderr.on('data', (d) => { const m = d.toString(); output += m; logStream.write(`[ERROR] ${m}`); });
        proc.on('exit', (code) => {
          if (code !== 0) { logStream.end(); return reject(new Error(`prisma db push 失败 (exit ${code}): ${output}`)); }
          console.log('✅ 数据库初始化完成 (prisma db push)');
          logStream.end();
          markDbInitialized();
          resolve();
        });
        return; // 异步路径，不继续执行下面的同步代码
      }

      logStream.end();
      console.log('✅ 数据库初始化完成');
      markDbInitialized();
      resolve();
    } catch (e) {
      logStream.end();
      reject(new Error(`数据库初始化失败: ${e.message}`));
    }
  });
}

// ---- 启动后端子进程 ----
async function startBackend() {
  const backendPath = getBackendPath();
  const entryFile = path.join(backendPath, 'dist', 'index.js');

  if (!fs.existsSync(entryFile)) {
    throw new Error(`后端入口文件不存在: ${entryFile}`);
  }

  const dbPath = getDatabasePath();
  const logFile = getLogPath();
  const logStream = fs.createWriteStream(logFile, { flags: 'a' });

  // 先初始化数据库表结构
  await initDatabase();

  // 后端通过环境变量接收配置
  // 上架激活：打包版走"云端账号"——登录/注册代理到云端来源，本端用云端公钥验签身份令牌。
  // JWT_SECRET 保留为独立 HS 密钥（供 remoteFetch/verify 等自用），并作为 HS 兜底。
  const cloudPublicKey = getCloudPublicKey();
  // 降级：打包版若未内置云端公钥（cloud-jwt-public.pem），自动回退 local 模式——
  // 否则 authProxy 会因缺 CLOUD_AUTH_BASE_URL 返回 500 "服务端未配置云端认证地址"。
  // [临时 2026-09-16] 强制 local：云端后端还没部署 /auth/phone-login 端点，
  // 走 cloud-proxy 会把请求转发到云端 → 404。等云端升级后恢复
  const authMode = 'local';
  // CORS_ORIGIN 设为 'null' 以允许 file:// 协议的前端跨域携带 cookie（Electron file:// origin 为 'null'）
  // DATABASE_URL 路径分隔符必须为正斜杠，Windows 反斜杠会导致 Prisma "unable to open database file"
  const userData = app.getPath('userData');
  const tempDir = path.join(userData, 'tmp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(BACKEND_PORT),
    HOST: '0.0.0.0',
    DATABASE_URL: `file:${dbPath.replace(/\\/g, '/')}`,
    JWT_SECRET: getJwtSecret(),
    // 上架激活（cloud-proxy）：本端只验不签，用云端公钥验签 + 认证代理到云端
    ...(authMode === 'cloud-proxy' && cloudPublicKey ? {
      AUTH_MODE: 'cloud-proxy',
      CLOUD_AUTH_BASE_URL: 'http://47.116.59.141:3001',
      JWT_PUBLIC_KEY: cloudPublicKey,
    } : {
      AUTH_MODE: authMode,
    }),
    CORS_ORIGIN: 'null',
    ELECTRON_RUN: '1',
    // 铁律⑨：智能模式重点项，启动即注入 LLM 配置（dotenv 不覆盖已注入值）
    ...getLLMEnv(),
    // 铁律⑨：老朋友人设重点项，启动即注入（env 优先级最高，重打包不丢）
    ...getPersonaEnv(),
    // 修复 SQLITE_CANTOPEN：安装目录只读，SQLite/Prisma 需要可写的临时目录
    TEMP: tempDir,
    TMP: tempDir,
    TMPDIR: tempDir,
  };

  console.log(`启动后端: ${entryFile}`);
  console.log(`数据库: ${dbPath}`);
  console.log(`日志: ${logFile}`);

  // 开发模式：使用系统 node
  // 打包后：使用 electron 内置的 node（ELECTRON_RUN_AS_NODE 模式）
  const isDev = !app.isPackaged;
  const cmd = isDev ? 'node' : process.execPath;
  const args = [entryFile];

  const spawnEnv = { ...env };
  if (!isDev) {
    // 让 electron 以纯 Node.js 模式运行，不启动渲染进程
    spawnEnv.ELECTRON_RUN_AS_NODE = '1';
  }

  backendProcess = spawn(cmd, args, {
    cwd: backendPath,
    env: spawnEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  backendProcess.on('error', (e) => {
    console.error('[backend] spawn error:', e.message);
    logStream.write(`[SPAWN ERROR] ${e.message}\n`);
  });

  backendProcess.stdout.on('data', (d) => {
    const msg = d.toString();
    process.stdout.write(`[backend] ${msg}`);
    logStream.write(msg);
  });
  backendProcess.stderr.on('data', (d) => {
    const msg = d.toString();
    process.stderr.write(`[backend:err] ${msg}`);
    logStream.write(`[ERROR] ${msg}`);
  });
  backendProcess.on('exit', (code, signal) => {
    console.log(`[backend] 进程退出 code=${code} signal=${signal}`);
    logStream.write(`[EXIT] code=${code} signal=${signal}\n`);
    backendProcess = null;
  });
  backendProcess.on('close', (code, signal) => {
    console.log(`[backend] 进程关闭 code=${code} signal=${signal}`);
    logStream.write(`[CLOSE] code=${code} signal=${signal}\n`);
  });

  return waitForBackend();
}

// ---- 创建主窗口 ----
function createWindow() {
  // 防重入：如果主窗口已存在且未销毁，直接 show/focus，不新建
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    title: '绿角犀',
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f5f5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复：启用渲染进程操作系统级沙箱
    },
  });

  // #8 修复：外部链接在系统浏览器打开，非 http(s) scheme 一律 deny
  attachSafeWindowOpen(mainWindow);

  // 加载前端
  console.log(`加载前端: ${indexPath}`);
  mainWindow.loadFile(indexPath);

  // 主窗口登录成功后（导航离开 /login），刷新宠物浮窗使其恢复显示（尊重用户的隐藏选择）
  mainWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (!url.includes('/login') && petWindow && !petWindow.isDestroyed() && !petWindow.isVisible()
        && getPetAutoShowStore()) {
      // 用户已登录，重新加载宠物浮窗（此时已登录，不会被重定向到 /login）
      petWindow.loadFile(indexPath, { hash: '/pet?float=1' })
    }
  })

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // 关闭主窗口 = 最小化到托盘（不再完全隐藏）。
  // 过去：直接销毁浮窗 → 用户看不到任何入口，只能去任务管理器结束进程。
  // 现在：关闭按钮隐藏主窗口，托盘图标常驻，用户可点击托盘重新唤出主窗口或完整退出。
  // 真正退出统一走托盘菜单「退出」或 app.before-quit（isQuitting=true 时放行关闭）。
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide();
      }
      return;
    }
    // 正在退出：销毁所有浮窗，确保 window-all-closed 触发 → app.quit
    for (const w of [petWindow, stickyWindow, countdownWindow, todoWindow, reminderWindow, wallpaperWindow]) {
      if (w && !w.isDestroyed()) {
        try { w.destroy(); } catch { /* ignore */ }
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---- 创建桌面宠物浮窗（始终置顶 + 透明无边框，浮于桌面）----
// 未登录时前端会重定向到 /login，宠物浮窗检测到登录页自动隐藏，避免出现"两个登录框"
// 初始位置：屏幕右下角（避开正中间，贴近任务栏上方）
let petWindow = null
// 宠物浮窗记忆：用户关闭过（pet:hideFloat）→ 之后启动不再自动弹出，直到手动唤出
function getPetAutoShowStore() {
  try {
    const p = path.join(app.getPath('userData'), 'pet-auto-show.json');
    if (!fs.existsSync(p)) return false; // 默认关闭（用户在设置里手动开启）
    return JSON.parse(fs.readFileSync(p, 'utf8')).autoShow === true;
  } catch { return false; }
}
function setPetAutoShow(autoShow) {
  try {
    fs.writeFileSync(path.join(app.getPath('userData'), 'pet-auto-show.json'), JSON.stringify({ autoShow: !!autoShow }), 'utf8');
  } catch { /* ignore */ }
}
function createPetWindow({ forceShow = false } = {}) {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.show();
    petWindow.focus();
    return petWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const petWidth = 260;
  const petHeight = 340;
  const { workArea } = screen.getPrimaryDisplay();
  // 右下角：workArea.right - 宠物宽 - 16 边距，workArea.bottom - 宠物高 - 8 边距
  const petX = Math.max(workArea.x, workArea.x + workArea.width - petWidth - 16);
  const petY = Math.max(workArea.y, workArea.y + workArea.height - petHeight - 8);
  petWindow = new BrowserWindow({
    width: petWidth,
    height: petHeight,
    x: petX,
    y: petY,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  attachSafeWindowOpen(petWindow); // #8 修复
  // 桌面端使用 HashRouter：#/pet?float=1 即精简浮窗模式
  petWindow.loadFile(indexPath, { hash: '/pet?float=1' });
  // 未登录时前端重定向到 /login → 隐藏浮窗，避免与主窗口同时显示登录页
  petWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (!petWindow || petWindow.isDestroyed()) return
    if (url.includes('/login')) {
      if (petWindow.isVisible()) petWindow.hide()
    } else if (forceShow || getPetAutoShowStore()) {
      if (!petWindow.isVisible()) petWindow.show()
    }
  })
  petWindow.once('ready-to-show', () => {
    // ready-to-show 时可能已被重定向到 /login，由 did-navigate-in-page 决定是否显示
    if (petWindow && !petWindow.isDestroyed() && !petWindow.webContents.getURL().includes('/login')
        && (forceShow || getPetAutoShowStore())) {
      petWindow.show()
    }
  })
  petWindow.on('closed', () => { petWindow = null; });
  return petWindow;
}

// 切换浮窗显隐（供前端按钮调用）——记住用户选择：关掉过就不再自动弹
ipcMain.handle('pet:toggleFloat', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    if (petWindow.isVisible()) { petWindow.hide(); setPetAutoShow(false); return 'hidden'; }
    petWindow.show(); petWindow.focus(); setPetAutoShow(true); return 'shown';
  }
  createPetWindow({ forceShow: true }); // 手动唤出 → 恢复自动显示
  setPetAutoShow(true);
  return 'created';
});

// 拖动宠物浮窗（相对位移 dx/dy，通过 setPosition 移动整个窗口）
// 实现整个宠物区域可拖拽移动，而非仅窗口边缘
ipcMain.handle('pet:moveBy', (_e, dx, dy) => {
  if (petWindow && !petWindow.isDestroyed()) {
    try {
      const [x, y] = petWindow.getPosition();
      petWindow.setPosition(x + Math.round(dx), y + Math.round(dy));
    } catch { /* ignore */ }
  }
});

// 关闭宠物浮窗（完全销毁窗口，区别于 hide 的临时隐藏）——记住选择，之后启动不再自动弹
ipcMain.handle('pet:closeFloat', () => {
  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
    petWindow = null;
    setPetAutoShow(false);
    return 'closed';
  }
  return 'already_closed';
});

// ---- 桌面便签浮窗（透明无边框，置顶，浮于桌面）----
let stickyWindow = null
function createStickyWindow() {
  if (stickyWindow && !stickyWindow.isDestroyed()) {
    stickyWindow.show();
    stickyWindow.focus();
    return stickyWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const saved = loadFloatSizes().sticky || {}
  stickyWindow = new BrowserWindow({
    width: saved.width || 380,
    height: saved.height || 540,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  persistWindowSize(stickyWindow, 'sticky')
  attachSafeWindowOpen(stickyWindow); // #8 修复
  // 桌面端使用 HashRouter：#/sticky?float=1 即便签浮窗模式
  stickyWindow.loadFile(indexPath, { hash: '/sticky?float=1' });
  stickyWindow.once('ready-to-show', () => stickyWindow && stickyWindow.show());
  stickyWindow.on('closed', () => { stickyWindow = null; });
  return stickyWindow;
}

// 切换便签浮窗显隐（供前端按钮调用）
ipcMain.handle('sticky:toggleFloat', () => {
  if (stickyWindow && !stickyWindow.isDestroyed()) {
    if (stickyWindow.isVisible()) { stickyWindow.hide(); return 'hidden'; }
    stickyWindow.show(); stickyWindow.focus(); return 'shown';
  }
  createStickyWindow();
  return 'created';
});

// ---- 浮窗尺寸记忆（可调整大小后持久化，重启恢复）----
const floatWinSizePath = () => path.join(app.getPath('userData'), 'float-win-size.json')
function loadFloatSizes() {
  try { return JSON.parse(fs.readFileSync(floatWinSizePath(), 'utf8')) || {} } catch { return {} }
}
function saveFloatSize(key, bounds) {
  try {
    const all = loadFloatSizes()
    all[key] = { width: Math.round(bounds.width), height: Math.round(bounds.height) }
    fs.writeFileSync(floatWinSizePath(), JSON.stringify(all, null, 2), 'utf8')
  } catch { /* 忽略写入失败 */ }
}
/** 挂 resize 持久化（防抖 500ms） */
function persistWindowSize(win, key) {
  let timer = null
  win.on('resize', () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      if (win && !win.isDestroyed()) saveFloatSize(key, win.getBounds())
    }, 500)
  })
}
const FLOAT_MIN = { width: 260, height: 200 }

// ---- 桌面倒计时浮窗（透明无边框，置顶，浮于桌面）----
// 显示置顶/紧急倒计时，桌面常驻提醒；尺寸可调并记忆
let countdownWindow = null
function createCountdownWindow() {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.show();
    countdownWindow.focus();
    return countdownWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const saved = loadFloatSizes().countdown || {}
  countdownWindow = new BrowserWindow({
    width: saved.width || 320,
    height: saved.height || 440,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  persistWindowSize(countdownWindow, 'countdown')
  attachSafeWindowOpen(countdownWindow); // #8 修复
  // 桌面端使用 HashRouter：#/countdowns?float=1 即倒计时浮窗模式
  countdownWindow.loadFile(indexPath, { hash: '/countdowns?float=1' });
  // 未登录时前端重定向到 /login → 隐藏浮窗
  countdownWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (!countdownWindow || countdownWindow.isDestroyed()) return
    if (url.includes('/login')) {
      if (countdownWindow.isVisible()) countdownWindow.hide()
    } else {
      if (!countdownWindow.isVisible()) countdownWindow.show()
    }
  })
  // ready-to-show：页面首帧就绪后显示（排除已重定向到 /login 的情况）
  countdownWindow.once('ready-to-show', () => {
    if (countdownWindow && !countdownWindow.isDestroyed() && !countdownWindow.webContents.getURL().includes('/login')) {
      countdownWindow.show()
    }
  })
  // 兜底：3 秒后若窗口仍未显示（ready-to-show 未触发或被 /login 隐藏后已恢复），强制显示
  setTimeout(() => {
    if (countdownWindow && !countdownWindow.isDestroyed() && !countdownWindow.webContents.getURL().includes('/login')) {
      if (!countdownWindow.isVisible()) countdownWindow.show()
    }
  }, 3000)
  countdownWindow.on('closed', () => { countdownWindow = null; });
  return countdownWindow;
}

// 切换倒计时浮窗显隐（供前端按钮调用）
ipcMain.handle('countdown:toggleFloat', () => {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    if (countdownWindow.isVisible()) { countdownWindow.hide(); return 'hidden'; }
    countdownWindow.show(); countdownWindow.focus(); return 'shown';
  }
  createCountdownWindow();
  return 'created';
});

// ---- 桌面待办浮窗（透明无边框，置顶，浮于桌面）----
// 显示今日待办，支持快速完成
let todoWindow = null
function createTodoWindow() {
  if (todoWindow && !todoWindow.isDestroyed()) {
    todoWindow.show();
    todoWindow.focus();
    return todoWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const saved = loadFloatSizes().todo || {}
  todoWindow = new BrowserWindow({
    width: saved.width || 320,
    height: saved.height || 480,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  persistWindowSize(todoWindow, 'todo')
  attachSafeWindowOpen(todoWindow); // #8 修复
  // 桌面端使用 HashRouter：#/tasks?float=1 即待办浮窗模式
  todoWindow.loadFile(indexPath, { hash: '/tasks?float=1' });
  todoWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (!todoWindow || todoWindow.isDestroyed()) return
    if (url.includes('/login')) {
      if (todoWindow.isVisible()) todoWindow.hide()
    } else {
      if (!todoWindow.isVisible()) todoWindow.show()
    }
  })
  todoWindow.once('ready-to-show', () => {
    if (todoWindow && !todoWindow.isDestroyed() && !todoWindow.webContents.getURL().includes('/login')) {
      todoWindow.show()
    }
  })
  // 兜底：3 秒后若窗口仍未显示，强制显示
  setTimeout(() => {
    if (todoWindow && !todoWindow.isDestroyed() && !todoWindow.webContents.getURL().includes('/login')) {
      if (!todoWindow.isVisible()) todoWindow.show()
    }
  }, 3000)
  todoWindow.on('closed', () => { todoWindow = null; });
  return todoWindow;
}

// 切换待办浮窗显隐（供前端按钮调用）
ipcMain.handle('todo:toggleFloat', () => {
  if (todoWindow && !todoWindow.isDestroyed()) {
    if (todoWindow.isVisible()) { todoWindow.hide(); return 'hidden'; }
    todoWindow.show(); todoWindow.focus(); return 'shown';
  }
  createTodoWindow();
  return 'created';
});

// ---- 桌面提醒浮窗（透明无边框，置顶，浮于桌面）----
// 显示待办提醒，支持快速完成
let reminderWindow = null
function createReminderWindow() {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    reminderWindow.show();
    reminderWindow.focus();
    return reminderWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const saved = loadFloatSizes().reminder || {}
  reminderWindow = new BrowserWindow({
    width: saved.width || 320,
    height: saved.height || 460,
    minWidth: FLOAT_MIN.width,
    minHeight: FLOAT_MIN.height,
    transparent: true,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  persistWindowSize(reminderWindow, 'reminder')
  attachSafeWindowOpen(reminderWindow); // #8 修复
  // 桌面端使用 HashRouter：#/reminders?float=1 即提醒浮窗模式
  reminderWindow.loadFile(indexPath, { hash: '/reminders?float=1' });
  reminderWindow.webContents.on('did-navigate-in-page', (_e, url) => {
    if (!reminderWindow || reminderWindow.isDestroyed()) return
    if (url.includes('/login')) {
      if (reminderWindow.isVisible()) reminderWindow.hide()
    } else {
      if (!reminderWindow.isVisible()) reminderWindow.show()
    }
  })
  reminderWindow.once('ready-to-show', () => {
    if (reminderWindow && !reminderWindow.isDestroyed() && !reminderWindow.webContents.getURL().includes('/login')) {
      reminderWindow.show()
    }
  })
  // 兜底：3 秒后若窗口仍未显示，强制显示
  setTimeout(() => {
    if (reminderWindow && !reminderWindow.isDestroyed() && !reminderWindow.webContents.getURL().includes('/login')) {
      if (!reminderWindow.isVisible()) reminderWindow.show()
    }
  }, 3000)
  reminderWindow.on('closed', () => { reminderWindow = null; });
  return reminderWindow;
}

// 切换提醒浮窗显隐（供前端按钮调用）
ipcMain.handle('reminder:toggleFloat', () => {
  if (reminderWindow && !reminderWindow.isDestroyed()) {
    if (reminderWindow.isVisible()) { reminderWindow.hide(); return 'hidden'; }
    reminderWindow.show(); reminderWindow.focus(); return 'shown';
  }
  createReminderWindow();
  return 'created';
});

// ---- 桌面动态壁纸层（全屏透明、鼠标穿透、置于底层）----
let wallpaperWindow = null
function createWallpaperWindow() {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    wallpaperWindow.show();
    return wallpaperWindow;
  }
  const frontendPath = getFrontendPath();
  const indexPath = path.join(frontendPath, 'index.html');
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  wallpaperWindow = new BrowserWindow({
    width,
    height,
    x: 0,
    y: 0,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // #6 修复
    },
  });
  attachSafeWindowOpen(wallpaperWindow); // #8 修复
  // 桌面端使用 HashRouter：#/wallpaper?float=1 即整屏动画层
  wallpaperWindow.loadFile(indexPath, { hash: '/wallpaper?float=1' });
  // 鼠标穿透：动画层永不拦截桌面点击（便签/应用照常操作）
  wallpaperWindow.setIgnoreMouseEvents(true);
  wallpaperWindow.once('ready-to-show', () => wallpaperWindow && wallpaperWindow.show());
  wallpaperWindow.on('closed', () => { wallpaperWindow = null; });
  return wallpaperWindow;
}

// 切换动态壁纸层显隐（供前端按钮调用）
ipcMain.handle('wallpaper:toggleWindow', () => {
  if (wallpaperWindow && !wallpaperWindow.isDestroyed()) {
    if (wallpaperWindow.isVisible()) { wallpaperWindow.hide(); return 'hidden'; }
    wallpaperWindow.show(); return 'shown';
  }
  createWallpaperWindow();
  return 'created';
});

// ---- 系统托盘（关闭主窗口时最小化到托盘，不再"完全隐藏"）----
function createTray() {
  // 用一个程序生成的纯色小图作为托盘图标（无外部资源依赖，避免打包路径问题）
  const size = 16;
  const img = nativeImage.createEmpty();
  // 用一个简单的 base64 PNG（绿色圆角方块带白色"绿"字感）作为托盘图标
  const iconPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAfklEQVR4AcXOMQqDQBCF4d/b928gCpYgCFYwiAJWMIQCFkwQBAtYEAs2Y8vsKiRX8aRzc7r3mlOL2+T9hGma5nNN0zSl2Ww29VqtVqtcLofT6XQul8sFwzBQLpeL5vN5Zb/fL6VpmpJKpZJOpzOZTCSj0UilUqler2u5XC6Xy+UCAKzX670eh8Ho+XwulUptt9vtRqNRzOfzJRKJRKPR6PF4LBaL0Wq1qtfrmqZpCgB4vo9EIgEAtNttAIBSqdR0Op3H43E8Ho/D4XA4n8/n8/k8Q4VxJ9P3/wBfXr5CL7zY8gAAAABJRU5ErkJggg==',
    'base64'
  );
  const trayIcon = nativeImage.createFromBuffer(iconPng, { scaleFactor: 1.0 });
  tray = new Tray(trayIcon.isEmpty() ? img : trayIcon);
  tray.setToolTip('绿角犀 · 点击显示主窗口');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示主窗口',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.show();
          mainWindow.focus();
        } else {
          createWindow();
          mainWindow && mainWindow.show();
        }
      },
    },
    { type: 'separator' },
    {
      label: '桌面宠物',
      click: () => {
        try { createPetWindow({ forceShow: true }); setPetAutoShow(true); } catch (e) { console.error('唤出宠物失败:', e.message); }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  // 单击托盘图标：切换主窗口显隐（双击直接显示）
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    } else {
      createWindow();
    }
  });
}

// ---- 应用生命周期 ----
app.whenReady().then(async () => {
  try {
    // 防多实例：若后端端口已被占用，说明已有实例运行，本实例退出
    const portInUse = await isPortInUse(BACKEND_PORT);
    if (portInUse) {
      console.log('检测到已有实例运行（端口已占用），本实例退出');
      const { dialog } = require('electron');
      dialog.showErrorBox('已在运行', '绿角犀已在运行中。');
      app.quit();
      return;
    }

    console.log('=== 绿角犀启动 ===');
    console.log(`运行模式: ${app.isPackaged ? '打包' : '开发'}`);
    console.log(`后端路径: ${getBackendPath()}`);
    console.log(`前端路径: ${getFrontendPath()}`);

    // #7 修复：注入严格 CSP（仅允许本地资源 + 后端 API）
    // - default-src 'self' file: data: blob: 允许本地文件、内联 data/blob 资源
    // - script-src 'self' file: 禁止 inline script（防 XSS）
    // - style-src 'self' file: 'unsafe-inline' 允许样式内联（Tailwind/React 运行时需要）
    // - connect-src 限定到本地后端
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      const csp = [
        "default-src 'self' file: data: blob:",
        "script-src 'self' file:",
        "style-src 'self' file: 'unsafe-inline'",
        "img-src 'self' file: data: blob: https:",
        "media-src 'self' file: data: blob:",
        "font-src 'self' file: data:",
        `connect-src 'self' http://127.0.0.1:${BACKEND_PORT} http://localhost:${BACKEND_PORT} ws://127.0.0.1:${BACKEND_PORT} ws://localhost:${BACKEND_PORT}`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
      ].join('; ');
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });

    // ---- 自动更新（轻量自更新：frp 公网链路拉取 → 应用 → 重启生效）----
    // 启动早期（后端未启动、无 Prisma DLL 锁）：先处理上次更新遗留的重新生成标记
    const UPDATE_SOURCE = (process.env.AIE_UPDATE_URL || 'http://47.116.59.141:3900/updates').replace(/\/+$/, '');
    let updater = null;
    try {
      const { createUpdater } = require('./updater.cjs');
      updater = createUpdater({
        resourcesRoot: app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources'),
        frontendTarget: getFrontendPath(),
        backendDistTarget: path.join(getBackendPath(), 'dist'),
        backendRoot: getBackendPath(),
        userData: app.getPath('userData'),
        isPackaged: app.isPackaged,
      });
      updater.regeneratePrismaIfMarked();
    } catch (e) {
      console.warn('[updater] 预启动准备异常（跳过，不影响启动）:', e.message);
    }

    // 启动后端
    await startBackend();
    console.log('✅ 后端已就绪');

    // ---- 远程提取 Worker（L2 Worker + L3 公网）----
    // 智能选路：本地后端可达 → 用本地；否则 → 公网云中枢
    // JWT 从 userData/worker-jwt.json 恢复（跨重启保留登录态）
    try {
      const { start: startRemoteWorker, CONFIG: workerCfg } = require('./services/remote-fetch-worker.cjs');

      // 1) 智能选 centralUrl
      const localUrl = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
      const cloudUrl = CLOUD_BACKEND_URL;
      let chosenUrl = process.env.CENTRAL_BACKEND_URL;
      if (!chosenUrl) {
        const localOk = await probeBackend(localUrl);
        const cloudOk = await probeBackend(cloudUrl);
        chosenUrl = localOk ? localUrl : (cloudOk ? cloudUrl : localUrl);
      }
      workerCfg.centralUrl = chosenUrl;

      // 2) JWT 持久化路径 + 读取
      WORKER_JWT_PATH = path.join(app.getPath('userData'), 'worker-jwt.json');
      let savedJwt = '';
      try {
        if (fs.existsSync(WORKER_JWT_PATH)) {
          const f = JSON.parse(fs.readFileSync(WORKER_JWT_PATH, 'utf8'));
          if (f && f.jwt) savedJwt = f.jwt;
        }
      } catch (_) {}
      workerCfg.localJwt = process.env.CENTRAL_JWT || savedJwt;

      startRemoteWorker().catch((e) => console.warn('[worker] 启动异常（跳过）:', e.message));
      console.log(`[worker] centralUrl=${chosenUrl} jwt=${workerCfg.localJwt ? '已就绪' : '待登录'}`);

      // 3) 暴露给后续 IPC 桥接（setWorkerJwt 更新）
      global.__workerCfg = workerCfg;
      global.__workerStartPromise = startRemoteWorker();
    } catch (e) {
      console.warn('[worker] 模块加载失败（跳过）:', e.message);
    }

    // ---- 更新检查（此时后端已就绪：remoteFileServer 已在 3900 端口提供 /updates）----
    try {
      if (updater) {
        const fetched = await updater.fetchRemote(UPDATE_SOURCE);
      console.log(
        '[updater] 更新检查 ' + (fetched.ok ? 'OK' : '跳过(' + fetched.reason + ')') +
        (fetched.ok ? ' 最新=' + fetched.latest + (fetched.changed ? '（有更新，已下载）' : '（无更新）') : '')
      );
        const applied = updater.applyIfNewer();
        if (applied.applied) {
          console.log('[updater] ✅ 已自动更新到 ' + applied.version + '，重启生效');
          app.relaunch();
          app.quit();
          return;
        }
      }
    } catch (e) {
      console.warn('[updater] 更新检查异常（跳过，不影响启动）:', e.message);
    }

    // Worker JWT 桥接 IPC — 前端登录/登出时同步给 Worker
    ipcMain.handle('worker:setJwt', (_e, jwt) => {
      if (!WORKER_JWT_PATH) WORKER_JWT_PATH = path.join(app.getPath('userData'), 'worker-jwt.json');
      try {
        if (jwt) {
          fs.writeFileSync(WORKER_JWT_PATH, JSON.stringify({ jwt, updatedAt: Date.now() }, null, 'utf8'));
          if (global.__workerCfg) global.__workerCfg.localJwt = jwt;
          console.log('[worker] JWT 已同步（前端登录）');
        } else {
          fs.writeFileSync(WORKER_JWT_PATH, JSON.stringify({ jwt: '', updatedAt: Date.now() }, null, 'utf8'));
          if (global.__workerCfg) global.__workerCfg.localJwt = '';
          console.log('[worker] JWT 已清空（前端登出）');
        }
      } catch (err) {
        console.warn('[worker] JWT 持久化失败:', err.message);
      }
      return true;
    });
    ipcMain.handle('worker:getJwt', () => {
      if (!WORKER_JWT_PATH) return '';
      try {
        if (fs.existsSync(WORKER_JWT_PATH)) {
          const f = JSON.parse(fs.readFileSync(WORKER_JWT_PATH, 'utf8'));
          return f.jwt || '';
        }
      } catch (_) {}
      return '';
    });
    ipcMain.handle('worker:getStatus', () => {
      const cfg = global.__workerCfg;
      if (!cfg) return { running: false, reason: 'not_loaded' };
      return {
        running: true,
        centralUrl: cfg.centralUrl,
        hasJwt: !!cfg.localJwt,
        instanceId: cfg.instanceId || null,
        instanceToken: cfg.instanceToken ? '****' : null,
      };
    });

    // 注册本地缓存 IPC（桌面端「离线可用」：已下载资产写入本地磁盘，断网可读）
    const cacheRoot = path.join(app.getPath('userData'), 'cache');
    const cacheStore = createCacheStore(cacheRoot);
    ipcMain.handle('dam:cacheAsset', (_e, assetId, fileName, buf) => cacheStore.cacheAsset(assetId, fileName, buf));
    ipcMain.handle('dam:getCached', (_e, assetId) => cacheStore.getCached(assetId));
    ipcMain.handle('dam:readCached', (_e, assetId) => cacheStore.readCached(assetId));
    ipcMain.handle('dam:removeCached', (_e, assetId) => cacheStore.removeCached(assetId));
    ipcMain.handle('dam:listCached', () => cacheStore.listCached());

    // 桌面端采集 IPC：指定文件夹抓取 / 扫描 / 读字节 / 监听变化
    // P1-4 解耦：经 agent/collectorAgent.cjs 调用采集核心，明确 agent→collector 边界
    // （当前 in-process 模式，与直接 require collector.cjs 行为等价；预留 spawn 模式便于切壳/远程复用）
    const { scan } = require('./agent/collectorAgent.cjs');
    const watchMap = new Map(); // watchId -> { watcher, timer }
    // #13 修复：记录用户已扫描授权的目录集合，readFileBytes 仅允许读取这些目录内文件
    const allowedScanRoots = new Set();
    ipcMain.handle('dam:selectFolder', async () => {
      const res = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
      if (res.canceled || !res.filePaths.length) return null;
      return res.filePaths[0];
    });
    ipcMain.handle('dam:scanFolder', async (_e, folderPath) => {
      if (!folderPath || typeof folderPath !== 'string') return [];
      const resolved = path.resolve(folderPath);
      allowedScanRoots.add(resolved);
      return scan(folderPath, { max: 5000 });
    });
    ipcMain.handle('dam:readFileBytes', async (_e, filePath) => {
      if (!filePath || typeof filePath !== 'string') return null;
      const resolved = path.resolve(filePath);
      // 校验 filePath 必须在已扫描授权的某个目录内（防越权读取任意文件）
      const allowed = Array.from(allowedScanRoots).some((root) => {
        const rel = path.relative(root, resolved);
        return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
      });
      if (!allowed) {
        console.warn(`[dam:readFileBytes] 拒绝读取未授权路径: ${filePath}`);
        return null;
      }
      try {
        return await fs.promises.readFile(resolved);
      } catch {
        return null;
      }
    });
    ipcMain.handle('dam:watchStart', (_e, watchId, folderPath) => {
      if (!folderPath || watchMap.has(watchId)) return false;
      let watcher;
      try {
        watcher = fs.watch(folderPath, { recursive: true }, () => {
          const w = watchMap.get(watchId);
          if (!w) return;
          if (w.timer) clearTimeout(w.timer);
          w.timer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.webContents.send('dam:fileChanged', { watchId });
            }
          }, 800);
        });
      } catch {
        return false;
      }
      watchMap.set(watchId, { watcher, timer: null });
      return true;
    });
    ipcMain.handle('dam:watchStop', (_e, watchId) => {
      const w = watchMap.get(watchId);
      if (!w) return false;
      try { w.watcher.close(); } catch {}
      if (w.timer) clearTimeout(w.timer);
      watchMap.delete(watchId);
      return true;
    });

    // 创建窗口
    createWindow();

    // 系统托盘（关闭主窗口时最小化到托盘，避免应用"完全隐藏"找不到入口）
    try { createTray(); } catch (e) { console.error('托盘创建失败:', e.message); }

    // 桌面宠物浮窗（默认不自动启动，用户可从托盘右键「桌面宠物」或设置里手动唤出）
    // try { createPetWindow(); } catch (e) { console.error('宠物浮窗启动失败:', e.message); }
  } catch (err) {
    console.error('❌ 启动失败:', err.message);
    const { dialog } = require('electron');
    dialog.showErrorBox(
      '启动失败',
      `后端启动失败：${err.message}\n\n日志位置：${getLogPath()}`
    );
    app.quit();
  }
});

// 所有窗口关闭时退出（macOS 除外）。
// 有托盘时：主窗口隐藏不触发 window-all-closed（浮窗仍在）；仅当 isQuitting 真正退出。
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && isQuitting) {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendReady) {
    createWindow();
  }
});

// 退出前杀掉后端（同步等待，确保端口在进程退出前释放，避免下次启动误判"已在运行"）
app.on('before-quit', () => {
  // 标记正在退出，让 mainWindow 的 close 监听放行
  isQuitting = true;
  // 销毁所有浮窗，确保 window-all-closed 能触发
  for (const w of [petWindow, stickyWindow, countdownWindow, todoWindow, reminderWindow, wallpaperWindow]) {
    if (w && !w.isDestroyed()) {
      try { w.destroy(); } catch { /* ignore */ }
    }
  }
  if (tray && !tray.isDestroyed()) {
    try { tray.destroy(); } catch { /* ignore */ }
    tray = null;
  }
  if (backendProcess) {
    console.log('终止后端进程...');
    try {
      if (process.platform === 'win32') {
        // Windows: 使用 taskkill /f /t 强杀进程树，spawnSync 同步等待杀完再退出
        spawnSync('taskkill', ['/pid', backendProcess.pid, '/f', '/t']);
      } else {
        backendProcess.kill('SIGTERM');
      }
    } catch (e) {
      console.error('杀死后端失败:', e.message);
    }
    backendProcess = null;
  }
});
