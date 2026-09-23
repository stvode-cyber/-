import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
}

/**
 * 全局错误边界
 *
 * - 捕获子组件树渲染期间的同步错误，避免整页白屏
 * - 不捕获事件回调、异步代码、SSR 错误（这些场景应在业务层用 try/catch + toast 兜底）
 * - 出错时展示降级 UI，提供"重试"按钮（reload 当前页）
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 仅控制台打印，MVP 阶段不上报到监控平台
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: undefined })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
          <div className="text-5xl mb-3">😵</div>
          <div className="text-base font-medium text-gray-800 mb-1">页面出错了</div>
          <div className="text-sm text-gray-500 mb-5 max-w-xs">
            {this.state.error?.message || '发生未知错误，请稍后重试'}
          </div>
          <button
            onClick={this.handleReload}
            className="px-5 py-2 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600"
          >
            重新加载
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
