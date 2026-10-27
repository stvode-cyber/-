import logger from '../lib/logger.js'
/**
 * 短信发送服务 — 阿里云 DYSMSAPI 封装 + Mock 降级
 *
 * 配置方式（在 .env 中）：
 *   ALIYUN_ACCESS_KEY_ID=你的AccessKeyId
 *   ALIYUN_ACCESS_KEY_SECRET=你的AccessKeySecret
 *   ALIYUN_SMS_SIGN_NAME=你的签名名称（如"绿角犀"）
 *   ALIYUN_SMS_TEMPLATE_CODE=模板CODE（如"SMS_123456789"）
 *
 * 有配置 → 调真实网关发真实短信
 * 没配置 → mock 降级（开发/测试方便，验证码直接返回给前端）
 */

const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID
const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET
const signName = process.env.ALIYUN_SMS_SIGN_NAME
const templateCode = process.env.ALIYUN_SMS_TEMPLATE_CODE

/** 当前是否配置了阿里云真实短信网关 */
export const isRealSmsConfigured = Boolean(
  accessKeyId && accessKeySecret && signName && templateCode
)

/**
 * 发送验证码短信
 * @param phone 手机号
 * @param code  6 位验证码
 * @returns {{ sent: boolean; via: 'aliyun' | 'mock'; message?: string }}
 */
export async function sendVerificationCode(phone: string, code: string) {
  // —— Mock 模式（没配阿里云） ——
  // 注意：code 是 6 位验证码，绝对不能打日志，生产环境会泄露到 pm2 logs
  if (!isRealSmsConfigured) {
    const masked = phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    logger.info(`[SMS/MOCK] phone=${masked}（Aliyun not configured, mock send, code 不打日志）`)
    return { sent: true, via: 'mock' as const }
  }

  // —— 真实模式（阿里云 DYSMSAPI） ——
  try {
    // 动态 require，没装 SDK 时友好降级；加 @ts-ignore 绕过 tsc strict 检查（SDK 是可选依赖）
    // @ts-ignore - alicloud SDK 为可选依赖，不存在时运行时走 catch 降级
    const Dysmsapi = require('@alicloud/dysmsapi20170525')
    // @ts-ignore
    const OpenApi = require('@alicloud/openapi-client')
    // @ts-ignore
    const Util = require('@alicloud/tea-util')

    const config = new OpenApi.Config({
      accessKeyId,
      accessKeySecret,
      endpoint: 'dysmsapi.aliyuncs.com',
    })
    const client = new Dysmsapi.default(config)

    const request = new Dysmsapi.SendSmsRequest({
      phoneNumbers: phone,
      signName,
      templateCode,
      templateParam: JSON.stringify({ code }),
    })
    const runtime = new Util.RuntimeOptions({})

    const response = await client.sendSmsWithOptions(request, runtime)

    if (response.body?.code === 'OK') {
      const masked = phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
      logger.info(`[SMS/ALIYUN] OK phone=${masked}`)
      return { sent: true, via: 'aliyun' as const }
    } else {
      const msg = response.body?.message || response.body?.code || 'unknown'
      logger.error(`[SMS/ALIYUN] error: ${msg}`)
      throw new Error(`SMS gateway error: ${msg}`)
    }
  } catch (err: any) {
    // 网络错误 / SDK 错误 → 降级 mock + 打日志（不阻塞用户注册）
    logger.error(`[SMS/ALIYUN] send failed, fallback mock: ${err?.message || err}`)
    const masked = phone.replace(/^(\d{3})\d{4}(\d{4})$/, '$1****$2')
    logger.info(`[SMS/MOCK] phone=${masked}（Aliyun failed, fallback mock, code 不打日志）`)
    return { sent: true, via: 'mock' as const, message: 'Real SMS send failed, fallback mock' }
  }
}
