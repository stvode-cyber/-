import { Outlet, NavLink, useNavigate, Navigate } from 'react-router-dom'
import { LayoutDashboard, Users, LogOut, ScrollText, ClipboardList, MessageSquare, Loader2, Sparkles, BarChart3 } from 'lucide-react'
import { useAuthStore } from '../../stores/auth'
import { ConfirmDialog } from '../../components/ConfirmDialog'

export default function AdminLayout() {
  const { user, token, loading, logout } = useAuthStore()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  // 初始化中：避免初始化期间闪现权限拦截页
  if (loading) {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }

  // 未登录：跳转登录页，避免未登录用户看到后台界面结构
  if (!token || !user) {
    return <Navigate to="/login" replace />
  }

  // 已登录但非管理员：显示权限不足页
  if (user.role !== 'admin') {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-2xl mb-2">🚫</div>
          <div className="text-gray-600">权限不足</div>
          <button onClick={handleLogout} className="mt-4 btn-primary">返回登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell flex min-h-screen">
      {/* 侧边栏 */}
      <aside className="w-56 text-white flex flex-col relative overflow-hidden" style={{ background: 'linear-gradient(180deg, #065F46 0%, #0F172A 100%)' }}>
        <div className="p-5 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white" style={{ background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)' }}>小</div>
            <div>
              <div className="font-semibold text-sm">绿角犀</div>
              <div className="text-xs text-white/60">管理后台</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-4">
          <NavLink
            to="/admin"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <LayoutDashboard size={18} />
            首页概览
          </NavLink>
          <NavLink
            to="/admin/users"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <Users size={18} />
            用户管理
          </NavLink>
          <NavLink
            to="/admin/audit-logs"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <ScrollText size={18} />
            台账日志
          </NavLink>
          <NavLink
            to="/admin/handovers"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <ClipboardList size={18} />
            交接单
          </NavLink>
          <NavLink
            to="/admin/community"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <MessageSquare size={18} />
            社区内容
          </NavLink>
          <NavLink
            to="/admin/agent-config"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <Sparkles size={18} />
            语料配置
          </NavLink>
          <NavLink
            to="/admin/ab-stats"
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' } : undefined}
          >
            <BarChart3 size={18} />
            A/B 统计
          </NavLink>
        </nav>
        <div className="p-4 border-t border-white/10">
          <div className="text-xs text-white/50 mb-1">当前管理员</div>
          <div className="text-sm mb-3">{user?.username}</div>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors"
          >
            <LogOut size={14} /> 退出
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto" style={{ background: 'linear-gradient(180deg, #EFF6FF 0%, #ECFEFF 100%)' }}>
        <Outlet />
      </main>
      <ConfirmDialog />
    </div>
  )
}
