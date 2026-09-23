// 使用本机生成的私钥测试 SSH 连接
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const privateKey = fs.readFileSync(path.join(process.env.USERPROFILE, '.ssh', 'id_ed25519'), 'utf8');

const conn = new Client();
console.log('使用私钥连接 8.154.45.247...');

conn.on('ready', () => {
  console.log('✅ SSH 连接成功');
  conn.exec('whoami && hostname && uname -a', (err, stream) => {
    if (err) { console.error(err); process.exit(1); }
    let out = '';
    stream.on('data', (d) => { out += d; process.stdout.write(d); });
    stream.stderr.on('data', (d) => process.stderr.write(d));
    stream.on('exit', () => {
      conn.end();
      process.exit(0);
    });
  });
});

conn.on('error', (err) => {
  console.error('❌ 连接失败:', err.message);
  process.exit(1);
});

conn.connect({
  host: '8.154.45.247',
  port: 22,
  username: 'root',
  privateKey,
  readyTimeout: 30000,
});
