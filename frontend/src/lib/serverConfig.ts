/**
 * 服务器地址动态配置
 *
 * 移动端（Capacitor）默认用编译内置的 VITE_API_BASE_URL（.env.mobile）。
 * 这里支持用户在设置里改服务器地址：运行时覆盖并持久化到本地存储，
 * 这样正式版换个服务器 / 让用户自填地址都不需要重新打包。
 *
 * 存储：Capacitor 用 Preferences（原生），Web 端退化用 localStorage。
 */
import { Preferences } from '@capacitor/preferences'
import { isCapacitor, getAPIBaseURL } from './platform'

const KEY = 'server_api_base_url'

/** 内置默认服务器地址（来自环境变量，打包时固定） */
export function getDefaultAPIBaseURL(): string {
  return getAPIBaseURL()
}

function readOverride(): string | null {
  try {
    if (isCapacitor) return null // 异步读，走 readOverrideAsync
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

async function readOverrideAsync(): Promise<string | null> {
  try {
    if (isCapacitor) {
      const { value } = await Preferences.get({ key: KEY })
      return value || null
    }
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** 读取用户自设的服务器地址（未设置则返回内置默认） */
export async function loadSavedServerBaseURL(): Promise<string> {
  const override = await readOverrideAsync()
  return override && override.length > 0 ? normalize(override) : getAPIBaseURL()
}

/** 保存用户自设服务器地址到本地 */
export async function saveServerBaseURL(url: string): Promise<void> {
  const value = normalize(url)
  if (isCapacitor) {
    await Preferences.set({ key: KEY, value })
  } else {
    localStorage.setItem(KEY, value)
  }
}

/** 清空用户自设地址，恢复内置默认 */
export async function resetServerBaseURL(): Promise<void> {
  if (isCapacitor) {
    await Preferences.remove({ key: KEY })
  } else {
    localStorage.removeItem(KEY)
  }
}

/**
 * 去掉首尾空白、末位斜杠；缺协议时默认补 https。
 * 只允许 http/https 两种协议，非法返回 null。
 */
export function normalizeBaseURL(url: string): string | null {
  let value = url.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  // 去末尾斜杠，避免拼出双斜杠路径
  return value.replace(/\/+$/, '')
}

/** 去首尾空白 + 去末尾斜杠，避免拼出双斜杠路径 */
function normalize(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

// 供非异步场景下限流读取（启动渲染前同步兜底，通常优先 async 路径）
export function peekSavedServerBaseURL(): string | null {
  return readOverride()
}