import { useEffect, useRef, useState, useCallback } from 'react'
import {
  listStickyNotes,
  createStickyNote,
  updateStickyNote,
  deleteStickyNote,
  type StickyNoteDTO,
} from '../lib/api'
import { useToast } from './Toast'
import { X, Plus, GripVertical } from 'lucide-react'

export const STICKY_COLORS: { key: string; bg: string; border: string; text: string }[] = [
  { key: 'yellow', bg: '#fef3c7', border: '#fcd34d', text: '#78350f' },
  { key: 'pink', bg: '#fce7f3', border: '#f9a8d4', text: '#831843' },
  { key: 'blue', bg: '#dbeafe', border: '#93c5fd', text: '#1e3a8a' },
  { key: 'green', bg: '#dcfce7', border: '#86efac', text: '#14532d' },
  { key: 'purple', bg: '#ede9fe', border: '#c4b5fd', text: '#4c1d95' },
  { key: 'orange', bg: '#ffedd5', border: '#fdba74', text: '#7c2d12' },
]
const colorMap: Record<string, { bg: string; border: string; text: string }> = Object.fromEntries(
  STICKY_COLORS.map((c) => [c.key, c]),
)

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v))

type DragInfo = {
  id: string
  mode: 'move' | 'resize'
  sx: number
  sy: number
  ox: number
  oy: number
  ow: number
  oh: number
  curX: number
  curY: number
  curW: number
  curH: number
}

interface Props {
  /** 浮窗模式：透明背景、精简工具栏（用于桌面便签浮窗） */
  compact?: boolean
  /** 浮窗关闭回调（仅 compact 模式使用） */
  onClose?: () => void
}

