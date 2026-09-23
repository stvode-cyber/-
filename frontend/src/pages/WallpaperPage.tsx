import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import WallpaperCanvas, { type WallpaperTheme } from '../components/WallpaperCanvas'
import { getWallpaper, updateWallpaper, type WallpaperDTO } from '../lib/api'
import { isDesktop } from '../lib/localCache'
import { useToast } from '../components/Toast'
import { Sparkles, MonitorSmartphone, Settings, ChevronDown, Check } from 'lucide-react'

/** 主题定义：带分类、描述、代表色（用于缩略图底色） */
const THEMES: { key: WallpaperTheme; label: string; emoji: string; desc: string; color: string; group: string }[] = [
  { key: 'aurora', label: '极光', emoji: '🌌', desc: '极地光带 · 流动渐变', color: 'from-emerald-500 via-teal-500 to-cyan-600', group: '自然' },
  { key: 'starfield', label: '星空', emoji: '✨', desc: '繁星闪烁 · 深邃夜空', color: 'from-indigo-900 via-purple-900 to-black', group: '自然' },
  { key: 'sakura', label: '樱花飘落', emoji: '🌸', desc: '花瓣飘落 · 暮色粉橙', color: 'from-pink-200 via-rose-300 to-orange-300', group: '自然' },
  { key: 'firefly', label: '萤火虫', emoji: '🪔', desc: '暗夜流萤 · 黄绿微光', color: 'from-green-900 via-yellow-900 to-lime-950', group: '自然' },
  { key: 'stream', label: '流光瀑布', emoji: '🌊', desc: '青紫流光 · 瀑布光带', color: 'from-cyan-400 via-indigo-400 to-purple-500', group: '自然' },
  { key: 'gradient', label: '流光', emoji: '🌈', desc: '彩虹流动 · 色彩变幻', color: 'from-red-500 via-yellow-500 to-blue-500', group: '抽象' },
  { key: 'bubbles', label: '泡泡', emoji: '🫧', desc: '气泡升腾 · 轻柔梦幻', color: 'from-sky-300 via-blue-300 to-cyan-300', group: '抽象' },
  { key: 'pet', label: '宠物漫游', emoji: '🐾', desc: '桌面宠物 · 可爱互动', color: 'from-amber-300 via-orange-300 to-rose-300', group: '趣味' },
]

const DEFAULT_CFG: WallpaperDTO = {
  id: '',
  enabled: false,
  theme: 'aurora',
  speed: 50,
  opacity: 70,
  showPet: true,
  updatedAt: '',
}

