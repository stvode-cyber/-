import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, LogOut, ScrollText, ClipboardList, MessageSquare, Loader2, Sparkles, BarChart3, Group, Wallet, Menu, X } from 'lucide-react'
import { useAuthStore } from '../../stores/auth'
import { ConfirmDialog } from '../../components/ConfirmDialog'

const NAV_ITEMS = [
  { to: '/admin',          end: true,  label: '首页概览', icon: LayoutDashboard },
  { to: '/admin/users',                label: '用户管理', icon: Users },
  { to: '/admin/audit-logs',           label: '台账日志', icon: ScrollText },
  { to: '/admin/handovers',            label: '交接单',   icon: ClipboardList },
  { to: '/admin/community',            label: '社区内容', icon: MessageSquare },
  { to: '/admin/agent-config',         label: '语料配置', icon: Sparkles },
  { to: '/admin/ab-stats',             label: 'A/B 统计', icon: BarChart3 },
  { to: '/admin/team',                 label: '团队管理', icon: Group },
  { to: '/admin/pm',                   label: '项目账款', icon: Wallet },
]

const activeStyle = { background: 'linear-gradient(90deg, rgba(5,150,105,0.3) 0%, rgba(13,148,136,0.2) 100%)', borderLeft: '3px solid #059669' }

function SidebarContent({ user, onNav, onLogout }: { user: any; onNav?: () => void; onLogout: () => void }) {
  return (
    <>
      <div className="p-5 border-b border-white/10">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-white" style={{ background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)' }}>小</div>
          <div>
            <div className="font-semibold text-sm">绿角犀</div>
            <div className="text-xs text-white/60">管理后台</div>
          </div>
        </div>
      </div>
      <nav className="flex-1 py-4 overflow-y-auto">
        {NAV_ITEMS.map(({ to, end, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            onClick={onNav}
            className={({ isActive }) =>
              `flex items-center gap-3 px-5 py-3 text-sm transition-all ${
                isActive ? 'text-white font-medium' : 'text-white/70 hover:text-white hover:bg-white/5'
              }`
            }
            style={({ isActive }) => isActive ? activeStyle : undefined}
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="p-4 border-t border-white/10">
        <div className="text-xs text-white/50 mb-1">当前管理员</div>
        <div className="text-sm mb-3 truncate">{user?.username}</div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-xs text-white/60 hover:text-white transition-colors"
        >
          <LogOut size={14} /> 退出
        </button>
      </div>
    </>
  )
}

export default function AdminLayout() {
  const { user, token, loading, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 路由变化自动关闭抽屉
  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  if (loading) {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen">
        <Loader2 size={24} className="animate-spin text-gray-400" />
      </div>
    )
  }
  if (!token || !user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen">
        <div className="text-center">
          <div className="text-2xl mb-2">🚫</div>
          <div className="text-gray-600">权限不足</div>
          <button onClick={() => { logout(); navigate('/login') }} className="mt-4 btn-primary">返回登录</button>
        </div>
      </div>
    )
  }

  const sidebarBg = { background: 'linear-gradient(180deg, #065F46 0%, #0F172A 100%)' }

  return (
    <div className="admin-shell flex min-h-screen">
      {/* 桌面侧边栏 (md+) */}
      <aside className="hidden md:flex w-56 text-white flex-col relative overflow-hidden shrink-0" style={sidebarBg}>
        <SidebarContent user={user} onLogout={() => { logout(); navigate('/login') }} />
      </aside>

      {/* 移动端顶部 header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 text-white" style={{ background: 'linear-gradient(90deg, #065F46 0%, #0F172A 100%)' }}>
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm" style={{ background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)' }}>小</div>
          <div>
            <div className="font-semibold text-sm leading-tight">绿角犀</div>
            <div className="text-[10px] text-white/60 leading-tight">管理后台</div>
          </div>
        </div>
        <button onClick={() => setDrawerOpen(true)} className="p-1.5 rounded-lg hover:bg-white/10 active:bg-white/20 transition">
          <Menu size={22} />
        </button>
      </div>

      {/* 移动端抽屉遮罩 */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 text-white flex flex-col shadow-2xl" style={sidebarBg}>
            <div className="flex justify-end p-3 border-b border-white/10">
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-white/10 transition">
                <X size={18} />
              </button>
            </div>
            <SidebarContent user={user} onNav={() => setDrawerOpen(false)} onLogout={() => { setDrawerOpen(false); logout(); navigate('/login') }} />
          </aside>
        </div>
      )}

      {/* 主内容 */}
      <main className="flex-1 md:overflow-auto" style={{ background: 'linear-gradient(180deg, #EFF6FF 0%, #ECFEFF 100%)' }}>
        <div className="md:hidden h-14" />
        <Outlet />
      </main>
      <ConfirmDialog />
    </div>
  )
}
