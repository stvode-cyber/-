import { NavLink, useLocation } from 'react-router-dom'
import { Home, MessageCircle, Users, User } from 'lucide-react'
import { useAuthStore } from '../stores/auth'

/**
 * 底部导航栏（主 Tab）· QQ 风格
 *
 * 4 个 Tab：主页 / 对话 / 社区 / 我的
 * - 主页使用精确匹配（pathname === '/'），其余前缀匹配
 * - 白色实底（不透明，QQ 经典样式），顶部细分隔线
 * - 激活态（QQ 式）：图标+文字变黑加粗，Tab 顶部亮起一条黑色光条
 * - 未激活：浅灰图标+浅灰文字
 * - "我的" Tab 若设置了图片头像，则显示头像缩略图替代默认图标
 *
 * 仅在主 Tab 路由（Layout）下渲染，独立全屏页不显示
 */
export default function TabBar() {
  const location = useLocation()
  const { user } = useAuthStore()

  // 判断头像是否为图片
  const isImageAvatar = user?.avatar && (
    user.avatar.startsWith('data:image') || user.avatar.startsWith('http') || user.avatar.startsWith('/')
  )

  const tabs = [
    { to: '/', label: '主页', icon: Home },
    { to: '/chat', label: '对话', icon: MessageCircle },
    { to: '/community', label: '社区', icon: Users },
    { to: '/profile', label: '我的', icon: User, avatar: isImageAvatar ? user!.avatar : null },
  ]

  return (
    <nav className="fixed bottom-0 left-0 right-0 max-w-[480px] mx-auto bg-white border-t border-slate-200/80 z-40">
      <div className="grid grid-cols-4 h-16">
        {tabs.map(({ to, label, icon: Icon, avatar }) => {
          const active = to === '/' ? location.pathname === '/' : location.pathname.startsWith(to)
          return (
            <NavLink
              key={to}
              to={to}
              className="relative flex flex-col items-center justify-center gap-0.5 transition-all active:scale-90"
            >
              {/* QQ 式激活光条：Tab 顶部黑条，切角过渡 */}
              <span
                className={`absolute top-0 left-1/2 -translate-x-1/2 h-[3px] rounded-b-full bg-slate-900 transition-all duration-300 ${
                  active ? 'w-8 opacity-100' : 'w-0 opacity-0'
                }`}
              />
              {avatar ? (
                <img
                  src={avatar}
                  alt={label}
                  className={`w-7 h-7 rounded-full object-cover transition-all ${active ? 'ring-2 ring-slate-900 shadow-md shadow-slate-900/20 scale-110' : 'ring-1 ring-slate-200'}`}
                />
              ) : (
                <Icon
                  size={22}
                  className={`transition-all ${active ? 'text-slate-900 scale-110' : 'text-slate-400'}`}
                  strokeWidth={active ? 2.4 : 2}
                />
              )}
              <span
                className={`text-[10px] transition-colors ${active ? 'text-slate-900 font-semibold' : 'text-slate-400'}`}
              >
                {label}
              </span>
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
