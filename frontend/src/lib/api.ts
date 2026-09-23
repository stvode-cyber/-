import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { getAPIBaseURL, useHeaderAuth } from './platform'
import { loadSavedServerBaseURL, saveServerBaseURL, normalizeBaseURL } from './serverConfig'
import { useAuthStore } from '../stores/auth'

/**
 * 401 统一登出：清 localStorage 之外，还必须重置内存中的 zustand 登录态。
 * 否则 App 仍按"已登录"渲染：/login 路由被 Navigate 弹回 /，HomePage 反复
 * 挂载重发请求形成死循环，最终整页渲染为空（白屏）。
 * （与 stores/auth.ts 存在循环引用，但仅在运行时回调中取值，安全。）
 */
function forceLogout() {
  localStorage.removeItem('aie_token')
  localStorage.removeItem('aie_user')
  useAuthStore.setState({ token: null, user: null })
  // HashRouter 兼容：file:// 协议下 pathname 是文件路径，用 hash 判断当前路由
  if (!window.location.hash.includes('/login')) {
    window.location.hash = '/login'
  }
}

/**
 * HTTP 客户端
 *
 * 三种运行环境：
 * - Electron 桌面端：通过 desktopAPI 获取 127.0.0.1:3001 后端地址
 * - Capacitor 移动端：通过 VITE_API_BASE_URL 连接远程后端服务器
 * - Web 浏览器：使用相对路径 /api/v1，由 vite proxy 或 Nginx 转发
 *
 * 认证方式：
 * - Electron/Capacitor：Authorization header + localStorage（cookie 跨域不可靠）
 * - Web：HttpOnly Cookie（防 XSS 窃取 token）
 *
 * 响应拦截：统一处理 { code, data, message } 格式 + 401 跳登录 + 无感续期
 */
const baseURL = getAPIBaseURL()

export const api = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: !useHeaderAuth,
})

// 用于请求重放的原生实例：不带任何拦截器，重试时返回原始 HTTP 响应，
// 交给主线拦截器统一做 code/message 处理，避免二次解包。
const apiRaw = axios.create({
  baseURL,
  timeout: 15000,
  withCredentials: !useHeaderAuth,
})

