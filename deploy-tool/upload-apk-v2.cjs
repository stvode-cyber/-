// TODO: [SNI被封] 预防：内测下载链接必须用 https://47.116.59.141/apk/ 直连 IP，域名 lujax.fun 因 SNI 过滤不可用；nginx 必须显式加 location ^~ /apk/
// TODO: [Server备份丢失] 预防：每次 prod.db 备份必须同时存在于 D:\源码存档\助理项目\服务器存档\prod-db-备份\ 和远程服务器 /root/backend/prisma/，保留至少 3 份不同日期
const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

const HOST = '47.116.59.141';
const USER = 'root';
const KEY = process.env.USERPROFILE + '\\.ssh\\id_ed25519';
const REMOTE_DIR = '/opt/greenrhino_download';

const ROOT = 'd:\\源码存档\\助理项目\\助理项目\\APP-AIE';
const FILES = [
  { local: path.join(ROOT, 'electron', 'release-v16', '绿角犀-Setup-1.0.3.exe'),     remote: '绿角犀-Setup-1.0.3.exe' },
  { local: path.join(ROOT, 'electron', 'release-v16', '绿角犀-Portable-1.0.3.exe'), remote: '绿角犀-Portable-1.0.3.exe' },
  { local: path.join(ROOT, 'frontend', 'android', 'app', 'build', 'outputs', 'apk', 'release', '绿角犀-安卓端-v1.0.3-正式签名.apk'), remote: '绿角犀-安卓端-v1.0.3-正式签名.apk' },
];

function connect() {
  return new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c));
    c.on('error', reject);
    c.connect({ host: HOST, port: 22, username: USER, privateKey: fs.readFileSync(KEY), readyTimeout: 30000 });
  });
}

function uploadFile(sftp, local, remote) {
  return new Promise((resolve, reject) => {
    const stat = fs.statSync(local);
    const name = path.basename(local);
    console.log(`\n⬆  uploading ${name} (${(stat.size/1024/1024).toFixed(1)} MB)`);
    const start = Date.now();
    let lastPct = -1;
    sftp.fastPut(local, REMOTE_DIR + '/' + remote, {
      step: (transferred) => {
        const pct = Math.floor(transferred / stat.size * 100);
        if (pct !== lastPct) {
          lastPct = pct;
          const mbDone = (transferred/1024/1024).toFixed(0);
          const speed = transferred / ((Date.now()-start)/1000);
          const speedStr = (speed/1024).toFixed(0) + ' KB/s';
          process.stdout.write(`  ${pct}% (${mbDone}MB, ${speedStr})\r`);
        }
      },
      concurrency: 4,
    }, (err) => {
      if (err) { reject(err); return; }
      const sec = ((Date.now()-start)/1000).toFixed(0);
      console.log(`  ✅ ${name} done in ${sec}s`);
      resolve();
    });
  });
}

async function main() {
  const conn = await connect();
  console.log('✅ SSH connected');
  const sftp = await new Promise((res, rej) => conn.sftp((e, s) => e ? rej(e) : res(s)));

  for (const f of FILES) {
    if (!fs.existsSync(f.local)) { console.log(`⚠  skip missing: ${f.local}`); continue; }
    try {
      await uploadFile(sftp, f.local, f.remote);
    } catch (e) {
      console.error(`❌ ${path.basename(f.local)}: ${e.message}`);
    }
  }

  conn.exec(`ls -lh ${REMOTE_DIR} | grep 1.0.3`, (err, stream) => {
    if (err) { conn.end(); return; }
    let out = '';
    stream.on('data', d => out += d);
    stream.on('close', () => { console.log('\n📦 final listing:\n' + out); conn.end(); });
  });
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });

