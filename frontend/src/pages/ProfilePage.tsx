import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../components/Toast'
import { api, unwrap } from '../lib/api'
import { compressAvatarImage } from '../lib/imageCompress'
import {
  Wallet, ListTodo, UtensilsCrossed, Coins, Bell, ChevronRight, LogOut,
  Settings, ClipboardList, Puzzle, Mic, Radio, Camera, Loader2,
  Clock, Moon, ArrowUpRight, FolderOpen, PawPrint, StickyNote, Sparkles, Compass, CalendarCheck, Heart, BookOpen,
  Timer, Flame, Smile, BarChart3, Check, X, Edit3, Plus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { isDesktop } from '../lib/localCache'

/**
 * 效率模块完整清单（自选用）
 * 用户可在「效率模块自选」弹窗里勾选要在我的页面显示的项
 * 存储于 localStorage，键名 PROFILE_EFFICIENCY_MODULES
 */
const EFFICIENCY_MODULE_LIST: { to: string; icon: LucideIcon; label: string; desc: string }[] = [
  { to: '/pomodoro', icon: Timer, label: '番茄钟', desc: '专注计时 · 提升效率' },
  { to: '/habit', icon: Flame, label: '习惯追踪', desc: '每日打卡 · 连续天数' },
  { to: '/review', icon: BarChart3, label: '每周回顾', desc: '习惯/专注/阅读周报' },
  { to: '/calendar', icon: CalendarCheck, label: '日历视图', desc: '月视图 · 日程安排' },
]

const STORAGE_KEY = 'PROFILE_EFFICIENCY_MODULES'

/** 读取已选效率模块路径列表；未配置时默认全选 */
function loadSelectedModules(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set(EFFICIENCY_MODULE_LIST.map((m) => m.to))
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return new Set(EFFICIENCY_MODULE_LIST.map((m) => m.to))
    return new Set(arr.filter((x) => typeof x === 'string'))
  } catch {
    return new Set(EFFICIENCY_MODULE_LIST.map((m) => m.to))
  }
}

/** 持久化已选效率模块 */
function saveSelectedModules(set: Set<string>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(set)))
}

/** 列表图标颜色配置（无圆圈，直接给图标上色） */
const ICON_COLORS: Record<string, string> = {
  // 生活助理
  '待办事项': 'text-blue-500',
  '倒计时': 'text-cyan-500',
  // 财务
  '财务记账': 'text-emerald-500',
  '我的钱包': 'text-amber-500',
  // 社交
  '朋友圈': 'text-pink-500',
  '相册': 'text-purple-500',
  // 常用功能
  '工作交接表': 'text-indigo-500',
  '碎片收藏': 'text-orange-500',
  '录音纪要': 'text-rose-500',
  '实时纪要': 'text-red-500',
  '资料库': 'text-teal-500',
  '我的宠物': 'text-lime-600',
  '趣味占卜': 'text-fuchsia-500',
  // 效率
  '番茄钟': 'text-red-500',
  '习惯追踪': 'text-orange-500',
  '每周回顾': 'text-green-500',
  '日历视图': 'text-blue-500',
  // 桌面工具
  '桌面便签': 'text-yellow-500',
  '动态壁纸': 'text-violet-500',
}

/**
 * 个人中心页
 *
 * 头部：美团风格渐变背景 + 头像/昵称叠加
 * 列表：QQ 风格列表式（图标圆圈 + 文字 + 右箭头，白色卡片 + 分隔线）
 */
