import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../lib/prisma.js'
import { success, fail } from '../utils/response.js'
import { auditReq } from '../utils/audit.js'
import { pipeAssetFile } from '../lib/storage.js'
import { rateLimit } from '../middleware/rateLimit.js'

// 外链分享：公开访问，与登录态隔离（仅校验链接有效期/密码）
const router = Router()

interface LinkError {
  status: number
  message: string
}

async function resolveLink(token: string, password?: string): Promise<{ link?: any; error?: LinkError }> {
  const link = await prisma.shareLink.findUnique({
    where: { token },
    include: { asset: true },
  })
  if (!link) return { error: { status: 404, message: '分享链接不存在' } }
  if (link.expireAt && link.expireAt.getTime() < Date.now()) {
    return { error: { status: 410, message: '分享链接已过期' } }
  }
  if (link.password) {
    if (!password || !(await bcrypt.compare(password, link.password))) {
      return { error: { status: 401, message: '密码错误' } }
    }
  }
  // 记录访问（fire-and-forget）：最近访问时间 + 累计次数；审计另在端点内记录
  prisma.shareLink
    .update({ where: { id: link.id }, data: { accessedAt: new Date(), accessedCount: { increment: 1 } } })
    .catch(() => {})
  return { link }
}

// 取回分享元数据（免登录）
// P1-4 修复：按 IP 限流 20 次/分钟，防止匿名暴力破解分享密码
const shareRateLimit = rateLimit({ limit: 20, windowMs: 60_000 })
router.get('/:token', shareRateLimit, async (req, res, next) => {
  try {
    const r = await resolveLink(req.params.token, req.query.password as string | undefined)
    if (r.error) return fail(res, r.error.message, r.error.status)
    const a = r.link!.asset
    // 免登录访问审计（匿名访客：userId 置空，记录 IP/UA）
    // P2-7 修复：token 仅记录前 8 位，避免审计日志泄露完整访问凭证
    auditReq(req, res, {
      userId: null,
      category: 'dam',
      action: 'share_access',
      targetType: 'ShareLink',
      targetId: r.link!.id,
      summary: `免登录取回分享元数据: ${a.name}`,
      detail: { tokenPrefix: r.link!.token.slice(0, 8), permission: r.link!.permission },
    })
    return success(res, {
      token: r.link!.token,
      permission: r.link!.permission,
      expiredAt: r.link!.expireAt,
      asset: { id: a.id, name: a.name, type: a.type, size: a.size, mime: a.mime },
    })
  } catch (e) {
    next(e)
  }
})

// 下载/预览分享文件（免登录，view=内联预览，download=附件下载）
router.get('/:token/file', shareRateLimit, async (req, res, next) => {
  try {
    const r = await resolveLink(req.params.token, req.query.password as string | undefined)
    if (r.error) return fail(res, r.error.message, r.error.status)
    const link = r.link!
    // 免登录下载/预览审计（匿名访客：userId 置空）
    // P2-7 修复：token 仅记录前 8 位，避免审计日志泄露完整访问凭证
    auditReq(req, res, {
      userId: null,
      category: 'dam',
      action: 'share_download',
      targetType: 'ShareLink',
      targetId: link.id,
      summary: `免登录${link.permission === 'download' ? '下载' : '预览'}分享文件: ${link.asset.name}`,
      detail: { tokenPrefix: link.token.slice(0, 8), permission: link.permission },
    })
    const disposition = link.permission === 'download' ? 'attachment' : 'inline'
    // 安全：用户可控的 mime 绝不能直接以 inline 渲染，否则可被存储型 XSS / 内容嗅探。
    // 仅白名单内的安全媒体类型允许按原 mime 内联；其余一律降级为 octet-stream 并禁止嗅探。
    const SAFE_INLINE = /^(image\/(png|jpe?g|gif|webp|bmp|svg\+xml)|audio\/|video\/|application\/pdf)$/i
    const rawMime = link.asset.mime || 'application/octet-stream'
    const contentType = disposition === 'inline' && SAFE_INLINE.test(rawMime) ? rawMime : 'application/octet-stream'
    await pipeAssetFile(res, link.asset.storageKey, { contentType, disposition, name: link.asset.name })
  } catch (e) {
    next(e)
  }
})

export default router
