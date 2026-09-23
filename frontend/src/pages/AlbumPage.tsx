import { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Camera, Image as ImageIcon, Loader2, Plus, ArrowLeft } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState } from '../components/StateView'
import { compressImage } from '../lib/imageCompress'
import { ImageViewer } from '../components/ImageViewer'

/** 照片结构（与后端 Photo 序列化对应） */
interface Photo {
  id: string
  dataUrl: string
  caption: string | null
  takenAt: string
  createdAt: string
}

/** 月份分组（QQ空间时间线：2026年8月 · 12 张） */
interface MonthGroup {
  key: string // YYYY-MM
  label: string // 2026年8月
  photos: Photo[]
}

/** 按拍摄时间月份分组（倒序） */
function groupByMonth(photos: Photo[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>()
  for (const p of photos) {
    const d = new Date(p.takenAt || p.createdAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (!map.has(key)) {
      map.set(key, {
        key,
        label: `${d.getFullYear()}年${d.getMonth() + 1}月`,
        photos: [],
      })
    }
    map.get(key)!.photos.push(p)
  }
  return Array.from(map.values()).sort((a, b) => b.key.localeCompare(a.key))
}

/** 日期显示：M月d日 HH:mm */
function formatTaken(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 相册页面（QQ空间式个人相册）
 *
 * 功能：
 * 1. 时间线：照片按月份分组，QQ空间「月份分隔 + 宫格」布局
 * 2. 上传：多选照片 → 前端压缩（1280px）→ 逐张上传 → 刷新
 * 3. 大图浏览：全屏 lightbox，左右切换，显示日期 + 说明
 * 4. 删除：大图浏览中删除（属主校验在后端）
 *
 * 接口：
 * - GET    /photos        照片列表（倒序）
 * - POST   /photos        上传照片（单张，多选循环调用）
 * - DELETE /photos/:id    删除照片
 */
export default function AlbumPage() {
  const toast = useToast((s) => s.show)
  const navigate = useNavigate()
  const [photos, setPhotos] = useState<Photo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 大图浏览
  const [viewerIndex, setViewerIndex] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(false)
      const res = await unwrap<{ list: Photo[]; total: number }>(
        api.get('/photos', { params: { page: 1, pageSize: 200 } }),
      )
      setPhotos(res.list)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    load()
  }, [load])

  /** 上传照片（多选 → 压缩 → 逐张上传） */
  const onUpload = async (files: FileList | null) => {
    if (!files?.length) return
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (!list.length) {
      toast('请选择图片文件', 'warning')
      return
    }
    try {
      setUploading(true)
      let ok = 0
      for (const f of list) {
        try {
          const dataUrl = await compressImage(f, 1280, 0.8)
          await unwrap(api.post('/photos', { dataUrl }))
          ok++
        } catch (err) {
          // 单张失败继续传其余
          console.error('照片上传失败', err)
        }
      }
      if (ok) toast(`已上传 ${ok} 张照片`, 'success')
      if (ok < list.length) toast(`${list.length - ok} 张上传失败`, 'warning')
      await load()
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  /** 删除当前浏览的照片 */
  const deleteCurrent = async () => {
    if (viewerIndex === null) return
    const photo = photos[viewerIndex]
    if (!photo) return
    try {
      await unwrap(api.delete(`/photos/${photo.id}`))
      toast('照片已删除', 'success')
      const next = photos.filter((p) => p.id !== photo.id)
      setPhotos(next)
      if (next.length === 0) setViewerIndex(null)
      else setViewerIndex(Math.min(viewerIndex, next.length - 1))
    } catch (err) {
      toast((err as Error).message, 'error')
    }
  }

  const groups = groupByMonth(photos)
  const current = viewerIndex !== null ? photos[viewerIndex] : null

  return (
    <div className="app-shell pb-4">
      {/* 头部横幅（QQ 风白灰） */}
      <div className="relative overflow-hidden text-slate-800 px-4 pt-5 pb-4 bg-white border-b border-slate-200/70">
        <div className="absolute w-[160px] h-[160px] rounded-full bg-slate-100/80 -top-16 -right-10 pointer-events-none" />
        <div className="absolute w-[100px] h-[100px] rounded-full bg-slate-50 -bottom-10 -left-6 pointer-events-none" />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button
              onClick={() => navigate('/')}
              className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 hover:bg-slate-200 active:scale-95 transition-all shrink-0"
              title="返回主页"
            >
              <ArrowLeft size={16} />
            </button>
            <div>
              <h1 className="text-lg font-bold leading-tight">相册</h1>
              <p className="text-sm text-slate-400">
                照片 · 回忆 {photos.length > 0 && <span className="tabular-nums">· 共 {photos.length} 张</span>}
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => onUpload(e.target.files)}
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="relative flex items-center gap-1 px-3.5 py-2 rounded-full bg-primary-500 text-white text-sm font-medium hover:bg-primary-600 active:scale-95 transition-all disabled:opacity-60"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
            {uploading ? '上传中' : '上传照片'}
          </button>
        </div>
      </div>

      <div className="px-3 pt-3">
        {loading ? (
          <LoadingState text="加载照片中..." />
        ) : error ? (
          <ErrorState text="照片加载失败" onRetry={load} />
        ) : photos.length === 0 ? (
          /* 空状态 */
          <div className="card p-10 text-center">
            <div className="w-16 h-16 mx-auto rounded-full bg-primary-50 flex items-center justify-center text-primary-300 mb-3">
              <ImageIcon size={28} />
            </div>
            <p className="text-sm text-gray-500 font-medium">相册还是空的</p>
            <p className="text-xs text-gray-400 mt-1">上传第一张照片，开始收藏你的回忆</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="mt-4 px-5 py-2 rounded-full text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5 mx-auto"
              style={{ background: 'linear-gradient(135deg, #334155, #1E293B)' }}
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} 上传照片
            </button>
          </div>
        ) : (
          /* 月份分组时间线（QQ空间式） */
          <div className="space-y-4">
            {groups.map((g) => (
              <div key={g.key}>
                {/* 月份分隔标题 */}
                <div className="flex items-center gap-2 mb-2 px-0.5">
                  <span className="w-1 h-4 rounded-full" style={{ background: 'linear-gradient(135deg, #334155, #1E293B)' }} />
                  <span className="text-sm font-bold text-gray-800">{g.label}</span>
                  <span className="text-[10px] text-gray-400">{g.photos.length} 张</span>
                </div>
                {/* 宫格 */}
                <div className="grid grid-cols-3 gap-1.5">
                  {g.photos.map((p) => {
                    const globalIndex = photos.findIndex((x) => x.id === p.id)
                    return (
                      <button
                        key={p.id}
                        onClick={() => setViewerIndex(globalIndex)}
                        className="relative aspect-square rounded-xl overflow-hidden bg-gray-100 group active:opacity-80 transition-opacity"
                      >
                        <img
                          src={p.dataUrl}
                          alt={p.caption || ''}
                          className="w-full h-full object-cover"
                          loading="lazy"
                        />
                        {/* 底部渐变 + 说明（QQ空间缩略图角标） */}
                        {p.caption && (
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent px-1.5 pb-1 pt-4">
                            <span className="text-[9px] text-white truncate block">{p.caption}</span>
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 全屏大图浏览（含删除） */}
      {current && (
        <ImageViewer
          images={photos.map((p) => p.dataUrl)}
          index={viewerIndex!}
          onIndexChange={setViewerIndex}
          onClose={() => setViewerIndex(null)}
          caption={`${formatTaken(current.takenAt || current.createdAt)}${current.caption ? ' · ' + current.caption : ''}`}
          onDelete={deleteCurrent}
        />
      )}
    </div>
  )
}
