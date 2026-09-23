import { Sun, Moon, MonitorSmartphone } from 'lucide-react'
import Header from '../../components/Header'
import { SelectableCard, SelectableCardGroup } from '../../components/ui/selectable-card'
import { useThemeStore, type ThemeMode } from '../../stores/theme'

/**
 * 主题模式设置页（设置子页）
 *
 * 三选一：浅色 / 深色 / 跟随系统
 * 切换即时生效，持久化到 localStorage
 *
 * v1.0.2 — 改用 SelectableCard 组件，补全 ARIA 无障碍：
 *   role="radio" + aria-checked + keyboard ArrowUp/Down 导航
 */

interface ModeOption {
  value: ThemeMode
  label: string
  desc: string
  icon: typeof Sun
}

const MODES: ModeOption[] = [
  { value: 'light', label: '浅色模式', desc: '白天使用，清爽明亮', icon: Sun },
  { value: 'dark', label: '深色模式', desc: '夜间使用，护眼省电', icon: Moon },
  { value: 'system', label: '跟随系统', desc: '自动匹配操作系统设置', icon: MonitorSmartphone },
]

export default function ThemeSettingsPage() {
  const { mode, setMode } = useThemeStore()

  return (
    <div className="app-shell">
      <Header title="主题模式" />

      <div className="px-3 py-4 space-y-4">
        <section className="card" aria-labelledby="theme-card-label">
          <p id="theme-card-label" className="text-xs text-gray-400 mb-3">
            选择应用的显示主题，切换即时生效
          </p>

          <SelectableCardGroup name="theme-mode" variant="vertical" ariaLabelledBy="theme-card-label">
            {MODES.map((opt) => {
              const Icon = opt.icon
              return (
                <SelectableCard
                  key={opt.value}
                  groupName="theme-mode"
                  value={opt.value}
                  selected={mode === opt.value}
                  onSelect={(v) => setMode(v as ThemeMode)}
                  label={opt.label}
                  description={opt.desc}
                  icon={<Icon size={20} />}
                  variant="vertical"
                  testId={`theme-${opt.value}`}
                />
              )
            })}
          </SelectableCardGroup>
        </section>

        {/* 预览卡片（纯展示，无需无障碍增强） */}
        <section className="card" aria-label="主题预览效果">
          <p className="text-xs text-gray-400 mb-3">预览效果</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="card-soft p-3">
              <div className="text-xs text-gray-400 mb-1">卡片背景</div>
              <div className="text-sm font-medium text-gray-800">示例文字</div>
              <div className="text-xs text-primary-600 mt-1">主色链接</div>
            </div>
            <div className="card-soft p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </div>
              <div className="flex gap-1 mt-2">
                <span className="badge bg-primary-100 text-primary-700">标签</span>
                <span className="badge bg-gray-100 text-gray-600">次要</span>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
