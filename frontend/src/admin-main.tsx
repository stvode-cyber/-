import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { useAuthStore } from './stores/auth'
import { Toaster } from './components/Toast'
import LoginPage from './pages/LoginPage'
import AdminLayout from './pages/admin/AdminLayout'
import AdminDashboard from './pages/admin/AdminDashboard'
import AdminUsers from './pages/admin/AdminUsers'
import AdminUserDetail from './pages/admin/AdminUserDetail'
import AdminAuditLogs from './pages/admin/AdminAuditLogs'
import AdminHandovers from './pages/admin/AdminHandovers'
import AdminCommunity from './pages/admin/AdminCommunity'
import AdminAgentConfig from './pages/admin/AdminAgentConfigPage'
import AdminAbStats from './pages/admin/AdminAbStatsPage'
import './index.css'

/**
 * 独立管理后台入口（云端独立网页）
 *
 * - 由后端静态托管（/admin），浏览器访问；与桌面 APP / web 主 APP 完全分离。
 * - Web 模式走 BrowserRouter + 相对路径 /api/v1 + HttpOnly Cookie 认证。
 * - 刻意不调用 initServerConfig()：避免 localStorage 里残留的用户自设服务器 URL
 *   覆盖相对路径 baseURL，导致管理页连到错误主机。
 * - 渲染前同步 init 认证态（web 分支会用 cookie 调 /auth/me 校验）。
 */
useAuthStore.getState().init()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<AdminDashboard />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="users/:id" element={<AdminUserDetail />} />
            <Route path="audit-logs" element={<AdminAuditLogs />} />
            <Route path="handovers" element={<AdminHandovers />} />
            <Route path="community" element={<AdminCommunity />} />
            <Route path="agent-config" element={<AdminAgentConfig />} />
            <Route path="ab-stats" element={<AdminAbStats />} />
          </Route>
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<Navigate to="/admin" replace />} />
        </Routes>
        <Toaster />
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>,
)