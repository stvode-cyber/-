import { Outlet } from 'react-router-dom'
import TabBar from './TabBar'
import { Toaster } from './Toast'
import { ConfirmDialog } from './ConfirmDialog'

/**
 * 主 Tab 布局
 *
 * 用于包裹 4 个主 Tab 路由（主页 / 对话 / 社区 / 我的）：
 * - 顶部：页面内容（Outlet，可滚动）
 * - 底部：TabBar 导航栏（fixed，h-14）
 * - 全局：Toaster 通知容器、ConfirmDialog 确认弹窗容器
 *
 * pb-16 为底部 TabBar 预留空间，避免内容被遮挡
 */
export default function Layout() {
  return (
    <div className="app-shell flex flex-col">
      <main className="flex-1 pb-16 overflow-y-auto">
        <Outlet />
      </main>
      <TabBar />
      <Toaster />
      <ConfirmDialog />
    </div>
  )
}
