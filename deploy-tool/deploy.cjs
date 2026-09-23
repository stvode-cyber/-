// 部署脚本：使用 ssh2 实现 SSH 连接、文件传输和远程命令执行
// 用法：node deploy.cjs <step>
// step: test | upload | exec | all

const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

// ---- 服务器配置 ----
const HOST = '8.154.45.247';
const PORT = 22;
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';
const LOCAL_TAR = path.resolve(__dirname, '..', 'app-aie-deploy.tar.gz');

// ---- 工具函数 ----
function log(msg) {
  console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function sshExec(conn, cmd, options = {}) {
  return new Promise((resolve, reject) => {
    log(`> ${cmd}`);
    conn.exec(cmd, options, (err, stream) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      stream.on('data', (d) => {
        stdout += d.toString();
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        stderr += d.toString();
        process.stderr.write(d);
      });
      stream.on('exit', (code, signal) => {
        if (code === 0) resolve({ stdout, stderr, code });
        else reject(new Error(`Command exit ${code}: ${stderr || stdout}`));
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
      ws.on('close', () => {
        const size = fs.statSync(localPath).size;
        log(`✅ 上传完成 ${(size / 1024 / 1024).toFixed(2)} MB`);
        resolve();
      });
      ws.on('error', reject);
      rs.on('error', reject);
    });
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => {
      log('✅ SSH 已连接');
      resolve(conn);
    });
    conn.on('error', reject);
    conn.connect({
      host: HOST,
      port: PORT,
      username: USER,
      privateKey: PRIVATE_KEY,
      readyTimeout: 30000,
    });
  });
}

// ---- 步骤 ----
async function stepTest() {
  const conn = await connect();
  await sshExec(conn, 'uname -a');
  await sshExec(conn, 'cat /etc/os-release | head -3');
  await sshExec(conn, 'which nginx node npm npx 2>/dev/null || echo "部分工具未安装"');
  await sshExec(conn, 'df -h / | tail -1');
  await sshExec(conn, 'free -m | head -2');
  conn.end();
  log('✅ 测试完成');
}

async function stepUpload() {
  const conn = await connect();
  // 准备远程目录
  await sshExec(conn, `mkdir -p ${REMOTE_DIR}`);
  // 上传 tar 包
  await sshUpload(conn, LOCAL_TAR, `${REMOTE_DIR}/app-aie-deploy.tar.gz`);
  // 解压
  await sshExec(conn, `cd ${REMOTE_DIR} && tar -xzf app-aie-deploy.tar.gz --strip-components=1 && ls -la`);
  conn.end();
  log('✅ 上传并解压完成');
}

async function stepExec() {
  const conn = await connect();
  // 执行部署脚本（分步执行，便于观察）
  log('=== 部署步骤开始 ===');

  // 1. 安装 Node.js（如果未安装）
  log('[1/N] 检查并安装 Node.js...');
  await sshExec(conn, `bash -c 'if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && 
    apt-get install -y nodejs;
  else
    echo "Node.js 已安装: $(node --version)";
  fi'`);

  // 2. 安装 PM2
  log('[2/N] 安装 PM2...');
  await sshExec(conn, `bash -c 'npm install -g pm2 2>&1 | tail -3; pm2 --version'`);

  // 3. 安装 Nginx
  log('[3/N] 安装 Nginx...');
  await sshExec(conn, `bash -c 'if ! command -v nginx &> /dev/null; then
    apt-get update && apt-get install -y nginx;
  else
    echo "Nginx 已安装: $(nginx -v 2>&1)";
  fi'`);

  // 4. 后端构建
  log('[4/N] 后端依赖安装与构建...');
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npm install --omit=dev 2>&1 | tail -5`);
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npm install --include=dev 2>&1 | tail -5`);
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx prisma generate 2>&1 | tail -3`);

  // 5. 配置环境变量
  log('[5/N] 配置后端环境变量...');
  const jwtSecret = require('crypto').randomBytes(32).toString('hex');
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && cp -f .env.example .env && sed -i 's|JWT_SECRET=.*|JWT_SECRET=${jwtSecret}|' .env && sed -i 's|NODE_ENV=.*|NODE_ENV=production|' .env && sed -i 's|DATABASE_URL=.*|DATABASE_URL=file:./prisma/prod.db|' .env && sed -i 's|CORS_ORIGIN=.*|CORS_ORIGIN=http://${HOST}|' .env && grep -E "JWT_SECRET|NODE_ENV|DATABASE_URL|CORS_ORIGIN" .env`);

  // 6. 初始化数据库
  log('[6/N] 初始化数据库...');
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx prisma db push --accept-data-loss 2>&1 | tail -10`);
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx prisma generate 2>&1 | tail -3`);
  // 种子数据（仅首次）
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && if [ ! -f .seeded ]; then
    npx tsx prisma/seed.ts 2>&1 | tail -5 || echo "⚠️ seed 可能已存在";
    touch .seeded;
  else
    echo "✅ 种子数据已存在";
  fi`);

  // 7. 构建后端 TypeScript
  log('[7/N] 编译后端 TypeScript...');
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && npx tsc 2>&1 | tail -10`);
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && ls dist/index.js && echo "✅ 后端编译完成"`);

  // 8. 构建前端
  log('[8/N] 前端依赖安装与构建...');
  await sshExec(conn, `cd ${REMOTE_DIR}/frontend && npm install 2>&1 | tail -5`);
  // 修改前端 vite 配置以适配生产环境（API 走相对路径，无需改 baseURL）
  await sshExec(conn, `cd ${REMOTE_DIR}/frontend && npx vite build 2>&1 | tail -15`);
  await sshExec(conn, `cd ${REMOTE_DIR}/frontend && ls dist/index.html && echo "✅ 前端构建完成"`);

  // 9. 部署前端到 Nginx 目录
  log('[9/N] 部署前端静态资源...');
  await sshExec(conn, `mkdir -p /var/www/aie-frontend && rm -rf /var/www/aie-frontend/* && cp -r ${REMOTE_DIR}/frontend/dist/* /var/www/aie-frontend/ && ls /var/www/aie-frontend/`);

  // 10. 配置 Nginx
  log('[10/N] 配置 Nginx...');
  const nginxConf = `server {
    listen 80;
    server_name ${HOST} localhost;
    client_max_body_size 20m;

    root /var/www/aie-frontend;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
}`;
  fs.writeFileSync(path.join(__dirname, 'nginx.conf'), nginxConf);
  await sshUpload(conn, path.join(__dirname, 'nginx.conf'), '/etc/nginx/conf.d/aie.conf');
  await sshExec(conn, `nginx -t 2>&1 && systemctl reload nginx && echo "✅ Nginx 已重载"`);

  // 11. 启动后端（PM2）
  log('[11/N] 启动后端 (PM2)...');
  await sshExec(conn, `cd ${REMOTE_DIR}/backend && pm2 delete aie-backend 2>/dev/null; pm2 start ecosystem.config.cjs && pm2 save 2>&1 | tail -5`);
  await sshExec(conn, `pm2 list`);

  // 12. 配置 PM2 开机自启
  log('[12/N] 配置开机自启...');
  await sshExec(conn, `pm2 startup systemd -y --service-name pm2-root 2>&1 | tail -3 || echo "⚠️ 开机自启配置可能需要手动执行"`);
  await sshExec(conn, `systemctl enable nginx 2>&1 | tail -2 || true`);

  // 13. 最终验证
  log('[13/N] 最终验证...');
  await sshExec(conn, `sleep 2 && curl -s http://127.0.0.1:3001/health && echo ""`);
  await sshExec(conn, `curl -s -o /dev/null -w "前端 HTTP %{http_code}\\n" http://127.0.0.1/`);
  await sshExec(conn, `curl -s -o /dev/null -w "API HTTP %{http_code}\\n" http://127.0.0.1/api/v1/auth/me`);

  conn.end();
  log('=== 部署完成 ===');
  log(`🌐 访问地址: http://${HOST}`);
}

// ---- 入口 ----
const step = process.argv[2] || 'all';
(async () => {
  try {
    if (step === 'test') await stepTest();
    else if (step === 'upload') await stepUpload();
    else if (step === 'exec') await stepExec();
    else if (step === 'all') {
      await stepTest();
      await stepUpload();
      await stepExec();
    } else {
      console.log('用法: node deploy.cjs <test|upload|exec|all>');
      process.exit(1);
    }
    process.exit(0);
  } catch (e) {
    console.error('❌ 部署失败:', e.message);
    if (e.stack) console.error(e.stack);
    process.exit(1);
  }
})();
