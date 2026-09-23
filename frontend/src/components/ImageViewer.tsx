import { useEffect, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, Trash2 } from 'lucide-react'

/**
 * 全屏大图浏览（QQ空间式 lightbox）
 *
 * - 左右切换（按钮 / 键盘 ←→ / Esc 关闭）
 * - 底部计数与说明文字（相册：日期 + caption）
 * - 可选删除按钮（相册属主可删；朋友圈只读无删除）
 *
 * props：
 * - images: 图片 data URL 数组
 * - index: 当前索引（受控）
 * - onIndexChange: 索引变化回调
 * - onClose: 关闭回调
 * - caption: 当前图片说明（可选）
 * - onDelete: 删除回调（可选，不传则不显示删除按钮）
 */
interface ImageViewerProps {
  images: string[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
  caption?: string
  onDelete?: () => void
}

export function ImageViewer({ images, index, onIndexChange, onClose, caption, onDelete }: ImageViewerProps) {
  const prev = useCallback(() => {
    if (index > 0) onIndexChange(index - 1)
  }, [index, onIndexChange])

  const next = useCallback(() => {
    if (index < images.length - 1) onIndexChange(index + 1)
  }, [index, images.length, onIndexChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowLeft') prev()
      else if (e.key === 'ArrowRight') next()
    }
    window.addEventListener('keydown', onKey)
    // 阻止背景滚动
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, prev, next])

  if (!images.length) return null

  return (
    <div className="fixed inset-0 z-[100] bg-black/95 flex flex-col select-none">
      {/* 顶栏：计数 + 删除 + 关闭 */}
      <div className="flex items-center justify-between px-4 py-3 text-white/90">
        <span className="text-sm tabular-nums">{index + 1} / {images.length}</span>
        <div className="flex items-center gap-2">
          {onDelete && (
            <button
              onClick={onDelete}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              title="删除这张照片"
            >
              <Trash2 size={18} />
            </button>
          )}
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 transition-colors"
            title="关闭"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 大图区域 */}
      <div className="flex-1 relative flex items-center justify-center px-12 min-h-0">
        <img
          src={images[index]}
          alt=""
          className="max-w-full max-h-full object-contain"
          draggable={false}
        />
        {/* 左右切换 */}
        {index > 0 && (
          <button
            onClick={prev}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="上一张"
          >
            <ChevronLeft size={22} />
          </button>
        )}
        {index < images.length - 1 && (
          <button
            onClick={next}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            title="下一张"
          >
            <ChevronRight size={22} />
          </button>
        )}
      </div>

      {/* 底部说明 */}
      {caption && (
        <div className="px-4 py-3 text-center text-sm text-white/80 truncate">
          {caption}
        </div>
      )}
    </div>
  )
}
