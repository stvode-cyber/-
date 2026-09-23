import { Outlet, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useState, useEffect, useRef } from 'react'
import {
  Home, MessageCircle, Users, User,
  Moon, Search, Settings,
  LogOut, Bell, ChevronLeft,
  Command, Sun,
  ShieldCheck, ChevronDown, Camera,
} from 'lucide-react'
// LogOut 仅用于顶栏用户菜单中的退出登录入口
import { useAuthStore } from '../stores/auth'
import { useThemeStore } from '../stores/theme'
import { Toaster } from './Toast'
import { ConfirmDialog } from './ConfirmDialog'
import CommandPalette from './CommandPalette'
import ShortcutHelpPanel from './ShortcutHelpPanel'
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts'
import { pickAndUploadAvatar } from '../lib/avatarChange'

/**
 * 桌面端专用布局（深色专业风）
 *
 * 结构：左侧深色侧边栏（固定 220px）+ 顶栏 + 宽内容区
 * - 侧边栏：分组导航，激活态 primary 竖条 + 浅色高亮
 * - 顶栏：当前页标题 + 用户区（通知 / 头像 / 登出）
 * - 内容区：浅灰背景，内容 max-width 1200 居中，自适应宽度（无 480px 限制）
 *
 * 替代移动端 Layout（底部 TabBar）+ app-shell（480px 手机容器），
 * 桌面端所有已登录页面共用此布局，侧边栏常驻。
 */
interface NavItem {
  to: string
  label: string
  icon: typeof Home
}
interface NavGroup {
  title: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    title: '主要',
    items: [
      { to: '/', label: '首页', icon: Home },
      { to: '/chat', label: '对话', icon: MessageCircle },
      { to: '/community', label: '好友/社区', icon: Users },
      { to: '/profile', label: '我的', icon: User },
    ],
  },
]

/** 根据 pathname 推导顶栏标题（最长前缀匹配优先） */
function usePageTitle(): string {
  const { pathname } = useLocation()
  // 收集所有匹配项，选最长的（解决 /finance 与 /finance/analytics 嵌套）
  let best: { label: string; len: number } | null = null
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const match = it.to === '/' ? pathname === '/' : pathname === it.to || pathname.startsWith(it.to + '/')
      if (match && (!best || it.to.length > best.len)) {
        best = { label: it.label, len: it.to.length }
      }
    }
  }
  if (best) return best.label
  if (pathname.startsWith('/wallet/')) return '钱包'
  if (pathname.startsWith('/chat/')) return '对话'
  if (pathname.startsWith('/countdowns/')) return '倒计时'
  if (pathname.startsWith('/settings/')) return '设置'
  return '绿角犀'
}

