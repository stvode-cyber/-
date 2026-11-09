import { PrismaClient } from '@prisma/client'
import logger from './logger.js'

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
          logger.info(`[Prisma] journal_mode 已设置为: ${mode}`)
        })
        .catch((e) => {
          logger.error({ err: e }, '[Prisma] 设置 journal_mode=DELETE 失败: %s', (e as Error).message)
        })
    : Promise.resolve()

/**
 * 启动时确保 windows_releases / android_releases 表存在 + 有初始数据
 * Electron 内嵌 backend 首次启动时 SQLite 是空文件，Prisma schema 不会自动建表
 * 所以用 $executeRawUnsafe 手动 DROP + CREATE TABLE + seed 最新版本
 *
 * 关键约束（Prisma 5.22.0 + SQLite）：
 *   - Prisma 原生 DateTime API（model.create/upsert）会把时间序列化成毫秒时间戳 "1793173770374"
 *     写进 TEXT 类型列后，Prisma 读的时候期望 ISO 8601 字符串 → P2023 炸
 *   - SQLite datetime('now') 产出 '2026-10-28 07:44:35'（空格分隔），|| 'Z' 还是空格分隔
 *     Prisma 拒绝空格格式 → P2023 炸
 *   - 唯一安全方案：DEFAULT 用 strftime('%Y-%m-%dT%H:%M:%SZ', 'now') 直接产出 '2026-10-28T07:44:35Z'
 *     + INSERT 不传 publishedAt 让 DEFAULT 生效 + 所有写操作走 $executeRawUnsafe 绕过 Prisma DateTime 序列化
 */
/**
 * 启动时确保 windows_releases / android_releases 表存在 + 有初始数据
 * Electron 内嵌 backend 首次启动时 SQLite 是空文件，Prisma schema 不会自动建表
 * 所以用 $executeRawUnsafe 手动 CREATE TABLE + seed
 *
 * 关键约束（Prisma 5.22.0 + SQLite）：
 *   - Prisma 原生 DateTime API（model.create/upsert）会把时间序列化成毫秒时间戳 "1793173770374"
 *     写进 TEXT 类型列后，Prisma 读的时候期望 ISO 8601 字符串 → P2023 炸
 *   - SQLite datetime('now') 产出 '2026-10-28 07:44:35'（空格分隔），|| 'Z' 还是空格分隔
 *     Prisma 拒绝空格格式 → P2023 炸
 *   - 唯一安全方案：DEFAULT 用 strftime('%Y-%m-%dT%H:%M:%SZ', 'now') 直接产出 '2026-10-28T07:44:35Z'
 *     + INSERT 不传 publishedAt 让 DEFAULT 生效 + 所有写操作走 $executeRawUnsafe 绕过 Prisma DateTime 序列化
 *
 * ⚠️ 只在表不存在时 CREATE + seed。表已存在则跳过，保留用户手动修改的数据。
 *    发新版时直接在 DB 里 INSERT 新记录 + UPDATE isLatest，无需改源码。
 */
export async function ensureReleaseTables() {
  try {
    // 检查表是否已存在
    const checkTable = async (name: string): Promise<boolean> => {
      const rows = await prisma.$queryRawUnsafe(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='${name}'`
      ) as Array<{ name: string }>
      return rows.length > 0
    }

    // ===== windows_releases =====
    const winExists = await checkTable('windows_releases')
    if (!winExists) {
      logger.info('[ensureReleaseTables] windows_releases 不存在，CREATE + seed')
      await prisma.$executeRawUnsafe(`
        CREATE TABLE windows_releases (
          id TEXT PRIMARY KEY,
          version TEXT UNIQUE NOT NULL,
          isLatest INTEGER NOT NULL DEFAULT 0,
          sizeMB REAL NOT NULL,
          setupUrl TEXT NOT NULL,
          portableUrl TEXT,
          setupSha256 TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          forceUpdate INTEGER NOT NULL DEFAULT 0,
          publishedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
      `)
      await prisma.$executeRawUnsafe(`
        INSERT INTO windows_releases (id, version, isLatest, sizeMB, setupUrl, portableUrl, setupSha256, notes, forceUpdate)
        VALUES (
          'rel_v1_2_0',
          '1.2.0',
          1,
          160.5,
          'http://47.116.59.141/apk/%E7%BB%BF%E8%A7%92%E7%8A%80-Setup-1.2.0.exe',
          'http://47.116.59.141/apk/%E7%BB%BF%E8%A7%92%E7%8A%80-Portable-1.2.0.exe',
          '',
          'v1.2.0: 7大Page重构(-1700行)，FocusSoundPage soundEngine, LoginPage LoginWidgets, LibraryPage LibraryWidgets',
          0
        )
      `)
      logger.info('[ensureReleaseTables] ✅ windows seeded v1.2.0')
    } else {
      logger.info('[ensureReleaseTables] windows_releases 已存在，跳过 seed')
    }

    // ===== android_releases =====
    const androidExists = await checkTable('android_releases')
    if (!androidExists) {
      logger.info('[ensureReleaseTables] android_releases 不存在，CREATE + seed')
      await prisma.$executeRawUnsafe(`
        CREATE TABLE android_releases (
          id TEXT PRIMARY KEY,
          version TEXT UNIQUE NOT NULL,
          isLatest INTEGER NOT NULL DEFAULT 0,
          sizeMB REAL NOT NULL,
          apkUrl TEXT NOT NULL,
          apkMd5 TEXT NOT NULL,
          notes TEXT NOT NULL DEFAULT '',
          forceUpdate INTEGER NOT NULL DEFAULT 0,
          publishedAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
        )
      `)
      // apkUrl 默认指向 Express proxy 路径（走 Express sendFile 支持 Range/断点续传）
      // 生产固定 http://47.116.59.141，开发时 LOCAL_APK_URL 环境变量可覆盖
      const apkUrl = process.env.LOCAL_APK_URL || 'http://47.116.59.141/apk/aie-mobile-1.0.4.apk'
      await prisma.$executeRawUnsafe(`
        INSERT INTO android_releases (id, version, isLatest, sizeMB, apkUrl, apkMd5, notes, forceUpdate)
        VALUES (
          'apk_v1_0_4',
          '1.0.4',
          1,
          14.32,
          '${apkUrl.replace(/'/g, "''")}',
          '',
          'v1.0.4：Android 自动更新全链路验证',
          0
        )
      `)
      logger.info({ apkUrl }, '[ensureReleaseTables] ✅ android seeded v1.0.4')
    } else {
      logger.info('[ensureReleaseTables] android_releases 已存在，跳过 seed')
    }
  } catch (e) {
    logger.warn({ err: e }, '[ensureReleaseTables] seed 失败: %s', (e as Error).message)
  }
}
