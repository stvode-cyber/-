/**
 * 自动备份调度器
 *
 * 定时将 exportLocalData() 结果存到 IndexedDB（历史保留 N 份），
 * 提供配置持久化 / 调度检查 / 手动触发 / 历史清理。
 *
 * 配置存 localStorage（Electron 关闭后不会丢），
 * 历史存 IndexedDB（避免 localStorage 容量限制 ~5MB）。
 *
 * 前端 App 全程常驻托盘 → setInterval 够用；
 * 桌面用户很少把 App 关到完全退出（关窗口只是隐藏到托盘）。
 */

import { exportLocalData, previewBackup, formatBytes, type BackupData } from './backup'

const DB_NAME = 'aie-auto-backup'
const STORE_NAME = 'history'
const DB_VERSION = 1

// localStorage 键（遵循项目 aie_ 前缀约定）
const LS_KEYS = {
  enabled: 'aie_auto_backup_enabled',        // 'true' | 'false'
  time: 'aie_auto_backup_time',               // 'HH:mm' (24h)
  retentionDays: 'aie_auto_backup_retention', // '7'
  lastRun: 'aie_auto_backup_last_run',        // 毫秒时间戳
  lastStatus: 'aie_auto_backup_last_status',   // 'success' | 'fail'
  lastError: 'aie_auto_backup_last_error',    // 错误消息（短）
} as const

export interface AutoBackupConfig {
  enabled: boolean
  /** 24 小时制 HH:mm，默认 '03:00' */
  time: string
  /** 保留天数，默认 7 */
  retentionDays: number
  lastRunAt: number | null
  lastStatus: 'success' | 'fail' | null
  lastError: string | null
}

export interface AutoBackupHistoryItem {
  /** 时间戳（键） */
  ts: number
  /** 备份时间（toLocaleString 已格式化） */
  label: string
  /** 字节 */
  size: number
  /** 成功 / 失败 */
  status: 'success' | 'fail'
  /** 备份数据本身（Blob 序列化后的 JSON 字符串） — 成功时存 */
  data?: BackupData
  /** 失败时的错误消息 */
  error?: string
}

export const DEFAULT_CONFIG: AutoBackupConfig = {
  enabled: false,
  time: '03:00',
  retentionDays: 7,
  lastRunAt: null,
  lastStatus: null,
  lastError: null,
}

// ─── localStorage 读写 ───

export function loadConfig(): AutoBackupConfig {
  try {
    return {
      enabled: localStorage.getItem(LS_KEYS.enabled) === 'true',
      time: localStorage.getItem(LS_KEYS.time) || DEFAULT_CONFIG.time,
      retentionDays: parseInt(localStorage.getItem(LS_KEYS.retentionDays) || String(DEFAULT_CONFIG.retentionDays), 10),
      lastRunAt: parseInt(localStorage.getItem(LS_KEYS.lastRun) || '0', 10) || null,
      lastStatus: (localStorage.getItem(LS_KEYS.lastStatus) as AutoBackupConfig['lastStatus']) || null,
      lastError: localStorage.getItem(LS_KEYS.lastError) || null,
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

export function saveConfig(partial: Partial<AutoBackupConfig>): AutoBackupConfig {
  const cur = loadConfig()
  const merged = { ...cur, ...partial }
  localStorage.setItem(LS_KEYS.enabled, String(merged.enabled))
  localStorage.setItem(LS_KEYS.time, merged.time)
  localStorage.setItem(LS_KEYS.retentionDays, String(merged.retentionDays))
  if (merged.lastRunAt !== undefined) localStorage.setItem(LS_KEYS.lastRun, String(merged.lastRunAt ?? 0))
  if (merged.lastStatus !== undefined) localStorage.setItem(LS_KEYS.lastStatus, merged.lastStatus || '')
  if (merged.lastError !== undefined) localStorage.setItem(LS_KEYS.lastError, merged.lastError || '')
  return merged
}

// ─── IndexedDB 操作 ───

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'ts' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut<T>(item: T): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(item)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

function idbGetAll(): Promise<AutoBackupHistoryItem[]> {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).getAll()
    req.onsuccess = () => resolve((req.result || []) as AutoBackupHistoryItem[])
    req.onerror = () => reject(req.error)
  }))
}

function idbDelete(ts: number): Promise<void> {
  return openDB().then(db => new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(ts)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))
}

// ─── 核心调度与执行 ───

/**
 * 判断"现在是不是到了自动备份时间且今天还没跑过"
 * 用本地时间对比 HH:mm — 简单且够用（用户电脑时区就是备份基准）。
 */
export function shouldRunNow(cfg: AutoBackupConfig, now = new Date()): boolean {
  if (!cfg.enabled) return false
  if (!cfg.time) return false

  const [hStr, mStr] = cfg.time.split(':')
  const h = parseInt(hStr, 10)
  const m = parseInt(mStr, 10)
  if (isNaN(h) || isNaN(m)) return false

  const target = new Date(now)
  target.setHours(h, m, 0, 0)

  // 当前时间必须在 [target, target+5min) 窗口内（容忍 5 分钟）
  const diff = now.getTime() - target.getTime()
  if (diff < 0 || diff > 5 * 60 * 1000) return false

  // 今天已跑过就跳过
  if (cfg.lastRunAt) {
    const last = new Date(cfg.lastRunAt)
    if (last.toDateString() === now.toDateString()) return false
  }

  return true
}

