/**
 * JSON 与查询相关的共享工具函数
 *
 * 设计目的：
 * - 消除 admin.routes.ts 与 handover.routes.ts 中重复实现的 safeParseArray
 * - 消除 admin.routes.ts 中重复的 username 模糊匹配 → userId 列表查询逻辑
 */
import { prisma } from '../lib/prisma.js'

/**
 * 安全解析 JSON 字符串数组
 * - 失败返回空数组，避免 JSON.parse 抛出中断业务
 * - 用于解析 Prisma 中以字符串存储的 JSON 数组字段（如 handover.pendingItems）
 */
export function safeParseArray<T = unknown>(raw: string): T[] {
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * 按 username 模糊匹配解析出 userId 列表
 * - 用于 admin 视角下按用户名筛选其他实体（handover/community 等）
 * - 返回 undefined 表示未传 username，调用方应跳过 userId 过滤
 * - 返回空数组表示传了 username 但无匹配用户，调用方应据此过滤出空结果
 *
 * @param username 用户名关键词（模糊匹配 contains）
 * @returns userId 列表；未传 username 时返回 undefined
 */
export async function resolveUserIdsByUsername(
  username?: string,
): Promise<string[] | undefined> {
  if (!username) return undefined
  const matched = await prisma.user.findMany({
    where: { username: { contains: username } },
    select: { id: true },
  })
  return matched.map((u) => u.id)
}
