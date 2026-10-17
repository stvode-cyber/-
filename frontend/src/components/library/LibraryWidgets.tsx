import { useEffect, useMemo, useState, useCallback } from 'react'
import {
  FolderPlus, Tag, Upload, FileText, Image as ImageIcon, Music,
  Video, File, Share2, History, Trash2, Download, X, RefreshCw,
  ChevronRight, Check,
} from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../Toast'
import { EmptyState } from '../StateView'
import { formatDateTime } from '../../lib/utils'
import { getCached, cacheAsset, readCached, isDesktop } from '../../lib/localCache'

// ===== 类型（与后端 DTO 对齐） =====
export interface Space { id: string; name: string }
export interface Folder { id: string; name: string; parentId: string | null; path: string; _count?: { assets: number } }
export interface TagItem { id: string; name: string; _count?: { assetTags: number } }
export interface AssetTag { tag: { id: string; name: string } }
export interface Asset {
  id: string; name: string; type: string; category?: string; size: number; mime: string | null
  storageKey: string | null; folderId: string | null; metadata: string | null
  tags: AssetTag[]; createdAt: string
}
export interface Version { id: string; storageKey: string; size: number; note: string | null; createdAt: string }
export interface ShareResult { token: string; expireAt: string | null; permission: string }

// ===== 常量 =====
export const TYPE_META: Record<string, { label: string; icon: typeof File; color: string }> = {
  document: { label: '文档', icon: FileText, color: 'text-blue-500' },
  image: { label: '图片', icon: ImageIcon, color: 'text-green-500' },
  audio: { label: '音频', icon: Music, color: 'text-purple-500' },
  video: { label: '视频', icon: Video, color: 'text-red-500' },
}
export const TYPES = ['document', 'image', 'audio', 'video'] as const
export const CATEGORY_META: Record<string, { color: string; bg: string }> = {
  票据: { color: 'text-amber-700', bg: 'bg-amber-100' },
  截图: { color: 'text-sky-700', bg: 'bg-sky-100' },
  合同: { color: 'text-rose-700', bg: 'bg-rose-100' },
  文档: { color: 'text-blue-700', bg: 'bg-blue-100' },
  照片: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
  代码: { color: 'text-violet-700', bg: 'bg-violet-100' },
  音频: { color: 'text-purple-700', bg: 'bg-purple-100' },
  视频: { color: 'text-red-700', bg: 'bg-red-100' },
  归档: { color: 'text-orange-700', bg: 'bg-orange-100' },
  其他: { color: 'text-gray-600', bg: 'bg-gray-100' },
}
export const CATEGORIES = ['票据', '截图', '合同', '文档', '照片', '代码', '音频', '视频', '归档', '其他']
export const PAGE_SIZE = 20

export function fmtSize(n?: number | null) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

// ===== 小组件 =====
export function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-panel-200 rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-accent-800">{title}</h2>
          <button onClick={onClose} className="p-1 text-accent-500"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-accent-500 mb-1">{label}</div>
      {children}
    </div>
  )
}

export function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel-300 rounded-xl p-2">
      <div className="text-[11px] text-accent-400">{label}</div>
      <div className="text-sm text-accent-800 truncate">{value}</div>
    </div>
  )
}

export function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast((s) => s.show)
  const copy = () => { navigator.clipboard?.writeText(value); toast('已复制', 'success') }
  return (
    <div>
      <div className="text-[11px] text-accent-500 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className="input flex-1 text-[11px]" />
        <button onClick={copy} className="shrink-0 p-2 rounded-lg bg-primary-100 text-primary-600"><Check size={16} /></button>
      </div>
    </div>
  )
}

// ===== 文件夹节点 =====
export function FolderNode({ label, active, depth, icon, count, onClick }: { label: string; active: boolean; depth: number; icon?: React.ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`w-full flex items-center gap-1 py-1 px-1 rounded-lg text-left text-sm ${active ? 'bg-primary-100 text-primary-600 font-medium' : 'text-accent-700 hover:bg-panel-200'}`}
    >
      {icon || <ChevronRight size={12} className="text-accent-300" />}
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && <span className="text-[10px] text-accent-400">{count}</span>}
    </button>
  )
}

