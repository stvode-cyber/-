// 部署步骤8：增量同步前端源文件并重新构建部署
// 用法：node step8-sync-frontend.cjs <localFile1> [localFile2 ...]
//   参数：本地前端文件路径（相对 frontend/ 或绝对路径）
//   作用：上传指定前端文件到服务器 /root/APP-AIE/frontend/ 对应位置，
//         然后在服务器上重新执行 vite build，并把 dist 同步到 Nginx 目录。
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';
const REMOTE_FRONTEND = `${REMOTE_DIR}/frontend`;
const WEB_DIR = '/var/www/aie-frontend';

const FRONTEND_ROOT = path.resolve(__dirname, '..', 'frontend');

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function sshExec(conn, cmd, timeout = 600000) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd.substring(0, 160)}${cmd.length > 160 ? '...' : ''}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
      const timer = setTimeout(() => reject(new Error(`命令超时 (${timeout}ms)`)), timeout);
      stream.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`exit ${code}: ${stderr || stdout}`));
      });
    });
  });
}

function sshUpload(conn, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    log(`上传 ${localPath} → ${remotePath}`);
    conn.sftp((err, sftp) => {
      if (err) return reject(err);
      const rs = fs.createReadStream(localPath);
      const ws = sftp.createWriteStream(remotePath);
      rs.pipe(ws);
      ws.on('close', () => { log('✅ 上传完成'); resolve(); });
      ws.on('error', reject);
      rs.on('error', reject);
    });
  });
}

/** 把本地路径转换为相对 frontend/ 的相对路径 */
function toFrontendRel(p) {
  const abs = path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
  const rel = path.relative(FRONTEND_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`文件不在 frontend/ 目录下: ${p} (abs=${abs})`);
  }
  // 统一为 POSIX 风格（远程 Linux）
  return rel.split(path.sep).join('/');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('用法: node step8-sync-frontend.cjs <localFile1> [localFile2 ...]');
    console.error('  localFileN: 相对 frontend/ 的路径，如 src/pages/HomePage.tsx');
    process.exit(1);
  }

  // 解析并校验本地文件
  const files = args.map((p) => {
    const rel = toFrontendRel(p);
    const localAbs = path.join(FRONTEND_ROOT, rel);
    if (!fs.existsSync(localAbs)) throw new Error(`本地文件不存在: ${localAbs}`);
    return { rel, localAbs };
  });

  log(`准备同步 ${files.length} 个文件:`);
  files.forEach((f) => log(`  - ${f.rel}`));

  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { log('✅ SSH 已连接'); resolve(c); });
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  try {
    // 1. 校验服务器目录
    log('=== [1/5] 校验服务器目录 ===');
    await sshExec(conn, `test -d ${REMOTE_FRONTEND}/src && echo OK || echo NOT_FOUND`);

    // 2. 备份原文件 + 上传新文件
    log('=== [2/5] 备份并上传文件 ===');
    for (const f of files) {
      const remoteFile = `${REMOTE_FRONTEND}/${f.rel}`;
      const backupFile = `${remoteFile}.bak-${Date.now()}`;
      await sshExec(conn, `cp -f ${remoteFile} ${backupFile} 2>/dev/null || true`);
      // 确保远程子目录存在
      const remoteDir = path.posix.dirname(remoteFile);
      await sshExec(conn, `mkdir -p ${remoteDir}`);
      await sshUpload(conn, f.localAbs, remoteFile);
    }

    // 3. 在服务器上重新构建前端
    log('=== [3/5] 服务器端 vite build ===');
    await sshExec(conn, `cd ${REMOTE_FRONTEND} && npx vite build 2>&1 | tail -25`);
    await sshExec(conn, `ls -la ${REMOTE_FRONTEND}/dist/index.html`);

    // 4. 部署到 Nginx 目录
    log('=== [4/5] 部署到 Nginx 目录 ===');
    await sshExec(conn, `mkdir -p ${WEB_DIR} && rm -rf ${WEB_DIR}/* && cp -r ${REMOTE_FRONTEND}/dist/* ${WEB_DIR}/ && ls ${WEB_DIR}/`);

    // 5. 校验前端可访问
    log('=== [5/5] 校验前端 ===');
    await sshExec(conn, `curl -s -o /dev/null -w "前端 HTTP %{http_code}\\n" http://127.0.0.1/`);

    log('✅ 增量同步与重新构建完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
