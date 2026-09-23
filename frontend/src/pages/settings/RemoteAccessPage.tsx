import { useEffect, useState, useCallback, useId } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  RefreshCw, Smartphone, ShieldCheck, Loader2, Server,
  ChevronDown, ChevronRight, Monitor, Trash2, Plus, Download,
  Activity, Clock, X, AlertCircle, CheckCircle, PlayCircle
} from 'lucide-react'
import Header from '../../components/Header'
import { Switch } from '../../components/ui/switch'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import { LoadingState, ErrorState } from '../../components/StateView'

// ===================== 类型 =====================

interface RemoteStatus {
  enabled: boolean
  running: boolean
  port: number
  code: string
  roots: string[]
  urls: string[]
}

/** 远程 Worker 节点（ExecInstance） */
interface RemoteInstance {
  id: string
  name: string
  fingerprint: string
  bound: boolean
  status: 'online' | 'offline' | 'revoked'
  lastHeartbeat: string | null
  createdAt: string
}

/** 授权目录（ResourceZone） */
interface ResourceZone {
  id: string
  instanceId: string
  spaceId: string
  sourcePath: string
  zoneName: string | null
  enabled: boolean
  instance?: { id: string; name: string; status: string }
}

/** 远程提取任务（FetchJob） */
type JobStatus = 'pending' | 'dispatched' | 'done' | 'failed' | 'rejected'
interface FetchJob {
  id: string
  instanceId: string
  resourceZoneId: string
  spaceId: string
  requesterId: string
  status: JobStatus
  requireConfirm: boolean
  requestedAt: string
  dispatchedAt: string | null
  finishedAt: string | null
  resultCount: number
  errorMsg: string | null
  resourceZone?: { sourcePath: string; zoneName: string | null }
  instance?: { name: string; fingerprint: string }
}

// ===================== 工具 =====================

function timeAgo(iso: string | null): string {
  if (!iso) return '从未'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s 前`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m 前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h 前`
  const d = Math.floor(h / 24)
  return `${d}d 前`
}

function statusIcon(s: JobStatus) {
  switch (s) {
    case 'done': return <CheckCircle size={14} className="text-green-500" />
    case 'pending': return <Clock size={14} className="text-amber-500" />
    case 'dispatched': return <PlayCircle size={14} className="text-blue-500" />
    case 'failed':
    case 'rejected': return <X size={14} className="text-red-500" />
  }
}

function statusLabel(s: JobStatus): string {
  return { pending: '待处理', dispatched: '执行中', done: '已完成', failed: '失败', rejected: '已拒绝' }[s]
}

// ===================== Tab 1：本机远程访问 =====================

