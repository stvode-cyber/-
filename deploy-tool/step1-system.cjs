// 部署步骤1：安装系统级依赖（Node.js + PM2 + Nginx）
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function sshExec(conn, cmd, timeout = 300000) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd.substring(0, 100)}${cmd.length > 100 ? '...' : ''}`);
    conn.exec(cmd, { pty: true }, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => { stdout += d.toString(); process.stdout.write(d); });
      stream.stderr.on('data', (d) => { stderr += d.toString(); process.stderr.write(d); });
      const timer = setTimeout(() => {
        reject(new Error(`命令超时 (${timeout}ms): ${cmd.substring(0, 80)}`));
      }, timeout);
      stream.on('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else reject(new Error(`exit ${code}: ${stderr || stdout}`));
      });
    });
  });
}

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { log('✅ SSH 已连接'); resolve(c); });
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  try {
    log('=== [1/3] 安装 Node.js 20.x ===');
    await sshExec(conn, `if ! command -v node &>/dev/null; then
      curl -fsSL https://rpm.nodesource.com/setup_20.x | bash - && 
      yum install -y nodejs;
    else
      echo "Node已安装: $(node --version)";
    fi`);
    await sshExec(conn, 'node --version && npm --version');

    log('=== [2/3] 安装 PM2 ===');
    await sshExec(conn, 'npm install -g pm2 2>&1 | tail -3 && pm2 --version');

    log('=== [3/3] 安装 Nginx ===');
    await sshExec(conn, `if ! command -v nginx &>/dev/null; then
      yum install -y nginx;
    else
      echo "Nginx已安装";
    fi`);
    await sshExec(conn, 'nginx -v 2>&1');

    log('✅ 系统依赖安装完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