export default function DesktopLayout() {
  const { user, logout } = useAuthStore()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const pageTitle = usePageTitle()
  const { effectiveMode, toggle: toggleTheme } = useThemeStore()

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return
    const onClickAway = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onClickAway)
    return () => document.removeEventListener('mousedown', onClickAway)
  }, [userMenuOpen])

  // 路由切换时关闭菜单
  useEffect(() => {
    setUserMenuOpen(false)
  }, [location.pathname])

  // 全局键盘快捷键
  const { showHelp, setShowHelp } = useKeyboardShortcuts({
    onSearch: () => setPaletteOpen(true),
    onNavigate: (path) => navigate(path),
  })

  // 激活态：最长前缀匹配，避免 /finance 与 /finance/analytics 同时高亮
  const isActive = (to: string): boolean => {
    const p = location.pathname
    if (to === '/') return p === '/' || p === ''
    if (!(p === to || p.startsWith(to + '/'))) return false
    // 若存在更长的同前缀路由也匹配当前路径，则较短的让位
    for (const g of NAV_GROUPS) {
      for (const it of g.items) {
        if (it.to !== to && it.to.startsWith(to + '/') && (p === it.to || p.startsWith(it.to + '/'))) {
          return false
        }
      }
    }
    return true
  }

  const isImageAvatar = user?.avatar && (
    user.avatar.startsWith('data:image') || user.avatar.startsWith('http') || user.avatar.startsWith('/')
  )

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="desktop-shell flex h-screen overflow-hidden">
      {/* 侧边栏：纯深色模式（参考 VS Code/Notion 深色风） */}
      <aside
        className={`${
          collapsed ? 'w-16' : 'w-56'
        } shrink-0 flex flex-col bg-[#0A0A0F] text-slate-300 transition-all duration-200 ring-1 ring-white/[0.03]`}
      >
        {/* Logo 区：直接用当前用户头像，避免出现「绿角犀 logo + 用户头像」两个头像 */}
        <button
          onClick={() => navigate('/profile')}
          className="h-16 flex items-center gap-2.5 px-4 border-b border-white/[0.06] shrink-0 hover:bg-white/[0.04] transition-colors w-full"
          title="进入我的页面"
        >
          {isImageAvatar ? (
            <img src={user!.avatar} alt="" className="w-9 h-9 rounded-2xl object-cover shrink-0 ring-1 ring-white/10" />
          ) : (
            <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-primary-400 to-teal-500 flex items-center justify-center text-white font-bold text-lg shrink-0 shadow-lg shadow-primary-500/20">
              {user?.nickname?.[0] || user?.username?.[0] || 'U'}
            </div>
          )}
          {!collapsed && (
            <div className="flex-1 min-w-0 text-left">
              <div className="text-white font-semibold text-[15px] tracking-wide truncate">{user?.nickname || user?.username || '绿角犀'}</div>
              <div className="text-[10px] text-slate-500 truncate">{user?.role === 'admin' ? '管理员' : '角角'}</div>
            </div>
          )}
        </button>

        {/* 导航（可滚动） */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 sidebar-scroll">
          {NAV_GROUPS.map((group) => (
            <div key={group.title} className="mb-4">
              {!collapsed && (
                <div className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                  {group.title}
                </div>
              )}
              <div className="space-y-1">
                {group.items.map(({ to, label, icon: Icon }) => {
                  const active = isActive(to)
                  return (
                    <NavLink
                      key={to}
                      to={to}
                      title={collapsed ? label : undefined}
                      className={`relative flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] transition-all group ${
                        collapsed ? 'justify-center' : ''
                      } ${
                        active
                          ? 'bg-white/[0.10] text-white font-medium'
                          : 'text-slate-400 hover:text-slate-100 hover:bg-white/[0.06]'
                      }`}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-primary-400" />
                      )}
                      <Icon size={18} className="shrink-0" strokeWidth={active ? 2.3 : 2} />
                      {!collapsed && <span className="truncate">{label}</span>}
                    </NavLink>
                  )
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* 折叠按钮 */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="shrink-0 h-9 flex items-center justify-center text-slate-500 hover:text-slate-200 hover:bg-white/[0.06] transition-colors border-t border-white/[0.06]"
          title={collapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <ChevronLeft size={16} className={`transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
      </aside>

      {/* 右侧：顶栏 + 内容区 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 顶栏 */}
        <header className="h-16 shrink-0 flex items-center justify-between px-6 bg-white border-b border-accent-200">
          <h1 className="text-lg font-semibold text-accent-800">{pageTitle}</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setPaletteOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-accent-400 hover:text-accent-600 hover:bg-accent-100 transition-colors text-[13px] border border-accent-200"
              title="全局搜索 (Ctrl+K)"
            >
              <Search size={16} />
              <span className="hidden sm:inline">搜索</span>
              <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent-50 border border-accent-200 text-[10px] text-accent-400 font-mono">
                ⌘K
              </kbd>
            </button>
            <button
              onClick={() => setShowHelp(true)}
              className="p-2 rounded-lg text-accent-500 hover:text-accent-700 hover:bg-accent-100 transition-colors"
              title="快捷键 (Ctrl+/)"
            >
              <Command size={18} />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg text-accent-500 hover:text-accent-700 hover:bg-accent-100 transition-colors"
              title={effectiveMode === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
            >
              {effectiveMode === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="relative p-2 rounded-lg text-accent-500 hover:text-accent-700 hover:bg-accent-100 transition-colors"
              title="通知"
            >
              <Bell size={18} />
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-urgent" />
            </button>
            {/* 顶栏头像：参考 QQ，点击弹下拉菜单 */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setUserMenuOpen((v) => !v)}
                className="flex items-center gap-1 rounded-full hover:bg-accent-100 transition-colors py-1 pr-1.5 pl-1"
                aria-label="用户菜单"
                aria-expanded={userMenuOpen}
              >
                <span className="relative">
                  {isImageAvatar ? (
                    <img src={user!.avatar} alt="" className="w-8 h-8 rounded-full object-cover ring-1 ring-accent-200" />
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-sm font-semibold ring-1 ring-accent-200">
                      {user?.nickname?.[0] || user?.username?.[0] || 'U'}
                    </span>
                  )}
                  {/* 在线状态点（参考 QQ） */}
                  <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-green-500 ring-2 ring-white" title="在线" />
                </span>
                <ChevronDown size={14} className={`text-accent-400 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {/* 下拉菜单 */}
              {userMenuOpen && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-accent-100 overflow-hidden z-50 animate-slide-up">
                  {/* 头部：头像+昵称+@username */}
                  <button
                    onClick={() => navigate('/settings/profile')}
                    className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-primary-50 transition-colors text-left border-b border-accent-50"
                  >
                    <span className="relative">
                      {isImageAvatar ? (
                        <img src={user!.avatar} alt="" className="w-12 h-12 rounded-full object-cover ring-2 ring-primary-100" />
                      ) : (
                        <span className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center text-primary-600 text-lg font-semibold ring-2 ring-primary-100">
                          {user?.nickname?.[0] || user?.username?.[0] || 'U'}
                        </span>
                      )}
                      <span className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 ring-2 ring-white" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-accent-800 truncate">
                        {user?.nickname || user?.username}
                      </div>
                      <div className="text-xs text-accent-400 truncate">
                        @{user?.username} · {user?.role === 'admin' ? '管理员' : '用户'}
                      </div>
                    </div>
                  </button>

                  {/* 菜单项 */}
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setUserMenuOpen(false)
                        pickAndUploadAvatar()
                      }}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <Camera size={16} className="text-accent-400" /> 更换头像
                    </button>
                    <button
                      onClick={() => navigate('/profile')}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <User size={16} className="text-accent-400" /> 我的页面
                    </button>
                    <button
                      onClick={() => navigate('/settings/profile')}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <Settings size={16} className="text-accent-400" /> 个人资料设置
                    </button>
                    <button
                      onClick={() => navigate('/settings/security')}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <ShieldCheck size={16} className="text-accent-400" /> 安全中心
                    </button>
                    <button
                      onClick={() => navigate('/settings')}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-accent-600 hover:bg-accent-50 transition-colors"
                    >
                      <Settings size={16} className="text-accent-400" /> 全部设置
                    </button>
                  </div>

                  {/* 退出登录 */}
                  <div className="border-t border-accent-50 py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
                    >
                      <LogOut size={16} /> 退出登录
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* 内容区：宽屏自适应，无 480px 限制 */}
        <main className="flex-1 overflow-y-auto bg-accent-50">
          <div className="desktop-content mx-auto w-full max-w-[1200px] px-6 py-6">
            <Outlet />
          </div>
        </main>
      </div>

      <Toaster />
      <ConfirmDialog />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <ShortcutHelpPanel open={showHelp} onClose={() => setShowHelp(false)} />
    </div>
  )
}
