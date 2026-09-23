// 部署步骤6：上传修复后的前端+后端，重启后端
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '8.154.45.247';
const USER = 'root';
const PRIVATE_KEY = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');

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
    log('=== [1/5] 上传后端代码 ===');
    // 只上传 dist 目录和路由文件
    await sshUploadDir(conn, path.resolve(__dirname, '..', 'backend', 'dist'), '/root/APP-AIE/backend/dist');

    log('=== [2/5] 上传前端代码 ===');
    await sshExec(conn, `rm -rf /var/www/aie-frontend/*`);
    await sshUploadDir(conn, path.resolve(__dirname, '..', 'frontend', 'dist'), '/var/www/aie-frontend');

    log('=== [3/5] 重启后端 PM2 ===');
    await sshExec(conn, `cd /root/APP-AIE/backend && pm2 restart aie-backend --update-env 2>&1 | tail -5`);

    log('=== [4/5] 等待后端启动 ===');
    await new Promise(r => setTimeout(r, 3000));
    await sshExec(conn, `curl -s http://127.0.0.1:3001/health`);

    log('=== [5/5] 外部访问验证 ===');
    await sshExec(conn, `curl -s -o /dev/null -w "前端 HTTP %{http_code}\\n" http://127.0.0.1/`);
    // #14 修复：不再硬编码 admin 密码做健康检查；改为调用 /health（无需认证）
    await sshExec(conn, `curl -s -o /dev/null -w "后端健康 HTTP %{http_code}\\n" http://127.0.0.1:3001/health`);

    log('✅ 部署完成');
    conn.end();
    process.exit(0);
  } catch (e) {
    console.error('❌ 失败:', e.message);
    conn.end();
    process.exit(1);
  }
}

main();
