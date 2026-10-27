const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const prisma = new PrismaClient();

async function main() {
  const apkUrl = 'http://47.116.59.141/apk/greenrhino-1.0.2.apk';
  const version = '1.0.2';
  const notes = '1.0.2 更新：自动更新全链路打通，修复 CapacitorHttp 拦截 fetch 问题';

  // 1. 算服务器上 APK 的 sizeMB 和 md5
  const localApkPath = path.join(__dirname, 'greenrhino-1.0.2.apk');
  let sizeMB, apkMd5;

  try {
    // 先试本地有文件就用本地算（npm run seed 场景）
    const buf = fs.readFileSync(localApkPath);
    sizeMB = +(buf.length / 1024 / 1024).toFixed(2);
    apkMd5 = crypto.createHash('md5').update(buf).digest('hex');
    console.log(`[seed] 本地 APK: sizeMB=${sizeMB} md5=${apkMd5}`);
  } catch (e) {
    // 本地没文件，用已知值（从 SCP 日志：13188164 bytes）
    sizeMB = 12.58;
    // 服务器上有 APK 就从服务器读
    const serverPath = '/usr/share/nginx/html/apk/greenrhino-1.0.2.apk';
    try {
      const buf = fs.readFileSync(serverPath);
      apkMd5 = crypto.createHash('md5').update(buf).digest('hex');
      console.log(`[seed] 服务器 APK: sizeMB=${sizeMB} md5=${apkMd5}`);
    } catch (e2) {
      console.error('[seed] 服务器也没 APK！请先 SCP');
      process.exit(1);
    }
  }

  // 2. upsert
  const release = await prisma.androidRelease.upsert({
    where: { version },
    update: {
      isLatest: true,
      sizeMB,
      apkUrl,
      apkMd5,
      notes,
      forceUpdate: false,
    },
    create: {
      version,
      isLatest: true,
      sizeMB,
      apkUrl,
      apkMd5,
      notes,
      forceUpdate: false,
    },
  });

  // 3. 把其他版本的 isLatest 设为 false（保持只有一个 latest）
  await prisma.androidRelease.updateMany({
    where: { version: { not: version }, isLatest: true },
    data: { isLatest: false },
  });

  console.log(`[seed] upsert OK: id=${release.id} version=${release.version} isLatest=${release.isLatest}`);

  // 4. 查最终状态
  const all = await prisma.androidRelease.findMany({ orderBy: { publishedAt: 'desc' } });
  console.log('[seed] android_releases 表:');
  for (const r of all) {
    console.log(`  ${r.version} latest=${r.isLatest} size=${r.sizeMB}MB url=${r.apkUrl}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
