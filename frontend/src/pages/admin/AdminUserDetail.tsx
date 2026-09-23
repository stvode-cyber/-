import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Shield, Key, Edit3 } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { useConfirm } from '../../components/ConfirmDialog'
import { formatDateTime, formatMoney } from '../../lib/utils'
import { auditCategoryMeta } from '../../lib/constants'

interface UserDetail {
  id: string
  username: string
  nickname?: string
  role: string
  email?: string
  phone?: string
  onboarded: boolean
  preferredTone?: string
  primaryGoal?: string
  lastLoginAt?: string
  createdAt: string
  stats: { taskCount: number; billCount: number; walletBalance: number }
}

/** 审计日志（仅展示用字段） */
interface AuditLog {
  id: string
  category: string
  action: string
  summary: string
  result: string
  createdAt: string
}

/**
 * 管理后台 · 用户详情页
 *
 * 三大区域：
 * 1. 基本信息（头像 / 用户名 / 角色 / 邮箱 / 引导 / 语气 / 目标 / 登录时间）
 * 2. 数据统计（任务数 / 账单数 / 钱包余额）
 * 3. 管理操作（修改角色 / 修改昵称 / 重置密码） + 该用户的操作记录（审计日志）
 */
export default function AdminUserDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [user, setUser] = useState<UserDetail | null>(null)
  const [logs, setLogs] = useState<AuditLog[]>([])
  // 用户详情加载与错误状态
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // 操作日志加载状态（错误保持静默失败，沿用原行为）
  const [logsLoading, setLogsLoading] = useState(true)
  // 管理操作表单
  const [editRole, setEditRole] = useState('')
  const [editNickname, setEditNickname] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [saving, setSaving] = useState<'role' | 'nickname' | 'password' | null>(null)

  useEffect(() => {
    if (id) {
      load(id)
      loadLogs(id)
    }
  }, [id])

  const load = async (uid: string) => {
    setLoading(true)
    setError(false)
    try {
      const res = await unwrap<UserDetail>(api.get(`/admin/users/${uid}`))
      setUser(res)
      setEditRole(res.role)
      setEditNickname(res.nickname || '')
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const loadLogs = async (uid: string) => {
    setLogsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('userId', uid)
      params.set('pageSize', '10')
      const res = await unwrap<{ list: AuditLog[] }>(api.get(`/admin/audit-logs?${params}`))
      setLogs(res.list)
    } catch (err) {
      // 静默失败
    } finally {
      setLogsLoading(false)
    }
  }

  /** 修改角色 */
  const onSaveRole = async () => {
    if (!id || !user) return
    if (editRole === user.role) {
      toast('角色未变更', 'info')
      return
    }
    setSaving('role')
    try {
      const res = await unwrap<UserDetail>(api.patch(`/admin/users/${id}`, { role: editRole }))
      setUser({ ...user, role: res.role })
      toast(`已切换为${editRole === 'admin' ? '管理员' : '普通用户'}`, 'success')
      loadLogs(id)
    } catch (err) {
      toast((err as Error).message, 'error')
      setEditRole(user.role)
    } finally {
      setSaving(null)
    }
  }

  /** 修改昵称 */
  const onSaveNickname = async () => {
    if (!id || !user) return
    if (editNickname.trim() === (user.nickname || '')) {
      toast('昵称未变更', 'info')
      return
    }
    if (!editNickname.trim()) {
      toast('昵称不能为空', 'error')
      return
    }
    setSaving('nickname')
    try {
      const res = await unwrap<UserDetail>(api.patch(`/admin/users/${id}`, { nickname: editNickname.trim() }))
      setUser({ ...user, nickname: res.nickname })
      toast('昵称已更新', 'success')
      loadLogs(id)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(null)
    }
  }

  /** 重置密码 */
  const onResetPassword = async () => {
    if (!id || !user) return
    if (newPassword.length < 6) {
      toast('密码至少 6 位', 'error')
      return
    }
    if (!(await confirm({
      title: '重置密码',
      message: `确认重置用户「${user.username}」的密码？`,
      confirmText: '重置',
      danger: true,
    }))) return
    setSaving('password')
    try {
      await unwrap(api.patch(`/admin/users/${id}`, { newPassword }))
      setNewPassword('')
      toast('密码已重置', 'success')
      loadLogs(id)
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setSaving(null)
    }
  }

  // 用户详情未就绪：加载中显示骨架屏，失败显示重试
  if (!user) {
    return (
      <div className="p-6">
        {error ? (
          <ErrorState onRetry={() => id && load(id)} />
        ) : (
          <LoadingState skeleton count={3} />
        )}
      </div>
    )
  }

  return (
    <div className="p-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-4"
      >
        <ArrowLeft size={16} /> 返回
      </button>

      <div className="grid grid-cols-3 gap-4">
        {/* 基本信息 */}
        <div className="bg-white rounded-xl shadow-sm p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center text-2xl">
              👤
            </div>
            <div>
              <div className="text-lg font-semibold text-gray-800">{user.nickname || user.username}</div>
              <div className="text-sm text-gray-400">@{user.username}</div>
              <span className={`badge mt-1 ${user.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                {user.role === 'admin' ? '管理员' : '普通用户'}
              </span>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">邮箱</span>
              <span className="text-gray-800">{user.email || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">手机</span>
              <span className="text-gray-800">{user.phone || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">引导完成</span>
              <span>{user.onboarded ? '✓' : '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">语气偏好</span>
              <span>{user.preferredTone || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">本周目标</span>
              <span className="text-gray-800">{user.primaryGoal || '—'}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-gray-50">
              <span className="text-gray-500">最后登录</span>
              <span className="text-gray-800">{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : '—'}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-500">注册时间</span>
              <span className="text-gray-800">{formatDateTime(user.createdAt)}</span>
            </div>
          </div>
        </div>

        {/* 右栏：统计 + 管理操作 + 操作记录 */}
        <div className="col-span-2 space-y-4">
          {/* 数据统计 */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">任务总数</div>
              <div className="text-2xl font-bold text-gray-800">{user.stats.taskCount}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">账单总数</div>
              <div className="text-2xl font-bold text-gray-800">{user.stats.billCount}</div>
            </div>
            <div className="bg-white rounded-xl shadow-sm p-5">
              <div className="text-sm text-gray-500 mb-1">钱包余额</div>
              <div className="text-2xl font-bold text-primary-600">{formatMoney(user.stats.walletBalance)}</div>
            </div>
          </div>

          {/* 管理操作 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h3 className="font-medium text-gray-800 mb-4 flex items-center gap-2">
              <Shield size={16} className="text-primary-500" />
              管理操作
            </h3>

            <div className="space-y-4">
              {/* 修改角色 */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500 w-20">角色</label>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm"
                >
                  <option value="user">普通用户</option>
                  <option value="admin">管理员</option>
                </select>
                <button
                  onClick={onSaveRole}
                  disabled={saving === 'role' || editRole === user.role}
                  className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40"
                >
                  {saving === 'role' ? '保存中...' : '保存'}
                </button>
              </div>

              {/* 修改昵称 */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500 w-20">昵称</label>
                <input
                  type="text"
                  value={editNickname}
                  onChange={(e) => setEditNickname(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs"
                />
                <button
                  onClick={onSaveNickname}
                  disabled={saving === 'nickname'}
                  className="btn-primary text-xs px-3 py-1.5 disabled:opacity-40 flex items-center gap-1"
                >
                  <Edit3 size={12} />
                  {saving === 'nickname' ? '保存中...' : '保存'}
                </button>
              </div>

              {/* 重置密码 */}
              <div className="flex items-center gap-3">
                <label className="text-sm text-gray-500 w-20">重置密码</label>
                <input
                  type="password"
                  placeholder="输入新密码（至少6位）"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm flex-1 max-w-xs"
                />
                <button
                  onClick={onResetPassword}
                  disabled={saving === 'password' || !newPassword}
                  className="text-xs px-3 py-1.5 bg-red-50 text-red-600 rounded-lg disabled:opacity-40 hover:bg-red-100 flex items-center gap-1"
                >
                  <Key size={12} />
                  {saving === 'password' ? '重置中...' : '重置'}
                </button>
              </div>
            </div>
          </div>

          {/* 操作记录 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-medium text-gray-800">操作记录</h3>
              <span className="text-xs text-gray-400">最近 10 条</span>
            </div>
            {/* 操作记录四态：加载中 / 空数据 / 列表（错误保持静默） */}
            {logsLoading ? <LoadingState skeleton count={3} /> :
             logs.length === 0 ? <EmptyState icon="📋" text="暂无操作记录" /> :
             (
               <div className="space-y-2">
                 {logs.map((log) => (
                   <div key={log.id} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                     <span className="text-xs text-gray-400 w-32 whitespace-nowrap">
                       {formatDateTime(log.createdAt)}
                     </span>
                     <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 w-12 text-center">
                       {auditCategoryMeta[log.category]?.label || log.category}
                     </span>
                     <span className="text-sm text-gray-700 flex-1 truncate">{log.summary}</span>
                     <span className={`text-xs ${log.result === 'success' ? 'text-green-500' : 'text-red-500'}`}>
                       {log.result === 'success' ? '✓' : '✗'}
                     </span>
                   </div>
                 ))}
               </div>
             )}
          </div>
        </div>
      </div>
    </div>
  )
}