export default function WallpaperPage() {
  const [params] = useSearchParams()
  const float = params.get('float') === '1'
  const toast = useToast((s) => s.show)
  const [cfg, setCfg] = useState<WallpaperDTO>(DEFAULT_CFG)
  const [loading, setLoading] = useState(true)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    let cancelled = false
    getWallpaper()
      .then((c) => {
        if (!cancelled) setCfg(c)
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ---- 浮窗精简模式：整屏动画（桌面动态壁纸层）----
  if (float) {
    return (
      <div className="w-full h-full bg-transparent">
        <WallpaperCanvas
          theme={(cfg.theme as WallpaperTheme) || 'aurora'}
          speed={cfg.speed}
          opacity={cfg.opacity}
          showPet={cfg.showPet}
        />
      </div>
    )
  }

  const patch = async (p: Partial<WallpaperDTO>) => {
    setCfg((c) => ({ ...c, ...p }))
    try {
      await updateWallpaper(p)
    } catch (e: any) {
      toast(e?.message || '保存失败', 'error')
    }
  }

  const toggleDesktop = () => {
    try {
      ;(window as any).desktopAPI?.toggleWallpaperWindow?.()
    } catch {
      toast('仅桌面端支持动态壁纸', 'error')
    }
  }

  /** 当前选中主题的信息 */
  const currentTheme = THEMES.find((t) => t.key === cfg.theme) || THEMES[0]
  const groups = [...new Set(THEMES.map((t) => t.group))]

  return (
    <div className="app-shell flex flex-col h-screen">
      {/* 头部 */}
      <div className="bg-gradient-to-br from-primary-500 to-teal-500 text-white px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={20} />
            <span className="text-lg font-bold">动态壁纸</span>
          </div>
          {isDesktop() && (
            <button
              onClick={toggleDesktop}
              className={`px-3 py-1.5 rounded-full text-xs font-medium flex items-center gap-1 ${
                cfg.enabled ? 'bg-white/30' : 'bg-white/15'
              } hover:bg-white/40`}
            >
              <MonitorSmartphone size={14} /> {cfg.enabled ? '桌面已开启' : '应用到桌面'}
            </button>
          )}
        </div>
      </div>

      {/* === 大图预览区（小鸟壁纸模式：主视觉占主导） === */}
      <div className="flex-1 relative overflow-hidden min-h-[240px]">
        <WallpaperCanvas theme={cfg.theme as WallpaperTheme} speed={cfg.speed} opacity={cfg.opacity} showPet={cfg.showPet} />
        {/* 预览叠层信息 */}
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-white text-lg font-bold flex items-center gap-2">
                <span>{currentTheme.emoji}</span> {currentTheme.label}
              </div>
              <div className="text-white/70 text-xs mt-0.5">{currentTheme.desc}</div>
            </div>
            <span className="text-white/50 text-[10px] bg-black/30 px-2 py-0.5 rounded-full">实时预览</span>
          </div>
        </div>
      </div>

      {/* === 底部壁纸选择条（小鸟壁纸模式：横向滑动浏览） === */}
      <div className="shrink-0 bg-white border-t border-gray-100">
        {/* 分类标签 */}
        <div className="flex gap-2 px-4 pt-3 pb-1 overflow-x-auto">
          {groups.map((g) => (
            <span key={g} className="px-2.5 py-0.5 rounded-full text-[11px] bg-gray-100 text-gray-500 whitespace-nowrap">
              {g}
            </span>
          ))}
        </div>

        {/* 壁纸缩略图横向列表 */}
        <div className="flex gap-3 px-4 py-3 overflow-x-auto">
          {THEMES.map((th) => {
            const active = cfg.theme === th.key
            return (
              <button
                key={th.key}
                onClick={() => patch({ theme: th.key })}
                className={`relative shrink-0 w-24 rounded-xl overflow-hidden border-2 transition-all ${
                  active ? 'border-primary-500 scale-105 shadow-lg' : 'border-transparent opacity-80 hover:opacity-100'
                }`}
              >
                {/* 缩略图渐变底色 */}
                <div className={`h-16 bg-gradient-to-br ${th.color} flex items-center justify-center`}>
                  <span className="text-2xl">{th.emoji}</span>
                </div>
                {/* 标签 */}
                <div className="px-1.5 py-1 text-center">
                  <div className={`text-[11px] font-medium ${active ? 'text-primary-600' : 'text-gray-600'}`}>{th.label}</div>
                </div>
                {/* 选中标记 */}
                {active && (
                  <div className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary-500 flex items-center justify-center">
                    <Check size={12} className="text-white" />
                  </div>
                )}
              </button>
            )
          })}
        </div>

        {/* === 设置折叠面板 === */}
        <div className="border-t border-gray-50">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            <span className="flex items-center gap-1.5">
              <Settings size={15} /> 高级设置
            </span>
            <ChevronDown size={16} className={`transition-transform ${showSettings ? 'rotate-180' : ''}`} />
          </button>

          {showSettings && (
            <div className="px-4 pb-4 space-y-3">
              {/* 速度 */}
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>动画速度</span>
                  <span className="tabular-nums">{cfg.speed}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={cfg.speed}
                  onChange={(e) => patch({ speed: Number(e.target.value) })}
                  className="w-full accent-primary-500"
                />
              </div>
              {/* 不透明度 */}
              <div>
                <div className="flex justify-between text-xs text-gray-600 mb-1">
                  <span>不透明度</span>
                  <span className="tabular-nums">{cfg.opacity}%</span>
                </div>
                <input
                  type="range"
                  min={10}
                  max={100}
                  value={cfg.opacity}
                  onChange={(e) => patch({ opacity: Number(e.target.value) })}
                  className="w-full accent-primary-500"
                />
              </div>
              {/* 显示宠物 */}
              <label className="flex items-center justify-between py-1">
                <span className="text-xs text-gray-700">壁纸上显示宠物漫游</span>
                <input
                  type="checkbox"
                  checked={cfg.showPet}
                  onChange={(e) => patch({ showPet: e.target.checked })}
                  className="w-4 h-4 accent-primary-500"
                />
              </label>
            </div>
          )}
        </div>

        {/* 非桌面端提示 */}
        {!isDesktop() && (
          <div className="px-4 py-3 text-center text-xs text-gray-400">
            动态壁纸为电脑端专属功能，请在 Windows 桌面端体验
          </div>
        )}
      </div>
    </div>
  )
}
