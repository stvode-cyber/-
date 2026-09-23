import { Link, useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { ReactNode } from 'react'

/**
 * 通用页头组件
 *
 * Props：
 * - title：标题（居中显示，超长截断）
 * - back：是否显示返回按钮（默认 true，调用 navigate(-1)）
 * - right：右侧自定义内容（ReactNode，如图标按钮 / 链接）
 *
 * 用法：
 *   <Header title="任务日程" right={<Plus onClick={...} />} />
 *   <Header title="充值" back={false} />
 *
 * HeaderLink：链接式 right 按钮，封装 <Link> + 主色样式
 */
interface HeaderProps {
  title: string
  back?: boolean
  right?: ReactNode
}

export default function Header({ title, back = true, right }: HeaderProps) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-30 bg-panel-300/95 backdrop-blur-md border-b border-accent-200">
      <div className="h-12 flex items-center px-3 gap-2">
        {back && (
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 -ml-1 rounded-full hover:bg-panel-400 transition-colors active:scale-90"
            aria-label="返回"
          >
            <ChevronLeft size={22} className="text-accent-600" />
          </button>
        )}
        <h1 className="flex-1 text-base font-semibold text-accent-800 truncate">{title}</h1>
        {right}
      </div>
    </header>
  )
}

/** 链接式 right 按钮：封装 <Link> + 主色样式，用于 Header 的 right 槽 */
export function HeaderLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm text-primary-400 hover:text-primary-300 font-medium px-2 py-1 rounded-full hover:bg-panel-400 transition-colors">
      {children}
    </Link>
  )
}
