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
