import { Outlet } from 'react-router-dom'
import TabBar from './TabBar'

/**
 * 主 Tab 布局
 *
 * 用于包裹 4 个主 Tab 路由（主页 / 对话 / 社区 / 我的）：
 * - 顶部：页面内容（Outlet，可滚动）
 * - 底部：TabBar 导航栏（fixed，h-[72px]）
 *
 * 注意：Toaster / ConfirmDialog / UpdateNotice 已上移到 AppShell，避免重复挂载
 * pb-[88px] 为底部 TabBar 预留空间，避免内容被遮挡
 */
export default function Layout() {
  return (
    <div className="app-shell flex flex-col">
      <main className="flex-1 pb-[88px] overflow-y-auto">
        <Outlet />
      </main>
      <TabBar />
    </div>
  )
}