function LanAccessTab() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [regenLoading, setRegenLoading] = useState(false)
  const switchLabelId = useId()
  const switchDescId = useId()

  const load = useCallback(async () => {
    setLoading(true); setError(false)
    try { setStatus(await unwrap<RemoteStatus>(api.get('/remote-access'))) }
    catch { setError(true) } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async () => {
    if (!status) return
    if (status.enabled && !(await confirm({ title: '关闭远程访问', message: '关闭后手机将无法访问电脑文件，确定关闭？', confirmText: '关闭', danger: true }))) return
    setSwitching(true)
    try {
      const data = await unwrap<RemoteStatus>(api.put('/remote-access', { enabled: !status.enabled }))
      setStatus(data); toast(data.enabled ? '远程访问已开启' : '远程访问已关闭', 'success')
    } catch { toast('操作失败，稍后再试', 'error') } finally { setSwitching(false) }
  }

  const regenCode = async () => {
    if (!(await confirm({ title: '重新生成访问码', message: '生成新访问码后，已连接的手机会全部下线，需要重新输码。继续？', confirmText: '生成' }))) return
    setRegenLoading(true)
    try {
      const data = await unwrap<RemoteStatus>(api.post('/remote-access/regenerate'))
      setStatus(data); toast('访问码已更新', 'success')
    } catch { toast('操作失败，稍后再试', 'error') } finally { setRegenLoading(false) }
  }

  const qrUrl = status?.urls[0] ? `${status.urls[0]}/#code=${status.code}` : ''

  if (loading) return <LoadingState skeleton count={3} />
  if (error || !status) return <ErrorState onRetry={load} />

  return (
    <>
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
            <Smartphone size={20} className="text-primary-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div id={switchLabelId} className="text-sm font-medium text-gray-800">手机远程访问电脑文件</div>
            <div className="text-xs text-gray-400 mt-0.5">{status.running ? '运行中 · 局域网直连' : '已关闭'}</div>
          </div>
          <Switch checked={status.enabled} onChange={() => toggle()} disabled={switching}
            aria-labelledby={switchLabelId} aria-describedby={switchDescId} testId="remote-access-switch" />
        </div>
        <p id={switchDescId} className="text-xs text-gray-400 mt-3 leading-relaxed">
          手机和电脑连同一个 Wi-Fi，扫码或输地址即可浏览、下载、上传电脑文件。数据只在局域网内传输，不出门。
        </p>
      </div>

      {status.enabled && (
        <>
          <div className="card p-4">
            <div className="text-sm font-medium text-gray-800 mb-3">手机连接</div>
            {status.urls.length === 0 ? (
              <div className="text-xs text-amber-600 bg-amber-50 rounded-lg p-3">
                没检测到局域网 IP。确认电脑已连接 Wi-Fi 或路由器后刷新。
              </div>
            ) : (
              <div className="flex items-center gap-4">
                <div className="bg-white border border-gray-100 rounded-xl p-2.5 flex-shrink-0">
                  <QRCodeSVG value={qrUrl} size={112} level="M" />
                </div>
                <div className="flex-1 min-w-0 space-y-2">
                  <div>
                    <div className="text-xs text-gray-400">访问地址（任选其一）</div>
                    {status.urls.map((u) => (
                      <div key={u} className="text-sm text-gray-700 font-mono truncate">{u}</div>
                    ))}
                  </div>
                  <div>
                    <div className="text-xs text-gray-400">访问码</div>
                    <div className="flex items-center gap-2">
                      <span className="text-xl font-bold tracking-[0.3em] text-gray-800">{status.code}</span>
                      <button onClick={regenCode} disabled={regenLoading}
                        className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-primary-600 bg-primary-50 hover:bg-primary-100 transition-colors disabled:opacity-50">
                        {regenLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        换码
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="card p-4">
            <div className="text-sm font-medium text-gray-800 mb-2">授权目录</div>
            <div className="text-xs text-gray-400 mb-3">手机只能访问以下目录：</div>
            <div className="space-y-1.5">
              {status.roots.map((r) => (
                <div key={r} className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 rounded-lg px-3 py-2">
                  <ShieldCheck size={14} className="text-green-500 flex-shrink-0" />
                  <span className="truncate font-mono text-xs">{r}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="text-xs text-gray-300 leading-relaxed px-1">
            服务默认关闭、只走局域网；访问码输错 5 次锁一分钟；换码后所有手机端立即下线。以后要在外网（4G/5G）访问，走云端中转（已支持）。
          </div>
        </>
      )}
    </>
  )
}

// ===================== Tab 2：远程节点 =====================

function RemoteNodesTab() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [instances, setInstances] = useState<RemoteInstance[]>([])
  const [zones, setZones] = useState<ResourceZone[]>([])
  const [jobs, setJobs] = useState<FetchJob[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAddZone, setShowAddZone] = useState<string | null>(null)  // instanceId
  const [newZonePath, setNewZonePath] = useState('')
  const [newZoneName, setNewZoneName] = useState('')

  // 加载所有数据
  const loadAll = useCallback(async () => {
    setLoading(true); setError(false)
    try {
      const [insts, zs, js] = await Promise.all([
        unwrap<RemoteInstance[]>(api.get('/remote-fetch/instances')),
        unwrap<ResourceZone[]>(api.get('/remote-fetch/resource-zones')),
        unwrap<FetchJob[]>(api.get('/remote-fetch/fetch-jobs')),
      ])
      setInstances(insts || [])
      setZones(zs || [])
      setJobs(js || [])
    } catch { setError(true) } finally { setLoading(false) }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  // 每 10s 刷心跳/状态 + 轮询进行中任务
  useEffect(() => {
    const t = setInterval(() => {
      const hasRunning = jobs.some((j) => j.status === 'pending' || j.status === 'dispatched')
      if (hasRunning) loadAll()
    }, 10000)
    return () => clearInterval(t)
  }, [jobs, loadAll])

  // 展开/收起节点
  const toggle = (id: string) => {
    setExpanded((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // 解绑节点
  const unbind = async (inst: RemoteInstance) => {
    if (!(await confirm({
      title: '解绑远程节点',
      message: `确定解绑「${inst.name}」？该电脑上的 Worker 会立即失去访问权。`,
      confirmText: '解绑', danger: true,
    }))) return
    try {
      await unwrap(api.post(`/remote-fetch/instances/${inst.id}/unbind`))
      toast('已解绑', 'success'); loadAll()
    } catch { toast('解绑失败', 'error') }
  }

  // 加授权目录
  const addZone = async (instanceId: string) => {
    if (!newZonePath.trim()) { toast('请输入目录路径', 'warning'); return }
    try {
      await unwrap(api.post('/remote-fetch/resource-zones', {
        instanceId, sourcePath: newZonePath.trim(), zoneName: newZoneName.trim() || null,
      }))
      toast('已添加授权目录', 'success')
      setShowAddZone(null); setNewZonePath(''); setNewZoneName(''); loadAll()
    } catch (e: any) {
      toast(e?.response?.data?.message || '添加失败', 'error')
    }
  }

  // 发起 FetchJob
  const fetchFromZone = async (zone: ResourceZone) => {
    if (!(await confirm({
      title: '发起远程提取',
      message: `从「${zone.zoneName || zone.sourcePath}」提取文件到当前空间？该电脑 Worker 会扫描并同步目录中的文件。`,
      confirmText: '开始提取',
    }))) return
    try {
      const job = await unwrap<FetchJob>(api.post(`/remote-fetch/resource-zones/${zone.id}/fetch`, {}))
      toast('任务已发起', 'success')
      setJobs((prev) => [job, ...prev])
    } catch (e: any) {
      toast(e?.response?.data?.message || '发起失败', 'error')
    }
  }

  // 节点的目录
  const zonesOf = (instId: string) => zones.filter((z) => z.instanceId === instId)
  // 节点的最近任务
  const jobsOf = (instId: string) => jobs.filter((j) => j.instanceId === instId).slice(0, 3)

  if (loading) return <LoadingState skeleton count={3} />
  if (error) return <ErrorState onRetry={loadAll} />

  return (
    <div className="space-y-3">
      {/* 统计 */}
      <div className="card p-3 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <Server size={14} className="text-gray-400" />
          <span className="text-gray-500">节点</span>
          <span className="font-semibold text-gray-800">{instances.length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-gray-500">在线</span>
          <span className="font-semibold text-green-600">{instances.filter((i) => i.status === 'online').length}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-gray-400" />
          <span className="text-gray-500">进行中</span>
          <span className="font-semibold text-amber-600">
            {jobs.filter((j) => j.status === 'pending' || j.status === 'dispatched').length}
          </span>
        </div>
      </div>

      {/* 节点列表 */}
      {instances.length === 0 ? (
        <div className="card p-6 text-center">
          <Monitor size={32} className="mx-auto text-gray-300 mb-2" />
          <div className="text-sm text-gray-500">还没有远程节点</div>
          <div className="text-xs text-gray-400 mt-1">在另一台电脑上登录同一账号，开启 Worker 即可出现</div>
        </div>
      ) : (
        instances.map((inst) => {
          const online = inst.status === 'online'
          const open = expanded.has(inst.id)
          const myZones = zonesOf(inst.id)
          const myJobs = jobsOf(inst.id)
          return (
            <div key={inst.id} className="card overflow-hidden">
              {/* 节点头部 */}
              <button className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50 transition-colors"
                onClick={() => toggle(inst.id)}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${online ? 'bg-green-50' : 'bg-gray-100'}`}>
                  <Monitor size={20} className={online ? 'text-green-600' : 'text-gray-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800 truncate">{inst.name}</span>
                    <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full ${online ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${online ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
                      {online ? '在线' : '离线'}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <Activity size={11} />
                    最后心跳 {timeAgo(inst.lastHeartbeat)}
                  </div>
                </div>
                {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
              </button>

              {/* 展开内容 */}
              {open && (
                <div className="px-4 pb-4 border-t border-gray-100 bg-gray-50/50">
                  {/* 授权目录 */}
                  <div className="mt-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="text-xs font-medium text-gray-600">授权目录 ({myZones.length})</div>
                      <button onClick={(e) => { e.stopPropagation(); setShowAddZone(inst.id); setNewZonePath(''); setNewZoneName('') }}
                        className="text-xs text-primary-600 hover:text-primary-700 flex items-center gap-0.5">
                        <Plus size={12} /> 添加
                      </button>
                    </div>

                    {myZones.length === 0 ? (
                      <div className="text-xs text-gray-400 bg-white rounded-lg p-2 border border-dashed border-gray-200">
                        还没授权任何目录
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        {myZones.map((z) => (
                          <div key={z.id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-gray-100">
                            <ShieldCheck size={13} className="text-green-500 flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-700 truncate">{z.zoneName || z.sourcePath}</div>
                              <div className="text-gray-400 truncate font-mono text-[10px]">{z.sourcePath}</div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); fetchFromZone(z) }}
                              className="flex items-center gap-1 px-2 py-1 rounded-md text-primary-600 bg-primary-50 hover:bg-primary-100 flex-shrink-0">
                              <Download size={11} /> 提取
                            </button>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 加目录表单 */}
                    {showAddZone === inst.id && (
                      <div className="mt-2 bg-white rounded-lg p-3 border border-primary-100 space-y-2">
                        <input value={newZonePath} onChange={(e) => setNewZonePath(e.target.value)}
                          placeholder="目录路径 例如 C:\Users\xxx\Downloads"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-primary-400 font-mono" />
                        <input value={newZoneName} onChange={(e) => setNewZoneName(e.target.value)}
                          placeholder="名称（可选）如 下载"
                          className="w-full px-2 py-1.5 text-xs border border-gray-200 rounded-md focus:outline-none focus:border-primary-400" />
                        <div className="flex gap-2 justify-end">
                          <button onClick={() => setShowAddZone(null)}
                            className="px-3 py-1 text-xs text-gray-500 hover:text-gray-700">取消</button>
                          <button onClick={() => addZone(inst.id)}
                            className="px-3 py-1 text-xs text-white bg-primary-600 hover:bg-primary-700 rounded-md">添加</button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* 最近任务 */}
                  {myJobs.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs font-medium text-gray-600 mb-2">最近任务</div>
                      <div className="space-y-1.5">
                        {myJobs.map((j) => (
                          <div key={j.id} className="flex items-center gap-2 text-xs bg-white rounded-lg px-3 py-1.5 border border-gray-100">
                            {statusIcon(j.status)}
                            <span className="text-gray-700 flex-1 truncate">
                              {j.resourceZone?.zoneName || j.resourceZone?.sourcePath?.substring(0, 30) || '?'}
                            </span>
                            {j.status === 'done' && (
                              <span className="text-gray-500">{j.resultCount} 个文件</span>
                            )}
                            <span className="text-gray-400">{timeAgo(j.requestedAt)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 解绑按钮 */}
                  <div className="mt-3 pt-2 border-t border-gray-200/50 flex justify-end">
                    <button onClick={(e) => { e.stopPropagation(); unbind(inst) }}
                      className="flex items-center gap-1 text-xs text-red-500 hover:text-red-600">
                      <Trash2 size={12} /> 解绑节点
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })
      )}

      {/* 全局任务历史 */}
      {jobs.length > 0 && (
        <div className="card p-4">
          <div className="text-sm font-medium text-gray-800 mb-3 flex items-center gap-2">
            <Activity size={16} className="text-gray-400" /> 提取任务历史
          </div>
          <div className="space-y-1.5">
            {jobs.map((j) => {
              const instName = j.instance?.name || '?'
              const zoneLabel = j.resourceZone?.zoneName || j.resourceZone?.sourcePath?.split(/[\\/]/).pop() || '?'
              return (
                <div key={j.id} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                  {statusIcon(j.status)}
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-gray-700">{zoneLabel}</span>
                    <span className="text-gray-400 mx-1">·</span>
                    <span className="text-gray-500">{instName}</span>
                    {j.status === 'done' && <span className="text-green-600 ml-1">· {j.resultCount} 个文件</span>}
                    {j.errorMsg && <span className="text-red-500 ml-1">· {j.errorMsg}</span>}
                  </div>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                    j.status === 'done' ? 'bg-green-50 text-green-600' :
                    j.status === 'pending' ? 'bg-amber-50 text-amber-600' :
                    j.status === 'dispatched' ? 'bg-blue-50 text-blue-600' :
                    'bg-red-50 text-red-600'
                  }`}>{statusLabel(j.status)}</span>
                  <span className="text-gray-400 text-[10px]">{timeAgo(j.requestedAt)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 说明 */}
      <div className="text-xs text-gray-300 leading-relaxed px-1">
        远程节点 = 另一台电脑上运行的绿角犀 Worker。两台电脑连同一个账号，Worker 会自动绑定为节点。你可以从授权目录发起提取，Worker 扫描后自动把文件同步到当前电脑的资产库。
      </div>
    </div>
  )
}

// ===================== 主页面 =====================

export default function RemoteAccessPage() {
  const [tab, setTab] = useState<'lan' | 'nodes'>('lan')

  return (
    <div className="app-shell pb-6">
      <Header title="远程访问" />

      {/* Tab 切换 */}
      <div className="px-3 pt-3">
        <div className="flex bg-gray-100 rounded-xl p-1">
          <button onClick={() => setTab('lan')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'lan' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Smartphone size={14} /> 本机远程
          </button>
          <button onClick={() => setTab('nodes')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === 'nodes' ? 'bg-white text-primary-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            <Monitor size={14} /> 远程节点
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        {tab === 'lan' ? <LanAccessTab /> : <RemoteNodesTab />}
      </div>
    </div>
  )
}
