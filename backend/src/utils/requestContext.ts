/**
 * 请求级上下文（AsyncLocalStorage）
 *
 * 用途：`llmService` 等无 req 参数的服务层，在发起 AI 云端网关请求时需要携带
 * 当前用户的 JWT。本模块在 HTTP 请求生命周期内外开一个异步存储，`authRequired`
 * 验签成功后把原始 token 写入，供底层服务读取。
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import type { Request, Response, NextFunction } from 'express'

interface RequestCtx {
  token?: string
}

export const requestContextStorage = new AsyncLocalStorage<RequestCtx>()

/** 全局挂到 app 上的中间件：为每个请求开一个独立的存储上下文 */
export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction) {
  requestContextStorage.run({ token: undefined }, () => next())
}

/** 在当前请求上下文内写入 JWT */
export function setRequestToken(token?: string) {
  const store = requestContextStorage.getStore()
  if (store) store.token = token
}

/** 读取当前请求的 JWT（无请求上下文时返回 undefined） */
export function getRequestToken(): string | undefined {
  return requestContextStorage.getStore()?.token
}