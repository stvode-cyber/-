import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, HashRouter } from 'react-router-dom'
import App from './App.tsx'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initMobileAdapter } from './lib/mobile-adapter'
import { initServerConfig } from './lib/api'
import { isElectron, isCapacitor } from './lib/platform'
import { useThemeStore } from './stores/theme'
import './index.css'

// 移动端适配：在渲染前注入 mock desktopAPI
initMobileAdapter()

// 主题初始化：在 React 渲染前同步应用 .dark class，避免首帧闪烁
useThemeStore.getState().init()

// Electron（file://）和 Capacitor（capacitor:// 或 https://localhost）使用 HashRouter
// Web 端使用 BrowserRouter
const useHashRouter = isElectron || isCapacitor
const Router = useHashRouter ? HashRouter : BrowserRouter

// 浮窗模式（桌宠/便签/壁纸）：在 React 渲染前就给 <html> 打上 float-mode 标记，
// 让 index.css 中 html.float-mode 规则把 html/body/#root 背景置为透明，
// 否则 Electron transparent 窗口会因 #F8FAFC 背景显示成灰色矩形（"不完全窗口"）。
// 必须在 createRoot 之前同步执行，避免首帧闪烁出灰色背景。
if (typeof window !== 'undefined') {
  const hash = window.location.hash || ''
  const search = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
  const params = new URLSearchParams(search)
  if (params.get('float') === '1') {
    document.documentElement.classList.add('float-mode')
  }
}

/**
 * 应用入口
 *
 * - ErrorBoundary：全局错误边界，避免渲染异常导致整页白屏
 * - Router：桌面端 HashRouter / Web 端 BrowserRouter
 * - StrictMode：开发环境严格模式（重复渲染检测副作用）
 *
 * 先应用用户自设的服务器地址（异步读本地偏好），再渲染，确保首个请求就命中正确后端。
 */
async function bootstrap() {
  await initServerConfig()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <ErrorBoundary>
        <Router>
          <App />
        </Router>
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

bootstrap()
