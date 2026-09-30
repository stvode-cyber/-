import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, Navigate, useLocation } from 'react-router-dom'
import { LayoutDashboard, Users, LogOut, ScrollText, Sparkles, Group, Wallet, Menu, X, MessageSquare } from 'lucide-react'
import { useAuthStore } from '../../stores/auth'
import { ConfirmDialog } from '../../components/ConfirmDialog'

/**
 * 管理后台侧边栏 — 社交平台运营视角
 *
 * 分组逻辑（从运营日常工作流出发）：
 * 1. 工作台 — 活跃度总汇（每天打开先看什么）
 * 2. 社区运营 — 内容/互动/用户（社交平台核心）
 * 3. 业务协作 — 团队 + 项目账款（运营支撑）
 * 4. 系统管理 — 日志 + 设置
 */
const NAV_ITEMS = [
  { to: '/admin',          end: true,  label: '活跃总汇',     icon: LayoutDashboard, section: '工作台' },
  { to: '/admin/community',              label: '社区内容',     icon: MessageSquare,   section: '社区运营' },
  { to: '/admin/users',                  label: '用户管理',     icon: Users,           section: '社区运营' },
  { to: '/admin/team',                   label: '团队管理',     icon: Group,           section: '业务协作' },
  { to: '/admin/pm',                     label: '项目账款',     icon: Wallet,          section: '业务协作' },
  { to: '/admin/audit-logs',             label: '操作日志',     icon: ScrollText,      section: '系统管理' },
  { to: '/admin/agent-config',           label: '系统设置',     icon: Sparkles,        section: '系统管理' },
]

const activeStyle = { borderLeft: '3px solid #2563EB', background: 'rgba(37, 99, 235, 0.08)' }

function SidebarContent({ user, onNav, onLogout }: { user: any; onNav?: () => void; onLogout: () => void }) {
  // 按 section 分组
  const sections: Record<string, typeof NAV_ITEMS> = {}
  NAV_ITEMS.forEach(item => {
    const s = item.section ?? '其他'
    if (!sections[s]) sections[s] = []
    sections[s].push(item)
  })

  return (
    <>
      {/* Logo */}
      <div className="px-5 py-6 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center text-white font-bold text-sm shadow-sm"
               style={{ background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)' }}>L</div>
          <div>
            <div className="font-semibold text-sm text-gray-900 leading-tight">绿角犀</div>
            <div className="text-[11px] text-gray-400 leading-tight">运营后台</div>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 overflow-y-auto">
        {Object.entries(sections).map(([section, items]) => (
          <div key={section} className="mb-2">
            <div className="px-5 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              {section}
            </div>
            {items.map(({ to, end, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                onClick={onNav}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-5 py-2.5 text-[13px] transition-all ${
                    isActive
                      ? 'text-blue-600 font-medium'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`
                }
                style={({ isActive }) => isActive ? activeStyle : { borderLeft: '3px solid transparent' }}
              >
                <Icon size={17} strokeWidth={2} />
                {label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      {/* User */}
      <div className="px-5 py-4 border-t border-gray-100">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-sm font-medium text-gray-800 truncate max-w-[120px]">{user?.nickname || user?.username}</div>
            <div className="text-[11px] text-gray-400">管理员</div>
          </div>
          <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 text-xs font-semibold">
            {(user?.nickname || user?.username || 'A').slice(0, 1).toUpperCase()}
          </div>
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-gray-700 transition-colors w-full"
        >
          <LogOut size={13} /> 退出登录
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

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  if (loading) {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-gray-400 text-sm">加载中...</div>
      </div>
    )
  }
  if (!token || !user) return <Navigate to="/login" replace />
  if (user.role !== 'admin') {
    return (
      <div className="admin-shell flex items-center justify-center min-h-screen bg-gray-50">
        <div className="text-center">
          <div className="text-2xl mb-2">🚫</div>
          <div className="text-gray-600 text-sm">权限不足</div>
          <button onClick={() => { logout(); navigate('/login') }} className="mt-4 text-blue-600 text-sm hover:underline">返回登录</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-shell flex min-h-screen bg-gray-50">
      {/* 桌面侧边栏 */}
      <aside className="hidden md:flex w-56 bg-white border-r border-gray-100 flex-col shrink-0">
        <SidebarContent user={user} onLogout={() => { logout(); navigate('/login') }} />
      </aside>

      {/* 移动端顶部 header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4 py-3 bg-white border-b border-gray-100">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
               style={{ background: 'linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)' }}>L</div>
          <div className="font-semibold text-sm text-gray-900">绿角犀 · 运营后台</div>
        </div>
        <button onClick={() => setDrawerOpen(true)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
          <Menu size={20} className="text-gray-600" />
        </button>
      </div>

      {/* 移动端抽屉 */}
      {drawerOpen && (
        <div className="md:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDrawerOpen(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-white flex flex-col shadow-xl">
            <div className="flex justify-end p-3 border-b border-gray-100">
              <button onClick={() => setDrawerOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 transition">
                <X size={18} className="text-gray-600" />
              </button>
            </div>
            <SidebarContent user={user} onNav={() => setDrawerOpen(false)} onLogout={() => { setDrawerOpen(false); logout(); navigate('/login') }} />
          </aside>
        </div>
      )}

      {/* 主内容 */}
      <main className="flex-1 md:overflow-auto">
        <div className="md:hidden h-14" />
        <Outlet />
      </main>
      <ConfirmDialog />
    </div>
  )
}
