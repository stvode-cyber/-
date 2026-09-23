// 部署步骤5：上传 PWA 前端到服务器并验证
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');
const REMOTE_DIR = '/root/APP-AIE';
const LOCAL_FRONTEND_DIST = path.resolve(__dirname, '..', 'frontend', 'dist');

function log(msg) { console.log(`[${new Date().toLocaleTimeString()}] ${msg}`); }

function sshExec(conn, cmd, timeout = 120000) {
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

function sshUploadDir(conn, localDir, remoteDir) {
  return new Promise((resolve, reject) => {
    conn.sftp((err, sftp) => {
      if (err) return reject(err);

      function uploadDir(src, dest) {
        return new Promise((resolve, reject) => {
          sftp.mkdir(dest, () => {
            fs.readdir(src, (err, items) => {
              if (err) return reject(err);
              Promise.all(items.map(item => {
                const srcPath = path.join(src, item);
                const destPath = path.posix.join(dest, item);
                return new Promise((resolve, reject) => {
                  fs.stat(srcPath, (err, stat) => {
                    if (err) return reject(err);
                    if (stat.isDirectory()) {
                      uploadDir(srcPath, destPath).then(resolve).catch(reject);
                    } else {
                      const rs = fs.createReadStream(srcPath);
                      const ws = sftp.createWriteStream(destPath);
                      rs.pipe(ws);
                      ws.on('close', resolve);
                      ws.on('error', reject);
                      rs.on('error', reject);
                    }
                  });
                });
              })).then(resolve).catch(reject);
            });
          });
        });
      }

      uploadDir(localDir, remoteDir).then(() => {
        log(`✅ 上传目录完成: ${localDir} → ${remoteDir}`);
        resolve();
      }).catch(reject);
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
    log('=== [1/4] 清空旧前端 ===');
    await sshExec(conn, `rm -rf /var/www/aie-frontend/* && ls /var/www/aie-frontend/`);

    log('=== [2/4] 上传新前端（含 PWA 资源）===');
    await sshUploadDir(conn, LOCAL_FRONTEND_DIST, '/var/www/aie-frontend');

    log('=== [3/4] 验证文件 ===');
    await sshExec(conn, `ls -la /var/www/aie-frontend/ | head -15`);
    await sshExec(conn, `ls -la /var/www/aie-frontend/sw.js /var/www/aie-frontend/manifest.webmanifest /var/www/aie-frontend/pwa-192x192.png /var/www/aie-frontend/pwa-512x512.png 2>&1`);

    log('=== [4/4] Nginx 检查 + 外部访问测试 ===');
    // Nginx 已配置 try_files，无需修改
    await sshExec(conn, `curl -s -o /dev/null -w "首页 HTTP %{http_code}\\n" http://127.0.0.1/`);
    await sshExec(conn, `curl -s -o /dev/null -w "manifest HTTP %{http_code}\\n" http://127.0.0.1/manifest.webmanifest`);
    await sshExec(conn, `curl -s -o /dev/null -w "sw.js HTTP %{http_code}\\n" http://127.0.0.1/sw.js`);
    await sshExec(conn, `curl -s -o /dev/null -w "图标 HTTP %{http_code}\\n" http://127.0.0.1/pwa-192x192.png`);

    log('✅ PWA 部署完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
