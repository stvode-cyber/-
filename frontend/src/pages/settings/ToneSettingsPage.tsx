import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import Header from '../../components/Header'
import { SelectableCard, SelectableCardGroup } from '../../components/ui/selectable-card'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { useAuthStore, type UserInfo } from '../../stores/auth'
import { toneMeta } from '../../lib/utils'

/**
 * AI 语气偏好页（设置子页）
 *
 * 从原 SettingsPage 拆出：9 种语气模式网格选择（3 列），实时保存（乐观更新）。
 *
 * 接口：
 * - PATCH /auth/me { preferredTone }  切换对话语气
 *
 * v1.0.2 — 改用 SelectableCard 组件，补全 ARIA 无障碍：
 *   role="radio" + aria-checked + keyboard ArrowLeft/Right 导航（grid 模式）
 */

export default function ToneSettingsPage() {
  const toast = useToast((s) => s.show)
  const { user, updateUser } = useAuthStore()
  const [saving, setSaving] = useState(false)

  /** 切换语气偏好（乐观更新，失败回滚） */
  const changeTone = async (tone: string) => {
    if (tone === user?.preferredTone || saving) return
    setSaving(true)
    const prev = user?.preferredTone
    // 乐观更新
    updateUser({ preferredTone: tone })
    try {
      const updated = await unwrap<UserInfo>(
        api.patch('/auth/me', { preferredTone: tone }),
      )
      updateUser(updated)
      toast('语气偏好已切换', 'success')
    } catch (err) {
      // 回滚
      updateUser({ preferredTone: prev || 'gentle' })
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const tones = Object.entries(toneMeta)

  return (
    <div className="app-shell">
      <Header title="AI 语气偏好" />

      <div className="px-3 py-4 space-y-4">
        <section className="card" aria-labelledby="tone-card-label">
          <p id="tone-card-label" className="text-xs text-gray-400 mb-3">
            选择角角与你的对话风格
          </p>

          <SelectableCardGroup
            name="preferred-tone"
            variant="grid"
            ariaLabelledBy="tone-card-label"
          >
            {tones.map(([key, meta]) => (
              <SelectableCard
                key={key}
                groupName="preferred-tone"
                value={key}
                selected={user?.preferredTone === key}
                onSelect={changeTone}
                label={meta.label}
                icon={<span className="text-xl" aria-hidden="true">{meta.emoji}</span>}
                variant="grid"
                disabled={saving}
                testId={`tone-${key}`}
              />
            ))}
          </SelectableCardGroup>

          {saving && (
            <div className="mt-2 text-center text-xs text-gray-400 flex items-center justify-center gap-1" role="status" aria-live="polite">
              <Loader2 size={12} className="animate-spin" /> 保存中...
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
