/**
 * Pino Logger — 生产级日志
 *
 * Express 官方推荐（比 Winston 快 5-10x，异步 + redact 脱敏）。
 * 用法：
 *   import logger from './logger'
 *   logger.error({ err }, '操作失败')
 *   logger.warn('警告')
 *   logger.info({ userId }, '用户登录')
 */
import pino from 'pino'

const IS_PROD = process.env.NODE_ENV === 'production'

export const logger = pino({
  level: IS_PROD ? 'info' : 'debug',
  redact: {
    paths: [
      'password', 'token', 'apiKey', 'api_key', 'jwt', 'secret',
      'authorization', 'Authorization', 'cookie', 'Cookie',
      'creditCard', 'credit_card', 'ssn',
    ],
    censor: '[REDACTED]',
  },
  transport: IS_PROD
    ? undefined
    : { target: 'pino-pretty', options: { colorize: true } },
})

export default logger
