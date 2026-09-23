import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, ChevronRight } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../../components/StateView'
import { formatDateTime } from '../../lib/utils'

interface UserItem {
  id: string
  username: string
  nickname?: string
  role: string
  onboarded: boolean
  lastLoginAt?: string
  createdAt: string
}

interface UserListRes {
  list: UserItem[]
  total: number
  page: number
  pageSize: number
}

export default function AdminUsers() {
  const toast = useToast((s) => s.show)
  const [data, setData] = useState<UserListRes | null>(null)
  const [keyword, setKeyword] = useState('')
  const [page, setPage] = useState(1)
  // 加载与错误状态
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    load()
  }, [page, keyword])

  const load = async () => {
    setLoading(true)
    setError(false)
    try {
      const query = keyword ? `?keyword=${encodeURIComponent(keyword)}&page=${page}` : `?page=${page}`
      const res = await unwrap<UserListRes>(api.get(`/admin/users${query}`))
      setData(res)
    } catch (err) {
      setError(true)
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setPage(1)
    load()
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-800">用户管理</h1>
        <form onSubmit={onSearch} className="relative flex items-center">
          <input
            className="pl-9 pr-10 py-2 rounded-lg border border-gray-200 text-sm w-64 focus:outline-none focus:border-primary-500"
            placeholder="搜索用户名/昵称"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <button
            type="submit"
            className="absolute right-1 top-1/2 -translate-y-1/2 px-2 py-1 text-xs text-primary-600 hover:bg-primary-50 rounded"
          >
            搜索
          </button>
        </form>
      </div>

      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        {/* 四态渲染：加载中 / 加载失败 / 空数据 / 列表 */}
        {loading ? <LoadingState skeleton count={5} /> :
         error ? <ErrorState onRetry={load} /> :
         !data || data.list.length === 0 ? <EmptyState icon="👤" text="暂无用户" /> :
         (
           <>
             <table className="w-full text-sm">
               <thead className="bg-gray-50 text-gray-500">
                 <tr>
                   <th className="text-left px-4 py-3 font-medium">用户</th>
                   <th className="text-left px-4 py-3 font-medium">角色</th>
                   <th className="text-left px-4 py-3 font-medium">引导完成</th>
                   <th className="text-left px-4 py-3 font-medium">最后登录</th>
                   <th className="text-left px-4 py-3 font-medium">注册时间</th>
                   <th className="px-4 py-3"></th>
                 </tr>
               </thead>
               <tbody className="divide-y divide-gray-50">
                 {data.list.map((u) => (
                   <tr key={u.id} className="hover:bg-gray-50">
                     <td className="px-4 py-3">
                       <div className="flex items-center gap-2">
                         <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-sm">
                           👤
                         </div>
                         <div>
                           <div className="text-gray-800">{u.nickname || u.username}</div>
                           <div className="text-xs text-gray-400">@{u.username}</div>
                         </div>
                       </div>
                     </td>
                     <td className="px-4 py-3">
                       <span className={`badge ${u.role === 'admin' ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-600'}`}>
                         {u.role === 'admin' ? '管理员' : '用户'}
                       </span>
                     </td>
                     <td className="px-4 py-3">
                       {u.onboarded ? (
                         <span className="text-green-500">✓ 已完成</span>
                       ) : (
                         <span className="text-gray-400">未完成</span>
                       )}
                     </td>
                     <td className="px-4 py-3 text-gray-500">
                       {u.lastLoginAt ? formatDateTime(u.lastLoginAt) : '—'}
                     </td>
                     <td className="px-4 py-3 text-gray-500">{formatDateTime(u.createdAt)}</td>
                     <td className="px-4 py-3">
                       <Link
                         to={`/admin/users/${u.id}`}
                         className="text-primary-600 hover:text-primary-700 flex items-center text-xs"
                       >
                         详情 <ChevronRight size={14} />
                       </Link>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>

             {/* 分页 */}
             {data.total > data.pageSize && (
               <div className="flex items-center justify-between px-4 py-3 border-t border-gray-50 text-sm">
                 <span className="text-gray-500">
                   共 {data.total} 条 · 第 {data.page} 页
                 </span>
                 <div className="flex gap-2">
                   <button
                     onClick={() => setPage(p => Math.max(1, p - 1))}
                     disabled={page === 1}
                     className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                   >
                     上一页
                   </button>
                   <button
                     onClick={() => setPage(p => p + 1)}
                     disabled={page * data.pageSize >= data.total}
                     className="px-3 py-1 rounded border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                   >
                     下一页
                   </button>
                 </div>
               </div>
             )}
           </>
         )}
      </div>
    </div>
  )
}
