import { prisma } from './prisma.js'
import { HttpError } from '../utils/response.js'

/**
 * 空间访问校验（DAM-lite RBAC）
 *
 * role 层级：owner > operator > member > viewer
 * - 读操作：空间成员（含 viewer）即可
 * - 写操作（上传/登记资源区/触发提取等）：需 owner | operator | member
 */

const WRITE_ROLES = new Set(['owner', 'operator', 'member'])

export interface SpaceAccess {
  isOwner: boolean
  role: string
}

/**
 * 校验用户对空间的访问权限，返回访问信息；无权限或空间不存在抛 HttpError。
 * @param write 是否需要写权限
 */
export async function assertSpaceAccess(
  spaceId: string,
  userId: string,
  write = false,
): Promise<SpaceAccess> {
  const space = await prisma.space.findUnique({ where: { id: spaceId } })
  if (!space) throw new HttpError('空间不存在', 404)

  if (space.ownerId === userId) {
    return { isOwner: true, role: 'owner' }
  }

  const member = await prisma.spaceMember.findUnique({
    where: { spaceId_userId: { spaceId, userId } },
  })
  if (!member) throw new HttpError('无权访问该空间', 403)

  if (write && !WRITE_ROLES.has(member.role)) {
    throw new HttpError('权限不足：需要写入权限', 403)
  }
  return { isOwner: false, role: member.role }
}
