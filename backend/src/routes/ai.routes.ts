/**
 * AI 云端网关：POST /api/v1/ai/proxy
 *
 * 桌面端本地 AgentCore 把"LLM 补全请求"转发到这里，云端用服务器侧持有的
 * LLM key 调上游大模型并返回非流式结果。本地零配置、key 不外泄。
 *
 * 安全设计：
 * - gatewayAuth 只验签（云端库无本地用户），按 userId 限流/计费。
 * - 参数白名单：仅透传 messages/model/temperature/maxTokens，绝不接收 apiKey。
 * - handler 用 llmProxyCompletion（底层 call*），不走 llmGenerateChat，防自递归。
 */
import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { gatewayAuth } from '../middleware/gatewayAuth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { llmProxyCompletion } from '../services/llmService.js'
import { success, fail } from '../utils/response.js'
import { audit } from '../utils/audit.js'

const router = Router()

router.use(gatewayAuth)
router.use(
  rateLimit({
    keyFn: (req) => 'user:' + ((req.user?.userId) || req.ip || 'unknown'),
    limit: 60,
    windowMs: 60_000,
  }),
)

router.post('/proxy', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>
    const messages = Array.isArray(body.messages) ? body.messages : null
    if (!messages || messages.length === 0) {
      return fail(res, 'messages 不能为空', 422)
    }

    const result = await llmProxyCompletion({
      messages: messages as { role: 'system' | 'user' | 'assistant'; content: string }[],
      model: typeof body.model === 'string' && body.model ? body.model : undefined,
      temperature: typeof body.temperature === 'number' ? body.temperature : undefined,
      maxTokens: typeof body.maxTokens === 'number' ? body.maxTokens : undefined,
    })

    if (!result) {
      return fail(res, 'LLM 网关调用失败', 502)
    }

    // 记录 token 用量供计费/防滥用（fire-and-forget）
    try {
      audit({
        userId: req.user?.userId,
        username: req.user?.username,
        category: 'ai',
        action: 'gateway_proxy',
        targetId: req.user?.userId,
        summary: `AI 网关代理 ${result.model}`,
        detail: {
          model: result.model,
          promptTokens: result.tokenUsage?.prompt,
          completionTokens: result.tokenUsage?.completion,
        },
      })
    } catch { /* 忽略 */ }

    return success(res, result)
  } catch (e) {
    next(e)
  }
})

export default router