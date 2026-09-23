// 本地缓存封装：桌面端走 Electron IPC（写本地磁盘），浏览器兜底走 IndexedDB。
// 用途：资料库资产「下载一部分、其余使用时再下」——已缓存资产断网后仍能从本地读取/预览。

interface DesktopCacheAPI {
  isDesktop: () => boolean
  cacheAsset: (assetId: string, fileName: string, arrayBuffer: ArrayBuffer) => Promise<unknown>
  getCached: (assetId: string) => Promise<unknown>
  readCached: (assetId: string) => Promise<Uint8Array | null>
  removeCached: (assetId: string) => Promise<boolean>
  listCached: () => Promise<string[]>
}

const desktopAPI = (typeof window !== 'undefined' ? (window as any).desktopAPI : undefined) as
  | DesktopCacheAPI
  | undefined

export function isDesktop(): boolean {
  return !!(desktopAPI && desktopAPI.isDesktop && desktopAPI.isDesktop())
}

const DB_NAME = 'aie-asset-cache'
const STORE = 'assets'

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function idbKeys(): Promise<string[]> {
  const db = await openIDB()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).getAllKeys()
    req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String))
    req.onerror = () => reject(req.error)
  })
}

/** 已缓存的 assetId 列表 */
export async function listCached(): Promise<string[]> {
  if (isDesktop() && desktopAPI) return (await desktopAPI.listCached()) || []
  try {
    return await idbKeys()
  } catch {
    return []
  }
}

/** 缓存一个资产的原文（单文件级别，供离线使用） */
export async function cacheAsset(assetId: string, fileName: string, blob: Blob): Promise<void> {
  if (isDesktop() && desktopAPI) {
    const ab = await blob.arrayBuffer()
    await desktopAPI.cacheAsset(assetId, fileName, ab)
    return
  }
  const db = await openIDB()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(blob, assetId)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 是否已缓存 */
export async function getCached(assetId: string): Promise<boolean> {
  if (isDesktop() && desktopAPI) return !!(await desktopAPI.getCached(assetId))
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(assetId)
      req.onsuccess = () => resolve(!!req.result)
      req.onerror = () => resolve(false)
    })
  } catch {
    return false
  }
}

/** 读取已缓存的资产原文（离线可用） */
export async function readCached(assetId: string): Promise<Blob | null> {
  if (isDesktop() && desktopAPI) {
    const u8 = await desktopAPI.readCached(assetId)
    if (!u8) return null
    return new Blob([u8 as unknown as BlobPart])
  }
  try {
    const db = await openIDB()
    return new Promise((resolve) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(assetId)
      req.onsuccess = () => resolve((req.result as Blob) || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

export async function removeCached(assetId: string): Promise<void> {
  if (isDesktop() && desktopAPI) {
    await desktopAPI.removeCached(assetId)
    return
  }
  try {
    const db = await openIDB()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(assetId)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}
