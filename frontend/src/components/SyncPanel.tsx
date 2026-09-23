// 桌面端「自动采集与同步」面板（仅 Electron 桌面环境显示）
// 能力：指定文件夹抓取（扫描）→ 自动分类 → 增量同步入库；支持自动监听（文件变化触发同步）。
// 文件读取/扫描在主进程完成（渲染进程无 fs 权限），HTTP 鉴权走前端 api（带 token）。

import { useEffect, useRef, useState } from 'react'
import { FolderSync, FolderPlus, Trash2, RefreshCw, Monitor } from 'lucide-react'
import { api } from '../lib/api'
import { syncAssets, type SyncItem, type SyncResult } from '../lib/api'
import { isDesktop } from '../lib/localCache'
import { useToast } from './Toast'

interface ScanFile { path: string; name: string; ext: string; type: string; size: number; mtime: number }
interface Watch { id: string; folderPath: string; spaceId: string; auto: boolean; last?: SyncResult & { at: number } }
interface DesktopAPI {
  selectFolder: () => Promise<string | null>
  scanFolder: (folderPath: string) => Promise<ScanFile[]>
  readFileBytes: (filePath: string) => Promise<Uint8Array | null>
  watchStart: (watchId: string, folderPath: string) => Promise<boolean>
  watchStop: (watchId: string) => Promise<boolean>
  onFileChanged: (cb: (payload: { watchId: string }) => void) => () => void
}
const desktopAPI = (typeof window !== 'undefined' ? (window as any).desktopAPI : undefined) as DesktopAPI | undefined

function bufToBase64(buf: Uint8Array): string {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK) as unknown as number[])
  }
  return btoa(bin)
}