/** 执行一次备份（手动/自动通用入口） */
export async function runBackupNow(progress?: (p: { phase: string; current?: number; total?: number }) => void): Promise<AutoBackupHistoryItem> {
  const ts = Date.now()
  const label = new Date(ts).toLocaleString('zh-CN', { hour12: false })

  try {
    progress?.({ phase: '收集本地数据…' })
    const backup = await exportLocalData((p) => {
      if (p.phase === 'localStorage') progress?.({ phase: '收集设置数据…' })
      else if (p.phase === 'indexedDB') progress?.({ phase: '读取小说文件…', current: p.current, total: p.total })
      else if (p.phase === 'serialize') progress?.({ phase: '生成备份…' })
    })

    progress?.({ phase: '存储到本地…' })
    const size = new Blob([JSON.stringify(backup)]).size
    const info = previewBackup(backup)

    const item: AutoBackupHistoryItem = {
      ts,
      label,
      size,
      status: 'success',
      data: backup,
    }
    await idbPut(item)

    // 更新 localStorage 状态
    saveConfig({ lastRunAt: ts, lastStatus: 'success', lastError: null })

    // 清理过期历史
    await cleanupExpired()

    progress?.({ phase: `完成！${info.bookCount} 本书 · ${info.localStorageKeys.length} 项设置 · ${formatBytes(size)}` })
    return item
  } catch (err) {
    const msg = (err as Error).message || '未知错误'
    saveConfig({ lastRunAt: ts, lastStatus: 'fail', lastError: msg.slice(0, 200) })

    const failItem: AutoBackupHistoryItem = { ts, label, size: 0, status: 'fail', error: msg }
    try { await idbPut(failItem) } catch { /* ignore */ }

    progress?.({ phase: `失败：${msg}` })
    throw err
  }
}

/** 清理超过 retentionDays 天的历史 + 超过 50 份的硬性上限（防 IndexedDB 爆） */
export async function cleanupExpired(): Promise<number> {
  const cfg = loadConfig()
  const history = await idbGetAll()
  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000
  const keepFrom = now - cfg.retentionDays * dayMs

  let deleted = 0
  // 按时间倒序，先删最老的
  const sorted = [...history].sort((a, b) => b.ts - a.ts)
  for (const item of sorted) {
    const tooOld = item.ts < keepFrom
    const tooMany = history.length - deleted > 50
    if (tooOld || tooMany) {
      await idbDelete(item.ts)
      deleted++
    }
  }
  return deleted
}

/** 列出历史（按时间倒序） */
export async function listHistory(): Promise<AutoBackupHistoryItem[]> {
  const items = await idbGetAll()
  return items.sort((a, b) => b.ts - a.ts)
}

/** 删除某份历史 */
export async function removeHistory(ts: number): Promise<void> {
  await idbDelete(ts)
}

/** 从历史恢复（手动触发恢复流程） */
export async function restoreFromHistory(ts: number): Promise<void> {
  const items = await listHistory()
  const item = items.find(i => i.ts === ts)
  if (!item || item.status !== 'success' || !item.data) {
    throw new Error('历史记录不存在或备份数据不完整')
  }
  // 复用 lib/backup.ts 的 importLocalData
  const { importLocalData } = await import('./backup')
  await importLocalData(item.data)
}

/** 清空全部历史 */
export async function clearAllHistory(): Promise<void> {
  const db = await openDB()
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// ─── 调度器（App 根部挂载一次） ───

let _intervalId: ReturnType<typeof setInterval> | null = null

/**
 * 启动定时检查（每小时一次）。
 * 只需要在 App 根部调用一次。可在卸载时 stopAutoBackupScheduler()。
 */
export function startAutoBackupScheduler(): void {
  if (_intervalId) return // 已启动

  // 立即检查一次（防止 App 启动时刚好错过时间窗）
  _doCheck()
  // 每小时检查
  _intervalId = setInterval(_doCheck, 60 * 60 * 1000)
}

export function stopAutoBackupScheduler(): void {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null }
}

async function _doCheck() {
  try {
    const cfg = loadConfig()
    if (!shouldRunNow(cfg)) return
    await runBackupNow()
    // 成功后主动清理一下过期（防止 retention 改大后老数据堆积）
    await cleanupExpired()
  } catch { /* 静默 — 错误已写入 localStorage 状态 + history */ }
}

/** 预设时间选项（给 UI 用） */
export const TIME_OPTIONS: { value: string; label: string }[] = [
  { value: '01:00', label: '01:00（凌晨）' },
  { value: '02:00', label: '02:00（凌晨）' },
  { value: '03:00', label: '03:00（默认）' },
  { value: '04:00', label: '04:00（凌晨）' },
  { value: '05:00', label: '05:00（清晨）' },
  { value: '06:00', label: '06:00（清晨）' },
  { value: '22:00', label: '22:00（晚上）' },
  { value: '23:00', label: '23:00（深夜）' },
]

export const RETENTION_OPTIONS: { value: string; label: string }[] = [
  { value: '3',  label: '3 天' },
  { value: '7',  label: '7 天（默认）' },
  { value: '14', label: '14 天' },
  { value: '30', label: '30 天' },
]
