// 生成 PWA 图标（jimp v1 API）
const { Jimp } = require('jimp');
const fs = require('fs');
const path = require('path');

(async () => {
  const src = path.join(__dirname, 'public', 'pwa-512x512.jpg');
  if (!fs.existsSync(src)) {
    console.error('源图不存在:', src);
    process.exit(1);
  }
  const img = await Jimp.read(src);

  // 512x512 PNG（主图标）
  await img.clone().write(path.join(__dirname, 'public', 'pwa-512x512.png'));
  console.log('✅ pwa-512x512.png');

  // 192x192 PNG
  const img192 = img.clone().resize({ w: 192, h: 192 });
  await img192.write(path.join(__dirname, 'public', 'pwa-192x192.png'));
  console.log('✅ pwa-192x192.png');

  // favicon 32x32
  const img32 = img.clone().resize({ w: 32, h: 32 });
  await img32.write(path.join(__dirname, 'public', 'favicon-32x32.png'));
  console.log('✅ favicon-32x32.png');

  // 删除 jpg 源文件
  fs.unlinkSync(src);
  console.log('✅ 清理源 jpg');

  console.log('\n图标生成完成:');
  fs.readdirSync(path.join(__dirname, 'public'))
    .filter(f => f.startsWith('pwa') || f.startsWith('favicon'))
    .forEach(f => console.log(' -', f, `(${fs.statSync(path.join(__dirname, 'public', f)).size} bytes)`));
})().catch(e => { console.error(e); process.exit(1); });