export default function ProfilePage() {
  const { user, logout, updateUser } = useAuthStore()
  const toast = useToast((s) => s.show)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // 效率模块自选：默认全选，存 localStorage
  const [selectedModules, setSelectedModules] = useState<Set<string>>(() => loadSelectedModules())
  const [showEfficiencyDialog, setShowEfficiencyDialog] = useState(false)
  const [draftSelection, setDraftSelection] = useState<Set<string>>(new Set())

  const openEfficiencyDialog = () => {
    setDraftSelection(new Set(selectedModules))
    setShowEfficiencyDialog(true)
  }

  const toggleModule = (to: string) => {
    setDraftSelection((prev) => {
      const next = new Set(prev)
      if (next.has(to)) next.delete(to)
      else next.add(to)
      return next
    })
  }

  const saveEfficiencySelection = () => {
    if (draftSelection.size === 0) {
      toast('至少需要保留一项效率模块', 'warning')
      return
    }
    setSelectedModules(new Set(draftSelection))
    saveSelectedModules(new Set(draftSelection))
    setShowEfficiencyDialog(false)
    toast(`已保留 ${draftSelection.size} 项效率模块`, 'success')
  }

  const toggleAll = () => {
    if (draftSelection.size === EFFICIENCY_MODULE_LIST.length) {
      setDraftSelection(new Set())
    } else {
      setDraftSelection(new Set(EFFICIENCY_MODULE_LIST.map((m) => m.to)))
    }
  }

  const onAvatarClick = () => {
    if (uploading) return
    fileInputRef.current?.click()
  }

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('图片不能超过 5MB', 'error')
      return
    }
    setUploading(true)
    try {
      const dataUrl = await compressAvatarImage(file, 256, 0.85)
      await unwrap(api.post('/auth/avatar', { avatar: dataUrl }))
      updateUser({ avatar: dataUrl })
      toast('头像已更新', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '头像上传失败', 'error')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  // QQ 风格列表项数据
  interface ListItem {
    to?: string
    icon: LucideIcon
    label: string
    iconColor: string
    onClick?: () => void
  }
  interface Section {
    title: string
    items: ListItem[]
  }

  const sections: Section[] = [
    {
      title: '生活助理',
      items: [
        { to: '/tasks', icon: ListTodo, label: '待办事项', iconColor: ICON_COLORS['待办事项'] },
        { to: '/countdowns', icon: Clock, label: '倒计时', iconColor: ICON_COLORS['倒计时'] },
      ],
    },
    {
      title: '财务',
      items: [
        { to: '/finance', icon: Coins, label: '财务记账', iconColor: ICON_COLORS['财务记账'] },
        { to: '/wallet', icon: Wallet, label: '我的钱包', iconColor: ICON_COLORS['我的钱包'] },
      ],
    },
    {
      title: '社交分享',
      items: [
        { to: '/moments', icon: Sparkles, label: '朋友圈', iconColor: ICON_COLORS['朋友圈'] },
        { to: '/album', icon: FolderOpen, label: '相册', iconColor: ICON_COLORS['相册'] },
      ],
    },
    {
      title: '常用功能',
      items: [
        { to: '/voice-memos', icon: Mic, label: '录音纪要', iconColor: ICON_COLORS['录音纪要'] },
        { to: '/library', icon: FolderOpen, label: '个人空间', iconColor: 'text-teal-500' },
        { to: '/pet', icon: PawPrint, label: '我的宠物', iconColor: ICON_COLORS['我的宠物'] },
        { to: '/novel', icon: BookOpen, label: '小说阅读', iconColor: 'text-orange-500' },
      ],
    },
    {
      title: '玄学占卜',
      items: [
        { to: '/horoscope', icon: Sparkles, label: '星座运势', iconColor: 'text-fuchsia-500' },
        { to: '/iching', icon: Sparkles, label: '周易八卦', iconColor: 'text-purple-500' },
        { to: '/bazi', icon: Sparkles, label: '八字命理', iconColor: 'text-indigo-500' },
        { to: '/zodiac-match', icon: Sparkles, label: '生肖配对', iconColor: 'text-pink-500' },
      ],
    },
    {
      title: '效率',
      items: EFFICIENCY_MODULE_LIST
        .filter((m) => selectedModules.has(m.to))
        .map((m) => ({ to: m.to, icon: m.icon, label: m.label, iconColor: ICON_COLORS[m.label] || 'bg-primary-500' })),
    },
    ...(isDesktop()
      ? [{
          title: '桌面工具',
          items: [
            { to: '/sticky', icon: StickyNote, label: '桌面便签', iconColor: ICON_COLORS['桌面便签'] },
            { to: '/wallpaper', icon: Sparkles, label: '动态壁纸', iconColor: ICON_COLORS['动态壁纸'] },
          ] as ListItem[],
        }]
      : []),
  ]

  // 判断头像是否为图片
  const isImageAvatar = user?.avatar && (
    user.avatar.startsWith('data:image') || user.avatar.startsWith('http') || user.avatar.startsWith('/')
  )

  return (
    <div className="app-shell pb-4">
      <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onFileChange} />

      {/* === 用户信息 + 等级 一体化卡片 === */}
      <div className="px-3 pt-3">
        <div className="card p-4">
        {/* 内容层 */}
        <div>
          {/* 顶部行：设置齿轮 */}
          <div className="flex justify-end mb-2">
            <Link
              to="/settings"
              className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
              aria-label="设置"
            >
              <Settings size={14} className="text-gray-500" />
            </Link>
          </div>

          {/* 头像 + 昵称 + 角角号 */}
          <div className="flex items-center gap-3">
            <button
              onClick={onAvatarClick}
              disabled={uploading}
              className="relative rounded-full overflow-hidden group disabled:opacity-60 ring-2 ring-gray-100 transition-transform active:scale-95 shrink-0"
              style={{ width: '2.75rem', height: '2.75rem' }}
              aria-label="更换头像"
            >
              {isImageAvatar ? (
                <img src={user!.avatar} alt="头像" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full bg-gray-100 flex items-center justify-center">
                  <span className="text-lg">{user?.avatar || '👤'}</span>
                </div>
              )}
              <span className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                {uploading ? <Loader2 size={14} className="animate-spin text-white" /> : <Camera size={14} className="text-white" />}
              </span>
            </button>
            <div className="flex-1 min-w-0">
              <div className="text-base font-bold text-gray-800 truncate">{user?.nickname || user?.username}</div>
              <div className="text-[11px] text-gray-400 truncate mt-0.5">角角号：{userIdCode(user?.id || user?.username || '')}</div>
            </div>
            {/* 等级标 */}
            <div className="flex items-center gap-1 shrink-0">
              <span className="text-xs">{user?.levelInfo?.icon || '⭐'}</span>
              <span className="text-sm font-bold text-gray-700">Lv{user?.levelInfo?.level ?? 0}</span>
            </div>
          </div>

          {/* 等级进度条 + 在线时长 */}
          <div className="mt-2.5 flex items-center gap-2">
            <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-gray-300" style={{ width: `${user?.levelInfo?.progress ?? 0}%` }} />
            </div>
            <span className="text-[10px] text-gray-400 whitespace-nowrap">在线 {user?.levelInfo?.totalOnlineHours ?? 0}h · {user?.levelInfo?.title || ''}</span>
          </div>

          {/* 本周目标 */}
          {user?.primaryGoal && (
            <div className="mt-2 rounded-lg bg-gray-50 px-2.5 py-1.5">
              <div className="text-[10px] text-gray-400">🎯 本周目标</div>
              <div className="text-xs mt-0.5 font-medium text-gray-600">{user.primaryGoal}</div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* === 钱包 + 明细（一个区域，两个选项） === */}
      <div className="px-3 mt-2.5">
        <div className="card overflow-hidden">
          <div className="grid grid-cols-2 divide-x divide-gray-50">
            <Link to="/wallet" className="flex items-center justify-center gap-1.5 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer">
              <Wallet size={15} className="text-amber-500" />
              <span className="text-sm text-gray-800">钱包</span>
            </Link>
            <Link to="/wallet/transactions" className="flex items-center justify-center gap-1.5 py-2.5 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer">
              <ClipboardList size={15} className="text-sky-500" />
              <span className="text-sm text-gray-800">明细</span>
            </Link>
          </div>
        </div>
      </div>

      {/* === QQ 风格列表：图标无圆圈 + 文字 + 右箭头 === */}
      <div className="px-3 mt-3 space-y-2.5">
        {sections.map((sec) => (
          <div key={sec.title}>
            {/* 分区标题 */}
            <div className="flex items-center justify-between px-1 pb-1">
              <div className="text-[11px] text-gray-400 font-medium">{sec.title}</div>
              {sec.title === '效率' && (
                <button
                  onClick={openEfficiencyDialog}
                  className="text-gray-400 hover:text-primary-500 flex items-center"
                >
                  <Plus size={16} />
                </button>
              )}
            </div>
            {/* 列表卡片 */}
            <div className="card overflow-hidden">
              {sec.items.length === 0 ? (
                <div className="px-4 py-3 text-xs text-gray-400 text-center">
                  暂未勾选任何效率模块，点击「自选」添加
                </div>
              ) : (
                sec.items.map((item, idx) => {
                  const Icon = item.icon
                  const row = (
                    <div className={`flex items-center gap-2.5 px-3 py-2.5 ${idx > 0 ? 'border-t border-gray-50' : ''} hover:bg-gray-50 active:bg-gray-100 transition-colors`}>
                      {/* 图标无圆圈 */}
                      <Icon size={18} className={`${item.iconColor} shrink-0`} />
                      {/* 文字 */}
                      <span className="flex-1 text-sm text-gray-800">{item.label}</span>
                      {/* 右箭头 */}
                      <ChevronRight size={15} className="text-gray-300" />
                    </div>
                  )
                  return item.to ? (
                    <Link key={item.label} to={item.to} className="block no-underline">{row}</Link>
                  ) : (
                    <button key={item.label} onClick={item.onClick} className="block w-full text-left">{row}</button>
                  )
                })
              )}
            </div>
          </div>
        ))}

        {/* 退出登录已移至设置页 */}

        <div className="text-center text-[10px] text-gray-400 pt-1">
          绿角犀 · 角角 v1.0.6
        </div>
      </div>

      {/* 效率模块自选弹窗 */}
      {showEfficiencyDialog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50" onClick={() => setShowEfficiencyDialog(false)}>
          <div className="bg-white rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">效率模块自选</h3>
              <button onClick={() => setShowEfficiencyDialog(false)} aria-label="关闭" className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-50 text-xs">
              <span className="text-gray-500">已选 {draftSelection.size} / 共 {EFFICIENCY_MODULE_LIST.length} 项</span>
              <button onClick={toggleAll} className="text-primary-600 hover:text-primary-700">
                {draftSelection.size === EFFICIENCY_MODULE_LIST.length ? '全不选' : '全选'}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {EFFICIENCY_MODULE_LIST.map((m) => {
                const checked = draftSelection.has(m.to)
                const Icon = m.icon
                return (
                  <button
                    key={m.to}
                    onClick={() => toggleModule(m.to)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${checked ? 'bg-primary-50' : 'hover:bg-gray-50'}`}
                  >
                    <div className={`w-5 h-5 rounded-md border flex items-center justify-center flex-shrink-0 ${checked ? 'bg-primary-500 border-primary-500' : 'border-gray-300'}`}>
                      {checked && <Check size={14} className="text-white" />}
                    </div>
                    <Icon size={18} className={`${ICON_COLORS[m.label] || 'text-primary-500'} flex-shrink-0`} />
                    <div className="flex-1 min-w-0 text-left">
                      <div className="text-sm text-gray-800 font-medium">{m.label}</div>
                      <div className="text-xs text-gray-400 truncate">{m.desc}</div>
                    </div>
                  </button>
                )
              })}
            </div>
            <div className="p-4 border-t border-gray-100 flex gap-2">
              <button onClick={() => setShowEfficiencyDialog(false)} className="flex-1 py-2 text-sm text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">取消</button>
              <button onClick={saveEfficiencySelection} disabled={draftSelection.size === 0} className="flex-1 py-2 text-sm text-white bg-primary-500 hover:bg-primary-600 rounded-lg transition-colors disabled:opacity-50">保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 角角号：由用户唯一 ID 稳定哈希出的 9 位数字身份号
 */
export function userIdCode(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return String(100000000 + (h % 900000000))
}

