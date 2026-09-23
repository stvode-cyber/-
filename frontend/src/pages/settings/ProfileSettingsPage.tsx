import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Loader2 } from 'lucide-react'
import Header from '../../components/Header'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { useAuthStore, type UserInfo } from '../../stores/auth'

/**
 * 个人资料编辑页（设置子页）
 *
 * 从原 SettingsPage 拆出：头像 emoji 选择 / 昵称 / 本周目标，保存调用 PATCH /auth/me。
 * 图片头像上传请前往个人中心（/profile）。
 *
 * 接口：
 * - PATCH /auth/me  更新个人资料
 */

/** 头像 emoji 候选列表 */
const avatarOptions = ['👤', '🦁', '🐯', '🦊', '🐼', '🦊', '🐨', '🦉', '🐲', '🌸', '🍀', '⭐']

export default function ProfileSettingsPage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const { user, updateUser } = useAuthStore()

  const [nickname, setNickname] = useState(user?.nickname || '')
  const [avatar, setAvatar] = useState(user?.avatar || '👤')
  const [primaryGoal, setPrimaryGoal] = useState(user?.primaryGoal || '')
  const [saving, setSaving] = useState(false)

  /** 保存个人资料（昵称 / 头像 / 本周目标） */
  const save = async () => {
    if (!nickname.trim()) {
      toast('昵称不能为空', 'error')
      return
    }
    setSaving(true)
    try {
      const updated = await unwrap<UserInfo>(
        api.patch('/auth/me', {
          nickname: nickname.trim(),
          avatar,
          primaryGoal: primaryGoal.trim() || null,
        }),
      )
      updateUser(updated)
      toast('资料已保存', 'success')
      navigate(-1)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const isImageAvatar =
    avatar.startsWith('data:image') ||
    avatar.startsWith('http') ||
    avatar.startsWith('/')

  return (
    <div className="app-shell">
      <Header title="个人资料" />

      <div className="px-3 py-4 space-y-4">
        <section className="card">
          {/* 头像选择 */}
          <div className="mb-4">
            <div className="text-xs text-gray-500 mb-2">头像</div>
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-2xl overflow-hidden">
                {isImageAvatar ? (
                  <img src={avatar} alt="头像" className="w-full h-full object-cover" />
                ) : (
                  <span>{avatar}</span>
                )}
              </div>
              <div className="text-xs text-gray-400 flex-1">
                {isImageAvatar ? (
                  <>
                    已设置图片头像，
                    <Link to="/profile" className="text-primary-600">去个人中心更换</Link>
                  </>
                ) : (
                  <>
                    可选择 emoji，或
                    <Link to="/profile" className="text-primary-600">上传图片头像</Link>
                  </>
                )}
              </div>
            </div>
            {/* Emoji 选项 */}
            {!isImageAvatar && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {avatarOptions.map((a, i) => (
                  <button
                    key={i}
                    onClick={() => setAvatar(a)}
                    className={`w-8 h-8 rounded-full flex items-center justify-center text-lg ${
                      avatar === a ? 'bg-primary-100 ring-2 ring-primary-500' : 'bg-gray-100'
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 昵称 */}
          <div className="mb-4">
            <label className="text-xs text-gray-500 block mb-1.5">昵称</label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="请输入昵称"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>

          {/* 本周目标 */}
          <div className="mb-4">
            <label className="text-xs text-gray-500 block mb-1.5">本周目标</label>
            <input
              type="text"
              value={primaryGoal}
              onChange={(e) => setPrimaryGoal(e.target.value)}
              maxLength={50}
              placeholder="本周最想搞定的事"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:border-primary-500 focus:outline-none"
            />
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="btn-primary w-full py-2 text-sm flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            保存资料
          </button>
        </section>
      </div>
    </div>
  )
}
