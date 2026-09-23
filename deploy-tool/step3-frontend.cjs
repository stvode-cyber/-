// 部署步骤3：构建前端 + 部署静态资源 + 配置Nginx + 启动后端(PM2)
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';

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

async function main() {
  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => { log('✅ SSH 已连接'); resolve(c); });
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: PRIVATE_KEY, readyTimeout: 30000 });
  });

  try {
    log('=== [1/6] 前端依赖安装 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/frontend && npm install 2>&1 | tail -10`);

    log('=== [2/6] 构建前端 ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/frontend && npx vite build 2>&1 | tail -20`);
    await sshExec(conn, `cd ${REMOTE_DIR}/frontend && ls -la dist/index.html`);

    log('=== [3/6] 部署前端到 Nginx 目录 ===');
    await sshExec(conn, `mkdir -p /var/www/aie-frontend && rm -rf /var/www/aie-frontend/* && cp -r ${REMOTE_DIR}/frontend/dist/* /var/www/aie-frontend/ && ls /var/www/aie-frontend/`);

    log('=== [4/6] 配置 Nginx ===');
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
    await sshExec(conn, `nginx -t 2>&1 && systemctl enable nginx && systemctl restart nginx && echo "✅ Nginx 已启动"`);

    log('=== [5/6] 启动后端 (PM2) ===');
    await sshExec(conn, `cd ${REMOTE_DIR}/backend && pm2 delete aie-backend 2>/dev/null; pm2 start ecosystem.config.cjs && pm2 save 2>&1 | tail -5`);
    await sshExec(conn, `pm2 list`);

    log('=== [6/6] 配置开机自启 ===');
    await sshExec(conn, `pm2 startup systemd -y --service-name pm2-root 2>&1 | tail -3`);
    await sshExec(conn, `pm2 save 2>&1 | tail -2`);

    log('✅ 前端构建与部署完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
