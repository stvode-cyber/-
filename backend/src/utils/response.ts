// TODO: [res.json双序列化] 预防：本文件的 success/fail/HttpError 已经返回完整响应外壳，写 res.json(success()) 时确认 helper 返回普通对象不要再包一层，否则导致 500
// TODO: [BigInt安全] 预防：数据库含 BigInt 字段（如 localMtime），必须用 safeStringify 统一转字符串，否则 JSON.stringify 直接抛错
import type { Response } from 'express'

export interface ApiResponse<T = unknown> {
  code: number
  data: T | null
  message: string
  timestamp: number
  requestId: string
}

// BigInt 在 JSON.stringify 默认会抛错（"Do not know how to serialize a BigInt"）。
// 资产/采集源含 BigInt 字段（localMtime），统一在此转成字符串后再下发，避免列表/详情接口 500。
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
}

export function success<T>(res: Response, data: T, message = 'success', code = 200) {
  const payload: ApiResponse<T> = {
    code,
    data,
    message,
    timestamp: Math.floor(Date.now() / 1000),
    requestId: res.locals.requestId || generateRequestId(),
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(safeStringify(payload))
}

export function fail(res: Response, message: string, code = 400, data: unknown = null) {
  const payload: ApiResponse = {
    code,
    data,
    message,
    timestamp: Math.floor(Date.now() / 1000),
    requestId: res.locals.requestId || generateRequestId(),
  }
  res.status(code >= 100 && code < 600 ? code : 400)
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.send(safeStringify(payload))
}

export function generateRequestId(): string {
  return 'req_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export class HttpError extends Error {
  code: number
  constructor(message: string, code = 400) {
    super(message)
    this.code = code
  }
}