// ===== 上传弹窗 =====
export function UploadModal({ folders, tags, onClose, onSubmit }: {
  folders: Folder[]; tags: TagItem[]; onClose: () => void
  onSubmit: (p: { base64: string; name: string; mime: string; folderId: string | null; tags: string[]; description: string }) => void
}) {
  const toast = useToast((s) => s.show)
  const [file, setFile] = useState<File | null>(null)
  const [folderId, setFolderId] = useState<string>('')
  const [desc, setDesc] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }
  const submit = async () => {
    if (!file) { toast('请选择文件', 'error'); return }
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
      }
      const base64 = btoa(bin)
      await onSubmit({
        base64,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        folderId: folderId || null,
        description: desc,
        tags: tagInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
      })
    } catch (e: any) { toast(e?.message || '上传失败', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell title="上传资产" onClose={onClose}>
      <label className="block border-2 border-dashed border-accent-200 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400">
        <input type="file" onChange={pick} className="hidden" />
        <Upload size={28} className="mx-auto text-accent-400" />
        <div className="mt-2 text-sm text-accent-600">{file ? file.name : '点击选择文件（自动转 base64 上传）'}</div>
      </label>
      <Field label="保存到文件夹">
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="input">
          <option value="">根目录</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </Field>
      <Field label="标签（逗号分隔）">
        <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="如：合同, 重要" className="input" />
        <div className="mt-1 flex gap-1 flex-wrap">
          {tags.map((t) => <span key={t.id} className="text-[10px] text-accent-500">#{t.name}</span>)}
        </div>
      </Field>
      <Field label="描述">
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="input" placeholder="可选" />
      </Field>
      <button onClick={submit} disabled={busy} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium disabled:opacity-50">
        {busy ? '上传中…' : '上传'}
      </button>
    </ModalShell>
  )
}

// ===== 新建文件夹弹窗 =====
export function FolderModal({ folders, onClose, onSubmit }: { folders: Folder[]; onClose: () => void; onSubmit: (name: string, parentId: string | null) => void }) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const submit = () => {
    if (!name.trim()) return
    onSubmit(name.trim(), parentId || null)
  }
  return (
    <ModalShell title="新建文件夹" onClose={onClose}>
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="文件夹名称" /></Field>
      <Field label="父目录">
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
          <option value="">根目录</option>
          {[...folders].sort((a, b) => a.path.localeCompare(b.path)).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </Field>
      <button onClick={submit} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium">创建</button>
    </ModalShell>
  )
}

// ===== 新建标签弹窗 =====
export function TagModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  const submit = () => { if (name.trim()) onSubmit(name.trim()) }
  return (
    <ModalShell title="新建标签" onClose={onClose}>
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="标签名（空间内唯一）" /></Field>
      <button onClick={submit} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium">保存</button>
    </ModalShell>
  )
}

// ===== 资产详情抽屉 =====
export function DetailDrawer({ asset, spaceId, onClose, onChanged, onDelete, onCacheChanged }: {
  asset: Asset; spaceId: string; onClose: () => void; onChanged: () => void; onDelete: (a: Asset) => void
  onCacheChanged?: () => void
}) {
  const toast = useToast((s) => s.show)
  const [versions, setVersions] = useState<Version[]>([])
  const [meta, setMeta] = useState(() => {
    try { return JSON.parse(asset.metadata || '{}') } catch { return {} as any }
  })
  const [desc, setDesc] = useState(meta.description || '')
  const [name, setName] = useState(asset.name)
  const [tab, setTab] = useState<'info' | 'versions' | 'share'>('info')
  const [share, setShare] = useState<ShareResult | null>(null)
  const [sharePwd, setSharePwd] = useState('')
  const [sharePerm, setSharePerm] = useState<'view' | 'download'>('download')
  const [busy, setBusy] = useState(false)
  const [cached, setCached] = useState(false)
  const [caching, setCaching] = useState(false)

  useEffect(() => {
    getCached(asset.id).then(setCached).catch(() => setCached(false))
  }, [asset.id])

  const fetchOnline = async (): Promise<Blob> => {
    const resp = await api.get(`/assets/${asset.id}/file`, { responseType: 'blob' })
    return resp.data as Blob
  }

  const loadVersions = useCallback(() => {
    unwrap<Version[]>(api.get(`/assets/${asset.id}/versions`)).then(setVersions).catch(() => {})
  }, [asset.id])
  useEffect(() => { loadVersions() }, [loadVersions])

  const download = async () => {
    try {
      let blob: Blob | null = null
      if (await getCached(asset.id)) {
        blob = await readCached(asset.id)
      }
      if (!blob) {
        blob = await fetchOnline()
        cacheAsset(asset.id, asset.name, blob).then(() => {
          setCached(true)
          onCacheChanged?.()
        }).catch(() => {})
      } else {
        toast('已从本机缓存打开（离线可用）', 'success')
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = asset.name; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { toast(e?.message || '下载失败', 'error') }
  }
  const cacheOne = async () => {
    setCaching(true)
    try {
      const blob = await fetchOnline()
      await cacheAsset(asset.id, asset.name, blob)
      setCached(true)
      onCacheChanged?.()
      toast(`已缓存到本机${isDesktop() ? '（磁盘）' : '（本机）'}`, 'success')
    } catch (e: any) { toast(e?.message || '缓存失败', 'error') } finally { setCaching(false) }
  }
  const restore = async (vid: string) => {
    try {
      await unwrap(api.post(`/assets/${asset.id}/versions/${vid}/restore`))
      toast('已恢复到该版本', 'success'); loadVersions(); onChanged()
    } catch (e: any) { toast(e?.message || '恢复失败', 'error') }
  }
  const saveMeta = async () => {
    setBusy(true)
    try {
      await unwrap(api.patch(`/assets/${asset.id}`, { name: name.trim() || asset.name, description: desc }))
      toast('已保存', 'success'); onChanged()
    } catch (e: any) { toast(e?.message || '保存失败', 'error') } finally { setBusy(false) }
  }
  const createShare = async () => {
    setBusy(true)
    try {
      const r = await unwrap<ShareResult>(api.post(`/assets/${asset.id}/share`, {
        permission: sharePerm,
        password: sharePwd || undefined,
        expireAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }))
      setShare(r); toast('分享链接已创建', 'success')
    } catch (e: any) { toast(e?.message || '创建失败', 'error') } finally { setBusy(false) }
  }

  const meta2 = TYPE_META[asset.type] || { label: asset.type }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = share ? `${origin}/api/v1/share/${share.token}` : ''
  const shareFileUrl = share ? `${origin}/api/v1/share/${share.token}/file${sharePwd ? '?password=' + encodeURIComponent(sharePwd) : ''}` : ''

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-panel-200 h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-accent-200">
          <h2 className="text-base font-semibold text-accent-800 truncate">{asset.name}</h2>
          <button onClick={onClose} className="p-1 text-accent-500"><X size={20} /></button>
        </div>

        <div className="flex border-b border-accent-200 text-sm">
          {([['info', '信息'], ['versions', '版本'], ['share', '分享']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? 'text-primary-500 font-medium border-b-2 border-primary-500' : 'text-accent-500'}`}>{l}</button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {tab === 'info' && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="类型" value={meta2.label} />
                <Info label="大小" value={fmtSize(asset.size)} />
                <Info label="智能分类" value={asset.category || '其他'} />
                <Info label="创建时间" value={formatDateTime(asset.createdAt)} />
                <Info label="标签" value={asset.tags.map((t) => '#' + t.tag.name).join(' ') || '—'} />
              </div>
              <button onClick={download} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-500 text-white font-medium"><Download size={18} /> 下载原文件</button>
              {cached ? (
                <div className="flex items-center justify-center gap-1 text-xs text-green-600"><Check size={14} /> 已缓存到本机，断网可用</div>
              ) : (
                <button onClick={cacheOne} disabled={caching} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-panel-300 text-accent-700 text-sm border border-accent-200 font-medium disabled:opacity-50">
                  <RefreshCw size={16} /> {caching ? '缓存中…' : '缓存到本机（离线可用）'}
                </button>
              )}
              <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
              <Field label="描述">
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="input" />
              </Field>
              <button onClick={saveMeta} disabled={busy} className="w-full py-2.5 rounded-xl bg-accent-700 text-white font-medium disabled:opacity-50">保存修改</button>
              <button onClick={() => onDelete(asset)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-500 font-medium"><Trash2 size={18} /> 删除资产</button>
            </>
          )}

          {tab === 'versions' && (
            <div className="space-y-2">
              {versions.length === 0 && <EmptyState text="暂无版本" />}
              {versions.map((v, i) => (
                <div key={v.id} className="flex items-center gap-3 bg-panel-300 rounded-xl p-3">
                  <History size={18} className="text-accent-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-accent-800 truncate">{v.note || ('版本 ' + (versions.length - i))}</div>
                    <div className="text-[11px] text-accent-400">{fmtSize(v.size)} · {formatDateTime(v.createdAt)}</div>
                  </div>
                  <button onClick={() => restore(v.id)} className="text-xs text-primary-500 flex items-center gap-1"><RefreshCw size={14} /> 恢复</button>
                </div>
              ))}
            </div>
          )}

          {tab === 'share' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <select value={sharePerm} onChange={(e) => setSharePerm(e.target.value as any)} className="input flex-1">
                  <option value="download">允许下载</option>
                  <option value="view">仅预览</option>
                </select>
                <input value={sharePwd} onChange={(e) => setSharePwd(e.target.value)} placeholder="访问密码（可选）" className="input flex-1" />
              </div>
              <button onClick={createShare} disabled={busy} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-500 text-white font-medium disabled:opacity-50"><Share2 size={18} /> {share ? '重新生成链接' : '创建分享链接'}</button>

              {share && (
                <div className="bg-panel-300 rounded-xl p-3 space-y-2">
                  <div className="text-xs text-accent-500">公开访问链接（无需登录）</div>
                  <CopyRow label="分享页" value={shareUrl} />
                  <CopyRow label="直接下载" value={shareFileUrl} />
                  {sharePwd && <div className="text-xs text-amber-600">访问密码：{sharePwd}（7 天后过期）</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// 近 30 天新增资产趋势（纯 SVG 折线，无外部依赖）
export function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 300
  const H = 56
  const max = Math.max(1, ...data.map((d) => d.count))
  const step = data.length > 1 ? W / (data.length - 1) : W
  const pts = data.map((d, i) => {
    const x = (i * step).toFixed(1)
    const y = (H - 4 - (d.count / max) * (H - 12)).toFixed(1)
    return `${x},${y}`
  })
  const line = pts.join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <polygon points={area} fill="#6366f1" opacity={0.12} />
      <polyline points={line} fill="none" stroke="#6366f1" strokeWidth={1.5} />
    </svg>
  )
}