export default function StickyBoard({ compact = false, onClose }: Props) {
  const toast = useToast((s) => s.show)
  const [notes, setNotes] = useState<StickyNoteDTO[]>([])
  const [loading, setLoading] = useState(true)
  const boardRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragInfo | null>(null)
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const load = useCallback(async () => {
    try {
      const list = await listStickyNotes()
      setNotes(list)
    } catch (e: any) {
      toast(e?.message || '便签加载失败', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  // 首次加载 + 定期轮询（与宠物浮窗对齐 15s），使主窗口与浮窗协同
  useEffect(() => {
    load()
    const t = setInterval(() => {
      if (dragRef.current) return // 拖拽进行中，避免覆盖本地尚未落库的位置
      load()
    }, 15000)
    return () => clearInterval(t)
  }, [load])

  // 全局拖拽 / 缩放监听（仅挂载一次，状态走 ref）
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current
      if (!d) return
      const dx = e.clientX - d.sx
      const dy = e.clientY - d.sy
      const board = boardRef.current
      const maxX = board ? board.clientWidth - d.ow - 4 : window.innerWidth - d.ow
      const maxY = board ? board.clientHeight - d.oh - 4 : window.innerHeight - d.oh
      if (d.mode === 'move') {
        d.curX = clamp(d.ox + dx, 4, maxX)
        d.curY = clamp(d.oy + dy, 4, maxY)
        setNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, x: d.curX, y: d.curY } : n)))
      } else {
        d.curW = clamp(d.ow + dx, 140, (board ? board.clientWidth : window.innerWidth) - d.curX - 4)
        d.curH = clamp(d.oh + dy, 110, (board ? board.clientHeight : window.innerHeight) - d.curY - 4)
        setNotes((ns) => ns.map((n) => (n.id === d.id ? { ...n, w: d.curW, h: d.curH } : n)))
      }
    }
    const up = () => {
      const d = dragRef.current
      dragRef.current = null
      if (d) {
        const payload = d.mode === 'move' ? { x: d.curX, y: d.curY } : { w: d.curW, h: d.curH }
        updateStickyNote(d.id, payload).catch(() => {})
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const bringToFront = (id: string) => {
    setNotes((ns) => {
      const maxZ = ns.reduce((m, n) => Math.max(m, n.z), 0)
      const target = ns.find((n) => n.id === id)
      if (!target || target.z === maxZ) return ns
      const next = ns.map((n) => (n.id === id ? { ...n, z: maxZ + 1 } : n))
      updateStickyNote(id, { z: maxZ + 1 }).catch(() => {})
      return next
    })
  }

  const startDrag = (e: React.PointerEvent, note: StickyNoteDTO, mode: 'move' | 'resize') => {
    e.preventDefault()
    e.stopPropagation()
    bringToFront(note.id)
    dragRef.current = {
      id: note.id,
      mode,
      sx: e.clientX,
      sy: e.clientY,
      ox: note.x,
      oy: note.y,
      ow: note.w,
      oh: note.h,
      curX: note.x,
      curY: note.y,
      curW: note.w,
      curH: note.h,
    }
  }

  const onContentChange = (id: string, value: string) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, content: value } : n)))
    const timers = saveTimers.current
    const prev = timers.get(id)
    if (prev) clearTimeout(prev)
    timers.set(
      id,
      setTimeout(() => {
        updateStickyNote(id, { content: value }).catch(() => {})
        timers.delete(id)
      }, 500),
    )
  }

  const changeColor = (id: string, color: string) => {
    setNotes((ns) => ns.map((n) => (n.id === id ? { ...n, color } : n)))
    updateStickyNote(id, { color }).catch(() => {})
  }

  const remove = async (id: string) => {
    try {
      await deleteStickyNote(id)
      setNotes((ns) => ns.filter((n) => n.id !== id))
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  const add = async () => {
    try {
      const n = await createStickyNote({ x: 60 + notes.length * 12, y: 80 + notes.length * 12 })
      setNotes((ns) => [...ns, n])
    } catch (e: any) {
      toast(e?.message || '新建失败', 'error')
    }
  }

  if (loading) {
    return <div className={compact ? 'w-full h-full' : 'flex-1 flex items-center justify-center text-gray-400'}>加载便签…</div>
  }

  return (
    <div
      ref={boardRef}
      className={compact ? 'w-full h-full relative overflow-hidden' : 'relative flex-1 overflow-auto bg-gray-50'}
      style={compact ? undefined : { minHeight: '60vh' }}
    >
      {/* 顶部工具条：新建便签按钮（两种模式都显示）+ 关闭（仅浮窗）——磨砂玻璃风，与其他浮窗统一 */}
      <div className="absolute top-2 right-2 z-50 flex gap-1.5">
        <button
          onClick={add}
          className="p-1.5 rounded-full text-gray-700 hover:text-primary-600 transition-colors cursor-pointer"
          style={{
            background: 'rgba(255,255,255,0.72)',
            backdropFilter: 'blur(40px) saturate(180%)',
            WebkitBackdropFilter: 'blur(40px) saturate(180%)',
            border: '1px solid rgba(255,255,255,0.65)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          }}
          title="新建便签"
        >
          <Plus size={16} />
        </button>
        {compact && onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded-full text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
            style={{
              background: 'rgba(255,255,255,0.72)',
              backdropFilter: 'blur(40px) saturate(180%)',
              WebkitBackdropFilter: 'blur(40px) saturate(180%)',
              border: '1px solid rgba(255,255,255,0.65)',
              boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
            }}
            title="关闭浮窗"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {notes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 text-sm pointer-events-none">
          还没有便签，点右下角 + 新建一张吧
        </div>
      )}

      {notes.map((n) => {
        const c = colorMap[n.color] || colorMap.yellow
        return (
          <div
            key={n.id}
            className="absolute rounded-2xl flex flex-col transition-shadow duration-200 hover:shadow-[0_8px_32px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.08)]"
            style={{
              left: n.x,
              top: n.y,
              width: n.w,
              height: n.h,
              background: c.bg,
              border: `1px solid ${c.border}`,
              zIndex: n.z,
              color: c.text,
              boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
            }}
          >
            {/* 头部：拖拽手柄 + 删除 + 配色 */}
            <div
              className="flex items-center gap-1 px-2 py-1 cursor-grab active:cursor-grabbing select-none"
              style={{ borderBottom: `1px solid ${c.border}` }}
              onPointerDown={(e) => startDrag(e, n, 'move')}
            >
              <GripVertical size={13} className="opacity-50" />
              <div className="flex gap-1 ml-auto">
                {STICKY_COLORS.map((sc) => (
                  <button
                    key={sc.key}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => changeColor(n.id, sc.key)}
                    className="w-3.5 h-3.5 rounded-full border"
                    style={{ background: sc.bg, borderColor: sc.border, outline: n.color === sc.key ? '2px solid #333' : 'none' }}
                    title={sc.key}
                  />
                ))}
                <button
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => remove(n.id)}
                  className="ml-1 text-gray-500 hover:text-red-600"
                  title="删除"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            {/* 内容 */}
            <textarea
              value={n.content}
              onChange={(e) => onContentChange(n.id, e.target.value)}
              onPointerDown={(e) => {
                e.stopPropagation()
                bringToFront(n.id)
              }}
              placeholder="写点什么…"
              className="flex-1 w-full resize-none bg-transparent outline-none px-2 py-1.5 text-sm leading-snug"
              style={{ color: c.text }}
            />
            {/* 缩放手柄 */}
            <div
              className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
              style={{ background: 'linear-gradient(135deg, transparent 50%, rgba(0,0,0,0.18) 50%)' }}
              onPointerDown={(e) => startDrag(e, n, 'resize')}
            />
          </div>
        )
      })}
    </div>
  )
}
