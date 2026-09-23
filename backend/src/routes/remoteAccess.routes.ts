/**
 * 远程访问配置路由（PC 端设置页用，走主后端 + JWT 认证）
 *
 * - GET  /api/v1/remote-access            查看状态（开关/端口/访问码/授权目录/访问地址）
 * - PUT  /api/v1/remote-access            更新配置并运行时启停
 * - POST /api/v1/remote-access/regenerate 重新生成访问码（旧令牌全部失效）
 */
import { Router } from 'express'
import { z } from 'zod'
import { authRequired } from '../middleware/auth.js'
import { success, fail } from '../utils/response.js'
import { auditReq } from '../utils/audit.js'
import {
  getRemoteStatus,
  updateRemoteConfig,
  regenerateCode,
} from '../services/remoteFileServer.js'

const router = Router()

router.use(authRequired)

router.get('/', (req, res) => {
  auditReq(req, res, { category: 'remote_access', action: 'status', summary: '查看远程访问状态' })
  success(res, getRemoteStatus())
})

const updateSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().int().min(1025).max(65535).optional(),
  code: z.string().regex(/^[A-Za-z0-9]{6}$/).optional(),
  roots: z.array(z.string()).min(1).optional(),
})

router.put('/', (req, res) => {
  const parsed = updateSchema.safeParse(req.body)
  if (!parsed.success) {
    res.json(fail(res, '参数不合法', 400))
    return
  }
  auditReq(req, res, {
    category: 'remote_access',
    action: 'update',
    summary: `更新远程访问配置 enabled=${String(parsed.data.enabled)}`,
  })
  success(res, updateRemoteConfig(parsed.data))
})

router.post('/regenerate', (req, res) => {
  auditReq(req, res, { category: 'remote_access', action: 'regenerate', summary: '重新生成远程访问码' })
  success(res, regenerateCode())
})

export default router
