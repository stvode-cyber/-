// 本地 cloud 网关转发冒烟：验证 llmGenerateChat 在 LLM_ROUTING=cloud 且无本地 key 时，能带用户 JWT 转发到云端并拿到回复
process.env.LLM_ROUTING = 'cloud'
process.env.LLM_GATEWAY_URL = 'http://47.116.59.141:3001/api/v1/ai/proxy'
// 模拟"无本地 key"：不设置 LLM_API_KEY / LLM_PROVIDER（默认 ollama 但 cloud 分支不依赖本地 key）

import jwt from 'jsonwebtoken'
import { requestContextStorage } from './dist/utils/requestContext.js'
import { llmGenerateChat } from './dist/services/llmService.js'

const token = jwt.sign(
  { userId: 'gwtest', username: 'gw', role: 'user' },
  'd99989deabd14f5baf451316839511020fa3e1cc69e5d10b797cc953b5fbda11',
  { expiresIn: '24h' },
)

const out = await requestContextStorage.run({ token }, () =>
  llmGenerateChat([{ role: 'user', content: '请回复：本地云网关转发链路测试通过' }]),
)

if (out && out.text) {
  console.log('OK_TEXT=', out.text.slice(0, 120))
  console.log('MODEL=', out.model, 'PROVIDER=', out.provider)
  console.log('TOKENS=', JSON.stringify(out.tokenUsage))
  process.exit(0)
} else {
  console.error('FAILED: llmGenerateChat 未返回结果（网关转发失败）')
  process.exit(1)
}