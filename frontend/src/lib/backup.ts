/**
 * 本地数据备份 / 恢复
 *
 * 将 localStorage（设置/书架/统计等）+ IndexedDB（小说文件）打包为 JSON。
 * 导出时排除敏感凭证（aie_token / aie_user），仅备份业务数据。
 *
 * 格式：
 * {
 *   version: 1,
 *   createdAt: number,
 *   app: 'aie-assistant',
 *   localStorage: { [key]: string },
 *   indexedDB: { [dbName]: { [storeName]: { [key]: BlobMeta } } }
 * }
 *
 * Blob 以 { mime, data: base64 } 形式存储，恢复时转回 Blob。
 */

import { saveBookFile, loadBookFile, listBooks, DB_NAME } from './novelStore'

const BACKUP_VERSION = 1
const APP_ID = 'aie-assistant'

/** 导出时排除的 localStorage 键（含敏感凭证或设备级偏好） */
const EXCLUDED_KEYS = new Set(['aie_token', 'aie_user'])

interface BlobEntry {
  type: string
  mime: string
  data: string // base64
}

export interface BackupData {
  version: number
  createdAt: number
  app: string
  localStorage: Record<string, string>
  indexedDB: Record<string, Record<string, Record<string, BlobEntry>>>
}

// ===== Blob <-> Base64 =====

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result as string
      // result = "data:<mime>;base64,<data>"
      const commaIdx = result.indexOf(',')
      resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function base64ToBlob(data: string, mime: string): Blob {
  const bytes = atob(data)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new Blob([arr], { type: mime })
}

// ===== IndexedDB 全量读取 =====

async function readAllIndexedDB(): Promise<BackupData['indexedDB']> {
  const result: BackupData['indexedDB'] = {}
  // 目前仅 aie-novel-library/books
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1)
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    if (!db.objectStoreNames.contains('books')) return result

    const entries = await new Promise<[string, Blob][]>((resolve, reject) => {
      const tx = db.transaction('books', 'readonly')
      const store = tx.objectStore('books')
      const req = store.getAllKeys()
      const items: [string, Blob][] = []
      req.onsuccess = async () => {
        const keys = req.result as string[]
        if (keys.length === 0) { resolve([]); return }
        let done = 0
        for (const key of keys) {
          const getReq = store.get(key)
          getReq.onsuccess = () => {
            if (getReq.result) items.push([key, getReq.result as Blob])
            done++
            if (done === keys.length) resolve(items)
          }
          getReq.onerror = () => reject(getReq.error)
        }
      }
      req.onerror = () => reject(req.error)
    })

    if (entries.length > 0) {
      const storeData: Record<string, BlobEntry> = {}
      for (const [key, blob] of entries) {
        storeData[key] = {
          type: 'blob',
          mime: blob.type || 'application/octet-stream',
          data: await blobToBase64(blob),
        }
      }
      result[DB_NAME] = { books: storeData }
    }
  } catch {
    /* IndexedDB 不可用时静默跳过 */
  }
  return result
}

// ===== 导出 =====

export interface ExportProgress {
  phase: 'localStorage' | 'indexedDB' | 'serialize' | 'done'
  current: number
  total: number
}

export async function exportLocalData(
  onProgress?: (p: ExportProgress) => void,
): Promise<BackupData> {
  // 1. 收集 localStorage
  onProgress?.({ phase: 'localStorage', current: 0, total: 0 })
  const lsData: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i)
    if (key && !EXCLUDED_KEYS.has(key)) {
      lsData[key] = localStorage.getItem(key) || ''
    }
  }

  // 2. 收集 IndexedDB
  onProgress?.({ phase: 'indexedDB', current: 0, total: listBooks().length })
  const idbData = await readAllIndexedDB()

  // 3. 组装
  onProgress?.({ phase: 'serialize', current: 0, total: 0 })
  const backup: BackupData = {
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    app: APP_ID,
    localStorage: lsData,
    indexedDB: idbData,
  }
  onProgress?.({ phase: 'done', current: 1, total: 1 })
  return backup
}

/** 触发浏览器下载备份文件 */
export function downloadBackup(backup: BackupData): void {
  const json = JSON.stringify(backup)
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const date = new Date(backup.createdAt)
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}_${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}`
  a.href = url
  a.download = `aie-backup_${stamp}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** 计算备份大小（人类可读） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// ===== 导入 =====

export interface ImportResult {
  localStorageKeys: number
  indexedDBEntries: number
}

export interface ImportProgress {
  phase: 'validate' | 'localStorage' | 'indexedDB' | 'done'
  current: number
  total: number
}

/** 解析并校验备份 JSON */
export function parseBackup(json: string): BackupData {
  const data = JSON.parse(json)
  if (!data || typeof data !== 'object') throw new Error('无效的备份文件')
  if (data.app !== APP_ID) throw new Error('非本应用的备份文件')
  if (!data.version || !data.localStorage) throw new Error('备份格式不正确')
  return data as BackupData
}

/** 恢复备份数据（合并模式：保留现有 token，其余键覆盖） */
export async function importLocalData(
  backup: BackupData,
  onProgress?: (p: ImportProgress) => void,
): Promise<ImportResult> {
  // 1. 恢复 localStorage（合并：保留 token/user/theme，其余从备份恢复）
  onProgress?.({ phase: 'localStorage', current: 0, total: Object.keys(backup.localStorage).length })
  let lsCount = 0
  for (const [key, value] of Object.entries(backup.localStorage)) {
    // 跳过凭证键（以防备份中包含旧 token）
    if (EXCLUDED_KEYS.has(key)) continue
    localStorage.setItem(key, value)
    lsCount++
  }

  // 2. 恢复 IndexedDB
  onProgress?.({ phase: 'indexedDB', current: 0, total: 0 })
  let idbCount = 0
  const novelDB = backup.indexedDB[DB_NAME]
  if (novelDB?.books) {
    const entries = Object.entries(novelDB.books)
    onProgress?.({ phase: 'indexedDB', current: 0, total: entries.length })
    for (const [key, entry] of entries) {
      if (entry.type === 'blob' && entry.data) {
        const blob = base64ToBlob(entry.data, entry.mime)
        await saveBookFile(key, blob)
        idbCount++
        onProgress?.({ phase: 'indexedDB', current: idbCount, total: entries.length })
      }
    }
  }

  onProgress?.({ phase: 'done', current: 1, total: 1 })
  return { localStorageKeys: lsCount, indexedDBEntries: idbCount }
}

/** 预览备份内容（不执行恢复） */
export function previewBackup(backup: BackupData): {
  date: string
  localStorageKeys: string[]
  bookCount: number
  bookTitles: string[]
} {
  const lsKeys = Object.keys(backup.localStorage).filter((k) => !EXCLUDED_KEYS.has(k))
  const novelDB = backup.indexedDB[DB_NAME]
  const bookIds = novelDB?.books ? Object.keys(novelDB.books) : []

  // 尝试从 localStorage 元数据中提取书名
  let bookTitles: string[] = []
  const booksMeta = backup.localStorage['novel_books_v1']
  if (booksMeta) {
    try {
      const books = JSON.parse(booksMeta) as { id: string; title: string }[]
      bookTitles = books.filter((b) => bookIds.includes(b.id)).map((b) => b.title)
    } catch {
      /* ignore */
    }
  }

  return {
    date: new Date(backup.createdAt).toLocaleString('zh-CN'),
    localStorageKeys: lsKeys,
    bookCount: bookIds.length,
    bookTitles,
  }
}
