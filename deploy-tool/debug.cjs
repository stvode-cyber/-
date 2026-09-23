// 调试 SSH 连接：打印详细的握手与认证信息
const { Client } = require('ssh2');

const conn = new Client();

conn.on('ready', () => {
  console.log('✅ 连接成功');
  conn.exec('whoami', (err, stream) => {
    if (err) { console.error('exec 错误:', err); process.exit(1); }
    let out = '';
    stream.on('data', (d) => out += d);
    stream.on('exit', () => { console.log('whoami:', out.trim()); conn.end(); process.exit(0); });
  });
});

conn.on('error', (err) => {
  console.error('❌ 连接错误:', err.message);
  console.error(err);
  process.exit(1);
});

conn.on('handshake', () => console.log('握手完成'));
conn.on('change password', () => console.log('收到 change password 事件'));
conn.on('keyboard-interactive', (name, instructions, lang, prompts, finish) => {
  console.log('keyboard-interactive 事件:');
  console.log('  name:', name);
  console.log('  instructions:', instructions);
  console.log('  prompts:', prompts);
  // 回答密码
  finish(['trnepwq0101A']);
});

console.log('开始连接 8.154.45.247:22 root...');
conn.connect({
  host: '8.154.45.247',
  port: 22,
  username: 'root',
  password: 'trnepwq0101A',
  readyTimeout: 30000,
  debug: (msg) => console.log('[DEBUG]', msg),
  algorithms: {
    serverHostKey: ['ssh-rsa', 'ssh-ed25519', 'ecdsa-sha2-nistp256', 'ssh-dss'],
  },
});
