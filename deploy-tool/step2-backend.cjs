// 部署步骤2：构建后端（依赖安装 + Prisma生成 + 数据库初始化 + TypeScript编译）
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function sshExec(conn, cmd, timeout = 600000) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd.substring(0, 120)}${cmd.length > 120 ? '...' : ''}`);
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

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { log('✅ SSH 已连接'); resolve(c); });
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  try {
    log('=== [1/5] 后端依赖安装 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && npm install 2>&1 | tail -10`);

    log('=== [2/5] 配置环境变量 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && cp -f .env.example .env`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && sed -i 's|JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|' .env`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && sed -i 's|NODE_ENV=.*|NODE_ENV=production|' .env`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && sed -i 's|DATABASE_URL=.*|DATABASE_URL=file:./prisma/prod.db|' .env`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && sed -i 's|CORS_ORIGIN=.*|CORS_ORIGIN=http://${HOST}|' .env`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && grep -E "JWT_SECRET|NODE_ENV|DATABASE_URL|CORS_ORIGIN" .env`);

    log('=== [3/5] Prisma 生成客户端 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx prisma generate 2>&1 | tail -5`);

    log('=== [4/5] 初始化数据库 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx prisma db push --accept-data-loss 2>&1 | tail -10`);
    // 种子数据
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && if [ ! -f .seeded ]; then
      npx tsx prisma/seed.ts 2>&1 | tail -5 || echo "⚠️ seed 可能已存在";
      touch .seeded;
    else
      echo "✅ 种子数据已存在";
    fi`);

    log('=== [5/5] 编译 TypeScript ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx tsc 2>&1 | tail -10`);
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && ls -la dist/index.js`);

    log('✅ 后端构建完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