export default function SyncPanel() {
  const toast = useToast((s) => s.show)
  const [spaces, setSpaces] = useState<{ id: string; name: string }[]>([])
  const [watches, setWatches] = useState<Watch[]>([])
  const [pickSpace, setPickSpace] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const watchesRef = useRef<Watch[]>([])
  const syncTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    api.get('/spaces').then((r) => setSpaces((r.data as any)?.data || [])).catch(() => {})
  }, [])
  useEffect(() => {
    try { setWatches(JSON.parse(localStorage.getItem('aie_watches') || '[]')) } catch { /* ignore */ }
  }, [])
  useEffect(() => {
    watchesRef.current = watches
    localStorage.setItem('aie_watches', JSON.stringify(watches))
  }, [watches])

  // 订阅主进程的文件变化事件，自动同步开启监听的文件夹
  useEffect(() => {
    if (!desktopAPI?.onFileChanged) return
    const off = desktopAPI.onFileChanged(({ watchId }) => {
      const w = watchesRef.current.find((x) => x.id === watchId)
      if (w && w.auto) {
        if (syncTimers.current[w.id]) clearTimeout(syncTimers.current[w.id])
        syncTimers.current[w.id] = setTimeout(() => {
          syncTimers.current[w.id] = undefined as any
          syncWatch(w)
        }, 1200)
      }
    })
    unsubRef.current = off
    return () => {
      off()
      unsubRef.current = null
      // 退出时停止所有自动监听
      if (desktopAPI) watchesRef.current.forEach((w) => { if (w.auto) desktopAPI.watchStop(w.id).catch(() => {}) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const syncWatch = async (w: Watch) => {
    if (!desktopAPI) return
    setBusyId(w.id)
    try {
      const files = (await desktopAPI.scanFolder(w.folderPath)) || []
      const sentKey = 'aie_sent::' + w.folderPath
      const sent = JSON.parse(localStorage.getItem(sentKey) || '{}')
      const batch: SyncItem[] = []
      const included = new Set<string>()
      const meta = new Map<string, { m: number; s: number }>()
      for (const f of files) {
        const m = Math.round(f.mtime)
        const prev = sent[f.path]
        if (prev && prev.m === m && prev.s === f.size) continue // 未变化，跳过
        const bytes = await desktopAPI.readFileBytes(f.path)
        if (!bytes) continue
        batch.push({ name: f.name, base64: bufToBase64(new Uint8Array(bytes)), localPath: f.path, localMtime: m })
        included.add(f.path)
        meta.set(f.path, { m, s: f.size })
      }
      if (!batch.length) {
        toast('没有新增或变化的文件', 'success')
        setBusyId(null)
        return
      }
      let created = 0, updated = 0, skipped = 0, total = 0
      for (let i = 0; i < batch.length; i += 50) {
        const r = await syncAssets({ spaceId: w.spaceId, items: batch.slice(i, i + 50), autoTag: true })
        created += r.created; updated += r.updated; skipped += r.skipped; total += r.total
      }
      for (const p of included) sent[p] = meta.get(p)!
      localStorage.setItem(sentKey, JSON.stringify(sent))
      const last: SyncResult & { at: number } = { created, updated, skipped, total, at: Date.now() }
      setWatches((prev) => prev.map((x) => (x.id === w.id ? { ...x, last } : x)))
      toast(`同步完成：新建${created} 更新${updated} 跳过${skipped}`, 'success')
    } catch (e: any) {
      toast(e?.message || '同步失败', 'error')
    } finally {
      setBusyId(null)
    }
  }

  const addWatch = async () => {
    if (!desktopAPI) { toast('仅桌面端支持', 'error'); return }
    if (!pickSpace) { toast('请先选择空间', 'error'); return }
    const fp = await desktopAPI.selectFolder()
    if (!fp) return
    const w: Watch = { id: crypto.randomUUID(), folderPath: fp, spaceId: pickSpace, auto: false }
    setWatches((prev) => [...prev, w])
    toast('已添加监控文件夹', 'success')
  }

  const removeWatch = async (w: Watch) => {
    if (w.auto && desktopAPI) await desktopAPI.watchStop(w.id).catch(() => {})
    setWatches((prev) => prev.filter((x) => x.id !== w.id))
  }

  const toggleAuto = async (w: Watch) => {
    const next = !w.auto
    if (next && desktopAPI) await desktopAPI.watchStart(w.id, w.folderPath).catch(() => {})
    if (!next && desktopAPI) await desktopAPI.watchStop(w.id).catch(() => {})
    setWatches((prev) => prev.map((x) => (x.id === w.id ? { ...x, auto: next } : x)))
  }

  if (!isDesktop()) return null

  const spaceName = (id: string) => spaces.find((s) => s.id === id)?.name || id

  return (
    <div className="bg-panel-300 rounded-xl p-3 mb-3">
      <div className="flex items-center gap-2 mb-2">
        <Monitor size={18} className="text-primary-500" />
        <h3 className="text-sm font-semibold text-accent-800">PC 自动采集与同步</h3>
        <span className="text-[11px] text-accent-400">指定文件夹抓取 · 自动分类 · 增量入库</span>
      </div>

      <div className="flex items-center gap-2 mb-3">
        <select
          value={pickSpace}
          onChange={(e) => setPickSpace(e.target.value)}
          className="px-2 py-1.5 rounded-lg bg-panel-200 text-sm border border-accent-200 outline-none"
        >
          <option value="">选择空间…</option>
          {spaces.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button
          onClick={addWatch}
          className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm"
        >
          <FolderPlus size={16} /> 添加文件夹
        </button>
      </div>

      {watches.length === 0 && (
        <div className="text-xs text-accent-400 py-2">还没有监控文件夹。选择一个空间后点「添加文件夹」，即可把该目录下的文档/图片/音频/视频自动采集到资料库。</div>
      )}

      <div className="space-y-2">
        {watches.map((w) => (
          <div key={w.id} className="bg-panel-200 rounded-lg p-2 text-sm">
            <div className="flex items-center gap-2">
              <FolderSync size={15} className="text-accent-500 shrink-0" />
              <span className="truncate flex-1 text-accent-800" title={w.folderPath}>{w.folderPath}</span>
              <span className="text-[11px] text-accent-400 shrink-0">{spaceName(w.spaceId)}</span>
            </div>
            <div className="flex items-center gap-2 mt-1.5">
              <label className="flex items-center gap-1 text-[11px] text-accent-500 cursor-pointer select-none">
                <input type="checkbox" checked={w.auto} onChange={() => toggleAuto(w)} className="w-3.5 h-3.5 accent-primary-500" />
                自动监听
              </label>
              <button
                disabled={busyId === w.id}
                onClick={() => syncWatch(w)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-accent-700 text-white text-[11px] disabled:opacity-50"
              >
                <RefreshCw size={13} className={busyId === w.id ? 'animate-spin' : ''} /> {busyId === w.id ? '同步中' : '立即同步'}
              </button>
              <button onClick={() => removeWatch(w)} className="ml-auto p-1 text-accent-300 hover:text-red-500" title="移除">
                <Trash2 size={14} />
              </button>
            </div>
            {w.last && (
              <div className="text-[11px] text-accent-400 mt-1">
                上次：新建 {w.last.created} · 更新 {w.last.updated} · 跳过 {w.last.skipped}（{new Date(w.last.at).toLocaleString()}）
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