/** 请求拦截：移动端/桌面端带 Authorization 头 */
const authRequest = (config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  if (useHeaderAuth) {
    const token = localStorage.getItem('aie_token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
  }
  return config
}
api.interceptors.request.use(authRequest)
apiRaw.interceptors.request.use(authRequest)

// ============================================
// 服务器地址动态配置（正式版：用户可在设置里改，无需重打包）
// ============================================

// 每个请求打上重试次数标记，重试拦截器据此递增
declare module 'axios' {
  export interface InternalAxiosRequestConfig {
    _retryCount?: number
  }
}

/**
 * 启动时加载用户自设服务器地址并覆盖内置默认值。
 * 需在发起首个请求前调用（main.tsx 已接入）。
 */
export async function initServerConfig(): Promise<void> {
  try {
    const saved = await loadSavedServerBaseURL()
    if (saved && saved !== api.defaults.baseURL) {
      api.defaults.baseURL = saved
    }
  } catch {
    // 读本地失败不阻断启动，沿用内置默认地址
  }
}

/** 当前生效的服务器地址（读 axios 实例的实时值） */
export function getEffectiveBaseURL(): string {
  return api.defaults.baseURL || ''
}

/** 切换服务器地址：改全局 baseURL + 持久化到本地 */
export async function setServerBaseURL(url: string): Promise<void> {
  const base = normalizeBaseURL(url)
  if (!base) throw new Error('服务器地址无效：请填写合法的 http 或 https 地址')
  api.defaults.baseURL = base
  await saveServerBaseURL(base)
}

// ============================================
// 请求重试（正式版：弱网/超时自动重试，减少移动端偶发失败）
// ============================================

const MAX_RETRY = 2 // 幂等请求最多重试 2 次（累计 3 次尝试）

/**
 * 是否值得重试：
 * - 只重试 GET（幂等，POST/PUT/DELETE 重放可能重复提交，不做）
 * - 网络错误（无响应）/超时/HTTP 408/429/5xx 可重试
 * - 401、业务错误、主动取消不重试
 */
function shouldRetry(error: AxiosError, config: InternalAxiosRequestConfig | undefined): boolean {
  if (!config || config.method !== 'get') return false
  if (axios.isCancel(error)) return false
  if (error.response) {
    const status = error.response.status
    if (status === 408 || status === 429 || status >= 500) return true
    return false
  }
  // 无响应：网络错误或超时
  return true
}

/** 指数退避延时 */
function retryDelay(count: number): number {
  return 400 * Math.pow(2, count) // 400ms → 800ms
}

// 重试错误拦截器：用 apiRaw 重放原始请求（不带 code/message 解包），
// 最终结果再经主拦截器统一处理，不会二次解包且有 401/报错兜底。
const errRetryRes = (error: AxiosError) => {
  const config = error.config as InternalAxiosRequestConfig | undefined
  if (!config || !shouldRetry(error, config)) return Promise.reject(error)
  const count = config._retryCount || 0
  if (count >= MAX_RETRY) return Promise.reject(error)
  config._retryCount = count + 1
  // 弱网离线时不立即重试，交给用户手动操作
  if (typeof navigator !== 'undefined' && !navigator.onLine) return Promise.reject(error)
  return new Promise<void>((resolve) => setTimeout(resolve, retryDelay(count))).then(() =>
    apiRaw.request(config),
  )
}

// 注册顺序：先重试（能拿到原始 AxiosError），后 code/message 统一处理。
// 重试成功后返回原始响应，交给主拦截器解包；最终失败由主拦截器转友好错误。
api.interceptors.response.use((r) => r, errRetryRes)

// 主响应拦截：统一处理 code/message + 无感续期 + 401 跳登录
api.interceptors.response.use(
  (response) => {
    // 无感续期：后端在 token 临近过期时通过 X-New-Token 响应头下发新 token
    // Electron/Capacitor 需主动更新 localStorage（cookie 跨域不可靠）
    const newToken = response.headers['x-new-token']
    if (newToken && typeof newToken === 'string') {
      localStorage.setItem('aie_token', newToken)
    }
    const data = response.data
    if (data && typeof data === 'object' && 'code' in data) {
      // 2xx 都算成功（后端 success() 第4参数 code 可能是 200/201）
      if (data.code >= 200 && data.code < 300) {
        return data
      }
      // 401 跳登录
      if (data.code === 401) {
        forceLogout()
      }
      return Promise.reject(new Error(data.message || '请求失败'))
    }
    return data
  },
  (error) => {
    if (error.response?.status === 401) {
      forceLogout()
    }
    // 断网时 axios 无 response（Network Error），统一给出友好中文提示
    const offline = typeof navigator !== 'undefined' && !navigator.onLine
    const msg = offline
      ? '网络连接不可用，请检查网络设置'
      : error.response?.data?.message || error.message || '网络异常'
    return Promise.reject(new Error(msg))
  },
)

// 提取 data
export function unwrap<T>(p: Promise<{ data: T }>): Promise<T> {
  return p.then((r) => r.data)
}

// ===== 桌面宠物 =====
export const getPet = () => unwrap<PetDTO>(api.get('/pet'))
export const petAction = (action: 'feed' | 'play' | 'clean' | 'sleep' | 'walk' | 'train') =>
  unwrap<PetDTO>(api.post('/pet/action', { action }))
export const petRename = (name: string) => unwrap<PetDTO>(api.post('/pet/rename', { name }))
// 小游戏结算：把本轮得分兑换为金币 + 经验（含升级）
export const playGame = (game: 'catch' | 'poke' | 'memory', score: number) =>
  unwrap<PetDTO>(api.post('/pet/play-game', { game, score }))
// 每日签到：领取金币奖励 + 连续天数
export const petCheckin = () =>
  unwrap<{ coins: number; award: number; base?: number; levelBonus?: number; streak: number; total: number; checkedInToday: boolean }>(api.post('/pet/checkin'))

// 多宠物管理：列表 / 创建 / 切换 / 删除
export interface PetListItem extends PetDTO {
  isActive: boolean
}
export const getPetList = () =>
  unwrap<{ list: PetListItem[]; activePetId: string | null; maxPets: number }>(api.get('/pet/list'))
export const createPet = (name: string, species: 'shiba' | 'corgi' | 'panda' | 'cat' | 'snake') =>
  unwrap<PetDTO>(api.post('/pet/create', { name, species }))
export const switchPet = (petId: string) =>
  unwrap<PetDTO>(api.post('/pet/switch', { petId }))
export const deletePet = (petId: string) =>
  unwrap<null>(api.delete(`/pet/${petId}`))

// 自定义桌宠形象：上传照片抠图（24小时有效，免费）
export const uploadCustomSprite = (image: string) =>
  unwrap<{ customSprite: string; customSpriteExpireAt: string; customSpriteRemaining: number }>(
    api.post('/pet/custom-sprite', { image }),
  )
export const deleteCustomSprite = () =>
  unwrap<null>(api.delete('/pet/custom-sprite'))

// ---- 占卜：星座运势 + 八卦算命 ----
export interface ZodiacSign {
  key: string
  name: string
  symbol: string
  date: string
  element: string
}
export interface HoroscopeFortune {
  overall: number
  love: number
  career: number
  wealth: number
  health: number
  luckyColor: string
  luckyNumber: number
  summary: string
  detail: string
  advice: string
}
export const getZodiacList = () =>
  unwrap<ZodiacSign[]>(api.get('/divination/zodiac'))
export const getHoroscope = (sign: string) =>
  unwrap<{ sign: ZodiacSign; date: string; fortune: HoroscopeFortune }>(api.post('/divination/horoscope', { sign }))

export interface IChingLine {
  coins: number[]
  sum: number
  type: string
  value: 0 | 1
  changing: boolean
}
export interface IChingHexagram {
  num: number
  name: string
  fullName: string
  judgment: string
  lowerTrigram: string
  upperTrigram: string
  symbol: string
}
export interface IChingResult {
  question: string
  lines: IChingLine[]
  hexagram: IChingHexagram
  changingHexagram: IChingHexagram | null
  changingLines: number[]
  interpretation: {
    summary: string
    interpretation: string
    advice: string
    outlook: string
  }
}
export const castIChing = (question: string) =>
  unwrap<IChingResult>(api.post('/divination/iching', { question }))

// 星座配对
export interface CompatibilityResult {
  sign1: ZodiacSign
  sign2: ZodiacSign
  score: number
  level: string
  elementRelation: string
  aspect: { name: string; desc: string }
  interpretation: {
    summary: string
    love: string
    friendship: string
    communication: string
    advice: string
  }
}
export const getZodiacCompatibility = (sign1: string, sign2: string) =>
  unwrap<CompatibilityResult>(api.post('/divination/compatibility', { sign1, sign2 }))

// 生辰八字
export interface BaziPillar {
  stem: string
  branch: string
  stemIndex: number
  branchIndex: number
  wuxing: { stem: string; branch: string }
  yinyang: { stem: string; branch: string }
  cangGan: string[]
  nayin: string
  pillarIndex: number
  animal: string
}
export interface BaziResult {
  year: BaziPillar
  month: BaziPillar
  day: BaziPillar
  hour: BaziPillar
  wuxingCount: Record<string, number>
  wuxingPercent: Record<string, number>
  dayMaster: string
  dayMasterElement: string
  nayinYear: string
  description: string
  birthInfo: { year: number; month: number; day: number; hour: number }
}
export interface BaziInterpretation {
  summary: string
  personality: string
  career: string
  wealth: string
  love: string
  health: string
  favorable: string
  advice: string
}
export const calculateBazi = (year: number, month: number, day: number, hour: number, gender: 'male' | 'female') =>
  unwrap<{ bazi: BaziResult; interpretation: BaziInterpretation }>(
    api.post('/divination/bazi', { year, month, day, hour, gender }),
  )

export interface PetDTO {
  id: string
  name: string
  species: 'shiba' | 'corgi' | 'panda' | 'cat' | 'snake'
  level: number
  exp: number
  coins: number
  hunger: number
  mood: number
  clean: number
  energy: number
  state: 'happy' | 'hungry' | 'dirty' | 'sleepy' | 'sad'
  lastUpdated: string
  equipped?: Record<string, string | null>
  checkedInToday?: boolean
  checkinStreak?: number
  checkinTotal?: number
  // 进化阶段（成长体系）
  evolutionStage?: string
  evolutionTitle?: string
  evolutionAura?: string | null
  // 互动/游戏结算时附带：是否升级、是否刚进化
  levelUp?: boolean
  evolutionJustUnlocked?: { stage: string; title: string; aura: string | null; level: number } | null
  // 自定义桌宠形象（24小时有效）
  customSprite?: string | null
  customSpriteExpireAt?: string | null
  customSpriteRemaining?: number
}

// ===== 宠物装扮商店 =====
export type PetSlot = 'hat' | 'glasses' | 'collar' | 'toy' | 'background'
export interface PetShopItemDTO {
  key: string
  name: string
  desc: string
  icon: string
  slot: PetSlot
  cost: number
  rarity: 'common' | 'rare' | 'epic'
  bg?: [string, string] | null
  unlockLevel?: number // 解锁所需宠物等级
  locked?: boolean // 当前等级未达，不可购买
  owned: boolean
  equipped: boolean
}
export interface PetShopDTO {
  coins: number
  equipped: Record<string, string | null>
  items: PetShopItemDTO[]
}
export const getPetShop = () => unwrap<PetShopDTO>(api.get('/pet-shop'))

// 宠物进化阶段（成长体系）
export interface PetEvolutionStageDTO {
  level: number
  stage: string
  title: string
  aura: string | null
  desc: string
}
export interface PetEvolutionDTO {
  level: number
  exp: number
  expToNext: number
  currentStage: PetEvolutionStageDTO
  currentStageIndex: number
  nextStage: PetEvolutionStageDTO | null
  nextLevelNeeded: number | null
  unlockedStages: PetEvolutionStageDTO[]
  totalStages: number
}
export const getPetEvolution = () => unwrap<PetEvolutionDTO>(api.get('/pet/evolution'))
export const buyPetItem = (itemKey: string) =>
  unwrap<{ coins: number; itemKey: string }>(api.post('/pet-shop/buy', { itemKey }))
export const equipPetItem = (itemKey: string) =>
  unwrap<{ equipped: Record<string, string | null> }>(api.post('/pet-shop/equip', { itemKey }))
export const unequipPetSlot = (slot: PetSlot) =>
  unwrap<{ equipped: Record<string, string | null> }>(api.post('/pet-shop/unequip', { slot }))

// 宠物专属互动动作（等级特权：高等级解锁）
export interface PetSpecialAction {
  key: string
  name: string
  unlockLevel: number
  unlocked: boolean
}
export const getPetSpecialActions = () =>
  unwrap<{ level: number; specialActions: PetSpecialAction[] }>(api.get('/pet/special-actions'))

// 跨会话宠物排行榜（按等级/经验排序，脱敏）
export interface PetLeaderboardEntry {
  rank: number
  petId: string
  name: string
  ownerName: string
  level: number
  exp: number
  evolutionTitle: string
  evolutionAura: string | null
  isMe: boolean
}
export type LeaderboardRange = 'all' | 'week' | 'month'
export const getPetLeaderboard = (limit = 20, range: LeaderboardRange = 'all') =>
  unwrap<{ list: PetLeaderboardEntry[]; total: number; range: string }>(api.get('/pet/leaderboard', { params: { limit, range } }))

// ===== 桌面便签 =====
export interface StickyNoteDTO {
  id: string
  content: string
  color: string
  x: number
  y: number
  w: number
  h: number
  z: number
  pinned: boolean
  createdAt: string
  updatedAt: string
}
export const listStickyNotes = () => unwrap<StickyNoteDTO[]>(api.get('/sticky'))
export const createStickyNote = (data: Partial<StickyNoteDTO>) =>
  unwrap<StickyNoteDTO>(api.post('/sticky', data))
export const updateStickyNote = (id: string, data: Partial<StickyNoteDTO>) =>
  unwrap<StickyNoteDTO>(api.put(`/sticky/${id}`, data))
export const deleteStickyNote = (id: string) => unwrap<unknown>(api.delete(`/sticky/${id}`))

// ===== 桌面动态壁纸配置 =====
export interface WallpaperDTO {
  id: string
  enabled: boolean
  theme: string
  speed: number
  opacity: number
  showPet: boolean
  updatedAt: string
}
export const getWallpaper = () => unwrap<WallpaperDTO>(api.get('/wallpaper'))
export const updateWallpaper = (data: Partial<WallpaperDTO>) =>
  unwrap<WallpaperDTO>(api.put('/wallpaper', data))

// 桌面端自动采集同步：把指定文件夹扫描出的多个文件批量入库
export interface SyncItem {
  name: string
  mime?: string
  base64: string
  localPath: string
  localMtime?: number
}
export interface SyncResult {
  created: number
  updated: number
  skipped: number
  total: number
}
export async function syncAssets(payload: {
  spaceId: string
  folderId?: string | null
  autoTag?: boolean
  items: SyncItem[]
}): Promise<SyncResult> {
  return unwrap<SyncResult>(api.post('/assets/sync', payload))
}

// ===== 资产分类规则 & 统计看板 =====

export type CategoryRuleMatchType = 'extension' | 'nameContains' | 'mimeStartsWith'

export interface CategoryRule {
  id: string
  spaceId: string
  ownerId: string
  matchType: CategoryRuleMatchType
  pattern: string
  targetCategory: string
  priority: number
  enabled: boolean
}

export interface AssetStats {
  total: number
  byCategory: Record<string, number>
  byType: Record<string, number>
  trend?: { date: string; count: number }[] // 最近 30 天每日新增（时间序列）
}

export const ASSET_CATEGORIES = [
  '票据', '截图', '合同', '文档', '照片', '代码', '音频', '视频', '归档', '其他',
] as const

export async function listCategoryRules(spaceId: string): Promise<{ rules: CategoryRule[]; categories: string[] }> {
  return unwrap(api.get('/category-rules', { params: { spaceId } }))
}
export async function createCategoryRule(body: {
  spaceId: string
  matchType: CategoryRuleMatchType
  pattern: string
  targetCategory: string
  priority?: number
}): Promise<CategoryRule> {
  return unwrap(api.post('/category-rules', body))
}
export async function updateCategoryRule(
  id: string,
  body: Partial<{ matchType: CategoryRuleMatchType; pattern: string; targetCategory: string; priority: number; enabled: boolean }>,
): Promise<CategoryRule> {
  return unwrap(api.put(`/category-rules/${id}`, body))
}
export async function deleteCategoryRule(id: string): Promise<void> {
  await unwrap(api.delete(`/category-rules/${id}`))
}
export async function reclassifyAssets(spaceId: string): Promise<{ total: number; changed: number }> {
  return unwrap(api.post('/category-rules/reclassify', { spaceId }))
}
export async function getAssetStats(spaceId: string): Promise<AssetStats> {
  return unwrap(api.get('/assets/stats', { params: { spaceId } }))
}

// 分类规则导出 / 导入（备份 / 跨空间迁移）
export interface CategoryRuleExport {
  version: number
  spaceId: string
  exportedAt: string
  rules: Omit<CategoryRule, 'id' | 'ownerId'>[]
}
export async function exportCategoryRules(spaceId: string): Promise<CategoryRuleExport> {
  return unwrap(api.get('/category-rules/export', { params: { spaceId } }))
}
export async function importCategoryRules(
  spaceId: string,
  rules: { matchType: CategoryRuleMatchType; pattern: string; targetCategory: string; priority?: number; enabled?: boolean }[],
  mode: 'cover' | 'merge' = 'cover',
): Promise<{ mode: string; created: number; updated: number; total: number }> {
  return unwrap(api.post('/category-rules/import', { spaceId, rules, mode }))
}

// ============================================
// 全局搜索（11 模块聚合）
// ============================================

export interface SearchResultItem {
  id: string
  type: string
  title: string
  subtitle: string
  createdAt: string
  [key: string]: unknown
}
export interface SearchResponse {
  results: Record<string, SearchResultItem[]>
  total: number
  q: string
}

export function searchAll(q: string): Promise<SearchResponse> {
  return unwrap(api.get('/search', { params: { q } }))
}
export function getHotKeywords(): Promise<string[]> {
  return unwrap(api.get('/search/hot'))
}

// ============================================
// 日历聚合
// ============================================

export interface CalendarDayEvent {
  id: string
  type: string
  title: string
  subtitle: string
  time: string
  [key: string]: unknown
}
export interface CalendarResponse {
  year: number
  month: number
  days: Record<string, CalendarDayEvent[]>
  totalEvents: number
  eventTypes: Record<string, { label: string; color: string }>
}

export function getCalendarMonth(year: number, month: number): Promise<CalendarResponse> {
  return unwrap(api.get('/calendar', { params: { year, month } }))
}

// ============================================
// 数据导出
// ============================================

export interface ExportModule {
  key: string
  label: string
  description: string
}
export function getExportModules(): Promise<{ modules: ExportModule[] }> {
  return unwrap(api.get('/export/modules'))
}
/** 导出指定模块为 CSV（返回 Blob） */
export async function exportModuleCSV(module: string): Promise<Blob> {
  const resp = await api.get(`/export/${module}`, {
    params: { format: 'csv' },
    responseType: 'blob',
  })
  return resp.data
}
/** 导出指定模块为 JSON */
export function exportModuleJSON(module: string): Promise<{ module: string; count: number; data: unknown[] }> {
  return unwrap(api.get(`/export/${module}`, { params: { format: 'json' } }))
}
/** 导出全部数据为 JSON */
export function exportAllJSON(): Promise<{ exportedAt: string; total: number; data: Record<string, unknown[]> }> {
  return unwrap(api.get('/export/all/json'))
}

// ============================================
// 应用分享 & APK 下载
// ============================================

export interface AppInfo {
  appName: string
  version: string
  size: number
  sizeFormatted: string
  md5: string
  updatedAt: string
  downloadUrl: string
}

export function getAppInfo(): Promise<AppInfo | null> {
  return unwrap(api.get('/app/info')).then((data: any) => data || null)
}

export function uploadApk(base64: string): Promise<{ size: number; sizeFormatted: string; updatedAt: string }> {
  return unwrap(api.post('/app/upload-apk', { base64 }))
}

export function getApkDownloadUrl(): string {
  return `${getEffectiveBaseURL()}/app/android-apk`
}

// ============================================
// SSE 实时消息
// ============================================

export function getSSEUrl(): string {
  const token = localStorage.getItem('aie_token') || ''
  return `${getEffectiveBaseURL()}/conversations/events?token=${encodeURIComponent(token)}`
}

