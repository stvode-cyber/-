import { PrismaClient } from '@prisma/client'

/**
 * Prisma 客户端单例
 *
 * 为什么用全局单例：
 * - 开发环境下 tsx watch 会热重载，每次重载会重新 import 模块
 * - 如果不缓存到 globalThis，会创建多个 PrismaClient 实例
 * - 多个实例会导致连接池耗尽、日志重复打印、事务冲突等问题
 *
 * 日志级别：
 * - 开发环境：warn + error
 * - 生产环境：error
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

// Electron 打包环境修复：
// Prisma 默认使用 SQLite WAL 模式，写入时需创建 -wal/-shm 文件。
// 在 ELECTRON_RUN_AS_NODE 模式下，若工作目录只读或临时目录不可写，
// 会导致 SQLITE_CANTOPEN (code 14) 写入失败。
// 切换为 DELETE journal mode，写操作直接回写到主 .db 文件，无需 -wal 文件。
//
// 重要：导出 Promise 供 index.ts 在启动调度器前 await，
// 避免 CountdownScheduler 首次扫描在 PRAGMA 执行前就尝试写入（竞态条件）。
export const prismaReady: Promise<void> =
  process.env.ELECTRON_RUN === '1'
    ? prisma.$queryRaw`PRAGMA journal_mode=DELETE`
        .then((result) => {
          // $queryRaw 返回数组，如 [{ journal_mode: 'delete' }]
          const mode = Array.isArray(result) && result[0]?.journal_mode
            ? result[0].journal_mode
            : 'delete'
          console.log(`[Prisma] journal_mode 已设置为: ${mode}`)
        })
        .catch((e) => {
          console.error('[Prisma] 设置 journal_mode=DELETE 失败:', (e as Error).message)
        })
    : Promise.resolve()

/**
 * 启动时确保 windows_releases / android_releases 表存在 + 有初始数据
 * Electron 内嵌 backend 首次启动时 SQLite 是空文件，Prisma schema 不会自动建表
 * 所以用 $executeRawUnsafe 手动 CREATE TABLE IF NOT EXISTS + seed 最新版本
 */
export async function ensureReleaseTables() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS windows_releases (
        id TEXT PRIMARY KEY,
        version TEXT UNIQUE NOT NULL,
        isLatest INTEGER NOT NULL DEFAULT 0,
        sizeMB REAL NOT NULL,
        setupUrl TEXT NOT NULL,
        portableUrl TEXT,
        setupSha256 TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        forceUpdate INTEGER NOT NULL DEFAULT 0,
        publishedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS android_releases (
        id TEXT PRIMARY KEY,
        version TEXT UNIQUE NOT NULL,
        isLatest INTEGER NOT NULL DEFAULT 0,
        sizeMB REAL NOT NULL,
        apkUrl TEXT NOT NULL,
        apkSha256 TEXT NOT NULL,
        notes TEXT NOT NULL DEFAULT '',
        forceUpdate INTEGER NOT NULL DEFAULT 0,
        publishedAt TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `)
    // seed v1.1.0（只在空表时插入）
    const cnt = await prisma.$queryRawUnsafe('SELECT count(*) as cnt FROM windows_releases') as { cnt: bigint }[]
    if (cnt[0].cnt === 0n) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO windows_releases (id, version, isLatest, sizeMB, setupUrl, portableUrl, setupSha256, notes, forceUpdate)
        VALUES (
          'rel_v1_1_0',
          '1.1.0',
          1,
          160.5,
          'http://47.116.59.141/apk/%E7%BB%BF%E8%A7%92%E7%8A%80-Setup-1.1.0.exe',
          'http://47.116.59.141/apk/%E7%BB%BF%E8%A7%92%E7%8A%80-Portable-1.1.0.exe',
          '50F2EE763E3A97A267E96E243DFD074BB4EDF1D86044A3722D815829982FE6A8',
          'v1.1.0: HomePage useHomeData hook, PetPage PetGames.tsx (-30%), vite manualChunks 拆包',
          0
        )
      `)
      console.log('[ensureReleaseTables] ✅ seeded v1.1.0')
    }
  } catch (e) {
    // 表可能已存在（Prisma schema 同步过），忽略
    console.warn('[ensureReleaseTables] 跳过（表可能已存在）:', (e as Error).message)
  }
}
