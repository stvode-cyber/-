import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Building2, ArrowRight, Sparkles, Users, Folder, MessageCircle } from 'lucide-react'
import Header from '../components/Header'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { useAuthStore } from '../stores/auth'

const bootstrapTeam = (name: string, description?: string) =>
  unwrap<any>(api.post('/team/bootstrap', { name, description }))

export default function TeamCreatePage() {
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const { user } = useAuthStore()
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!name.trim()) return toast('团队名不能为空', 'warning')
    setLoading(true)
    try {
      const res = await bootstrapTeam(name.trim(), desc.trim() || undefined)
      toast(res?.message || '团队创建成功', 'success')
      // 同步 auth store 里的团队字段
      useAuthStore.setState((s) => ({
        ...s,
        user: s.user ? { ...s.user, departmentId: res?.me?.departmentId ?? s.user.departmentId, employeeRole: res?.me?.employeeRole ?? s.user.employeeRole } : null,
      }))
      // 优先跳团队对话群（conversationId 后端已返回），没有就跳团队任务
      const convId = res?.conversation?.id
      if (convId) {
        navigate(`/chat/g/${convId}`, { replace: true })
      } else {
        navigate('/team/tasks', { replace: true })
      }
    } catch (e: any) {
      const code = e?.code
      if (code === 'NO_TEAM' || code === 403 || (e?.message && e.message.includes('请先群立团队'))) {
        toast('你还没有团队，请先群立团队', 'warning')
      } else if (e?.message?.includes('已经在团队')) {
        toast('你已经有团队了，无需重复创建', 'warning')
        navigate('/team/tasks', { replace: true })
      } else {
        toast(e?.message || '创建失败', 'error')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleJoinLater = () => {
    toast('好的，以后需要时随时回来群立团队', 'info')
    navigate('/', { replace: true })
  }

  return (
    <div className="pb-10">
      <Header title="群立团队" right={null} />

      <div className="max-w-2xl mx-auto px-6 pt-10">
        {/* Hero 区 */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary-50 text-primary-600 text-xs font-medium mb-4">
            <Sparkles size={14} /> 解锁团队协作功能
          </div>
          <h2 className="text-2xl font-bold text-accent-800 mb-3">
            建立你的团队，开始高效协作
          </h2>
          <p className="text-accent-500 text-sm leading-relaxed">
            群立团队后，你就是老板（boss），可以创建团队任务、管理成员角色、查看项目账款。
            只需一个团队名，30 秒搞定。
          </p>
        </div>

        {/* 功能亮点 */}
        <div className="grid grid-cols-3 gap-3 mb-8">
          {[
            { icon: Users, label: '团队任务', desc: '派活、跟踪、逾期提醒' },
            { icon: Building2, label: '团队设置', desc: '部门、角色、人员转移' },
            { icon: Folder, label: '项目账款', desc: '订单、回款、发票管理' },
          ].map(({ icon: Icon, label, desc }) => (
            <div key={label} className="rounded-xl border border-accent-200 bg-white p-4 text-center">
              <Icon size={22} className="mx-auto mb-2 text-primary-500" />
              <div className="font-semibold text-sm text-accent-800">{label}</div>
              <div className="text-[11px] text-accent-400 mt-1 leading-relaxed">{desc}</div>
            </div>
          ))}
        </div>

        {/* 创建卡片 */}
        <div className="rounded-2xl border border-accent-200 bg-white p-6">
          <div className="flex items-center gap-2 mb-5">
            <div className="w-8 h-8 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
              <Building2 size={16} />
            </div>
            <div>
              <div className="font-semibold text-accent-800">创建我的团队</div>
              <div className="text-xs text-accent-400">创建后你自动成为老板 + 团队 leader</div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-accent-600 mb-1.5">团队名 *</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="比如：XX公司 / XX工作室 / XX项目组"
                maxLength={50}
                disabled={loading}
                className="w-full px-3.5 py-2.5 rounded-lg border border-accent-200 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-accent-600 mb-1.5">团队描述（可选）</label>
              <textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="一句话介绍你的团队是干啥的"
                maxLength={200}
                rows={2}
                disabled={loading}
                className="w-full px-3.5 py-2.5 rounded-lg border border-accent-200 text-sm outline-none focus:border-primary-400 focus:ring-2 focus:ring-primary-100 transition resize-none"
              />
            </div>
          </div>

          <div className="flex items-center gap-3 mt-6">
            <button
              onClick={handleCreate}
              disabled={loading || !name.trim()}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 text-white text-sm font-medium hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
            >
              {loading ? '创建中...' : '群立团队'}
              <ArrowRight size={16} />
            </button>
            <button
              onClick={handleJoinLater}
              disabled={loading}
              className="text-sm text-accent-500 hover:text-accent-700 transition"
            >
              暂不创建
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
