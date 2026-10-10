/**
 * 种子脚本：插入 Android APK 发布记录
 * 用法：node seed-android-release.cjs <version> <sizeMB> <apkUrl> <apkMd5> <notes>
 * 示例：node seed-android-release.cjs 1.0.2 45.2 https://47.116.59.141/apk/greenrhino-latest.apk d41d8cd98f00b204e9800998ecf8427e "底部导航栏放大 + 顶部导航固定"
 */
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function main() {
  const [, , version, sizeMB, apkUrl, apkMd5, notes = ''] = process.argv
  if (!version || !sizeMB || !apkUrl || !apkMd5) {
    console.error('用法: node seed-android-release.cjs <version> <sizeMB> <apkUrl> <apkMd5> [notes]')
    process.exit(1)
  }

  // 先把所有 isLatest 置 false
  await prisma.androidRelease.updateMany({ data: { isLatest: false } })

  // 插入新版本
  const r = await prisma.androidRelease.create({
    data: {
      version,
      isLatest: true,
      sizeMB: parseFloat(sizeMB),
      apkUrl,
      apkMd5,
      notes,
      forceUpdate: false,
    },
  })
  console.log(`✅ Seed 成功: ${r.version} (${r.sizeMB} MB)`)
}

main().catch(console.error).finally(() => prisma.$disconnect())
