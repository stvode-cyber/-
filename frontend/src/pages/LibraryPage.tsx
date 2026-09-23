import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import {
  FolderPlus, Tag, Upload, Search, FileText, Image as ImageIcon, Music,
  Video, File, Share2, History, Pencil, Trash2, Download, X, RefreshCw,
  ChevronRight, Home, Check,
} from 'lucide-react'
import Header from '../components/Header'
import SyncPanel from '../components/SyncPanel'
import { api, unwrap } from '../lib/api'
import { useToast } from '../components/Toast'
import { LoadingState, ErrorState, EmptyState } from '../components/StateView'
import { useConfirm } from '../components/ConfirmDialog'
import { useDebounce } from '../hooks/useDebounce'
import { formatDateTime } from '../lib/utils'
import { listCached, cacheAsset, getCached, readCached, isDesktop } from '../lib/localCache'
import {
  listCategoryRules, createCategoryRule, deleteCategoryRule, reclassifyAssets, getAssetStats,
  exportCategoryRules, importCategoryRules,
  type CategoryRule, type CategoryRuleMatchType, type AssetStats,
} from '../lib/api'

// ===== 类型（与后端 DTO 对齐） =====
interface Space { id: string; name: string }
interface Folder { id: string; name: string; parentId: string | null; path: string; _count?: { assets: number } }
interface TagItem { id: string; name: string; _count?: { assetTags: number } }
interface AssetTag { tag: { id: string; name: string } }
interface Asset {
  id: string; name: string; type: string; category?: string; size: number; mime: string | null
  storageKey: string | null; folderId: string | null; metadata: string | null
  tags: AssetTag[]; createdAt: string
}
interface Version { id: string; storageKey: string; size: number; note: string | null; createdAt: string }
interface ShareResult { token: string; expireAt: string | null; permission: string }

const TYPE_META: Record<string, { label: string; icon: typeof File; color: string }> = {
  document: { label: '文档', icon: FileText, color: 'text-blue-500' },
  image: { label: '图片', icon: ImageIcon, color: 'text-green-500' },
  audio: { label: '音频', icon: Music, color: 'text-purple-500' },
  video: { label: '视频', icon: Video, color: 'text-red-500' },
}
const TYPES = ['document', 'image', 'audio', 'video'] as const

// 离线语义分类徽章配色（与后端 classifyAsset 的 10 类对齐）
const CATEGORY_META: Record<string, { color: string; bg: string }> = {
  票据: { color: 'text-amber-700', bg: 'bg-amber-100' },
  截图: { color: 'text-sky-700', bg: 'bg-sky-100' },
  合同: { color: 'text-rose-700', bg: 'bg-rose-100' },
  文档: { color: 'text-blue-700', bg: 'bg-blue-100' },
  照片: { color: 'text-emerald-700', bg: 'bg-emerald-100' },
  代码: { color: 'text-violet-700', bg: 'bg-violet-100' },
  音频: { color: 'text-purple-700', bg: 'bg-purple-100' },
  视频: { color: 'text-red-700', bg: 'bg-red-100' },
  归档: { color: 'text-orange-700', bg: 'bg-orange-100' },
  其他: { color: 'text-gray-600', bg: 'bg-gray-100' },
}
const CATEGORIES = ['票据', '截图', '合同', '文档', '照片', '代码', '音频', '视频', '归档', '其他']
const PAGE_SIZE = 20

function fmtSize(n?: number | null) {
  if (!n) return '0 B'
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

export default function LibraryPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()

  const [spaces, setSpaces] = useState<Space[]>([])
  const [spaceId, setSpaceId] = useState<string>('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [tags, setTags] = useState<TagItem[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [folderId, setFolderId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [tagFilter, setTagFilter] = useState<string>('')
  const [q, setQ] = useState('')
  const debouncedQ = useDebounce(q, 350)
  const [page, setPage] = useState(1)

  const [selected, setSelected] = useState<Asset | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const [showFolder, setShowFolder] = useState(false)
  const [showTag, setShowTag] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [cachedIds, setCachedIds] = useState<string[]>([])

  // 分类统计看板 + 分类规则管理
  const [stats, setStats] = useState<AssetStats | null>(null)
  const [ruleModal, setRuleModal] = useState(false)
  const [rules, setRules] = useState<CategoryRule[]>([])
  const [ruleForm, setRuleForm] = useState<{ matchType: CategoryRuleMatchType; pattern: string; targetCategory: string; priority: number }>({
    matchType: 'extension', pattern: '', targetCategory: '文档', priority: 0,
  })
  const [reclassifying, setReclassifying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 加载空间列表
  const loadSpaces = useCallback(async () => {
    try {
      const list = await unwrap<Space[]>(api.get('/spaces'))
      setSpaces(list)
      if (list.length && !spaceId) setSpaceId(list[0].id)
      if (!list.length) setError('请先创建一个资料空间')
    } catch (e: any) {
      setError(e?.message || '加载空间失败')
    }
  }, [spaceId])

  // 加载文件夹 / 标签
  const loadFolders = useCallback(async (sid: string) => {
    const list = await unwrap<Folder[]>(api.get('/folders', { params: { spaceId: sid } }))
    setFolders(list)
  }, [])
  const loadTags = useCallback(async (sid: string) => {
    const list = await unwrap<TagItem[]>(api.get('/tags', { params: { spaceId: sid } }))
    setTags(list)
  }, [])

  // 加载资产
  const loadAssets = useCallback(async () => {
    if (!spaceId) return
    setLoading(true)
    setError(null)
    try {
      const params: Record<string, unknown> = { spaceId, page, pageSize: PAGE_SIZE }
      if (folderId) params.folderId = folderId
      if (typeFilter) params.type = typeFilter
      if (categoryFilter) params.category = categoryFilter
      if (tagFilter) params.tag = tagFilter
      if (debouncedQ) params.q = debouncedQ
      const r = await unwrap<{ list: Asset[]; total: number }>(api.get('/assets', { params }))
      setAssets(r.list)
      setTotal(r.total)
    } catch (e: any) {
      setError(e?.message || '加载资产失败')
    } finally {
      setLoading(false)
    }
  }, [spaceId, folderId, typeFilter, categoryFilter, tagFilter, debouncedQ, page])

  useEffect(() => { loadSpaces() }, [loadSpaces])

  // 初始加载本地缓存索引（桌面端走 IPC / 浏览器走 IndexedDB），用于卡片缓存状态展示
  useEffect(() => {
    listCached().then(setCachedIds).catch(() => {})
  }, [])

  useEffect(() => {
    if (!spaceId) return
    setFolderId(null); setTagFilter(''); setTypeFilter(''); setQ(''); setPage(1); setSelectedIds([])
    loadFolders(spaceId).catch(() => {})
    loadTags(spaceId).catch(() => {})
  }, [spaceId, loadFolders, loadTags])

  useEffect(() => { loadAssets() }, [loadAssets])

  // 加载分类统计看板
  const loadStats = useCallback(async () => {
    if (!spaceId) return
    try {
      const s = await getAssetStats(spaceId)
      setStats(s)
    } catch {
      setStats(null)
    }
  }, [spaceId])

  // 加载分类规则
  const loadRules = useCallback(async () => {
    if (!spaceId) return
    try {
      const r = await listCategoryRules(spaceId)
      setRules(r.rules)
    } catch {
      setRules([])
    }
  }, [spaceId])

  useEffect(() => {
    if (!spaceId) return
    loadStats().catch(() => {})
  }, [spaceId, loadStats, assets.length])

  const reloadAll = useCallback(() => {
    if (spaceId) {
      loadFolders(spaceId).catch(() => {})
      loadTags(spaceId).catch(() => {})
    }
    loadAssets()
  }, [spaceId, loadAssets, loadFolders, loadTags])

  // ===== 分类规则管理 =====
  const openRuleModal = async () => {
    setRuleModal(true)
    await loadRules().catch(() => {})
  }
  const createRule = async () => {
    if (!spaceId) return
    const pattern = ruleForm.pattern.trim()
    if (!pattern) { toast('请填写匹配内容', 'error'); return }
    try {
      await createCategoryRule({ spaceId, ...ruleForm, pattern: pattern.toLowerCase() })
      toast('规则已创建', 'success')
      setRuleForm({ matchType: 'extension', pattern: '', targetCategory: '文档', priority: 0 })
      await loadRules().catch(() => {})
    } catch (e: any) {
      toast(e?.message || '创建失败', 'error')
    }
  }
  const removeRule = async (id: string) => {
    if (!(await confirm('确定删除该分类规则？'))) return
    try {
      await deleteCategoryRule(id)
      setRules((rs) => rs.filter((r) => r.id !== id))
      toast('已删除', 'success')
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }
  const runReclassify = async () => {
    if (!spaceId) return
    if (!(await confirm('将按当前分类规则重新计算本空间全部资产的分类，确定继续？'))) return
    setReclassifying(true)
    try {
      const r = await reclassifyAssets(spaceId)
      toast(`重算完成：共 ${r.total} 项，变更 ${r.changed} 项`, 'success')
      await Promise.all([loadStats().catch(() => {}), loadAssets().catch(() => {})])
    } catch (e: any) {
      toast(e?.message || '重算失败', 'error')
    } finally {
      setReclassifying(false)
    }
  }

  // 导出分类规则（备份 / 跨空间迁移）
  const handleExportRules = async () => {
    if (!spaceId) return
    try {
      const data = await exportCategoryRules(spaceId)
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `category-rules-${spaceId}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast('规则已导出', 'success')
    } catch (e: any) {
      toast(e?.message || '导出失败', 'error')
    }
  }
  // 导入分类规则（cover 覆盖式 / merge 增量合并）
  const [importMode, setImportMode] = useState<'cover' | 'merge'>('cover')
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 允许重复选择同一文件
    if (!file || !spaceId) return
    try {
      const parsed = JSON.parse(await file.text())
      if (!parsed || !Array.isArray(parsed.rules)) throw new Error('文件格式不正确（缺少 rules 数组）')
      const r = await importCategoryRules(spaceId, parsed.rules, importMode)
      const msg = r.mode === 'merge'
        ? `合并完成：新增 ${r.created} 条、更新 ${r.updated} 条`
        : `导入成功：${r.created} 条规则`
      toast(msg, 'success')
      await Promise.all([loadRules().catch(() => {}), loadStats().catch(() => {})])
    } catch (err: any) {
      toast(err?.message || '导入失败', 'error')
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  // ===== 操作 =====
  const downloadSelected = async () => {
    if (!selectedIds.length) return
    try {
      const resp = await api.post('/assets/batch-download', { ids: selectedIds }, { responseType: 'blob' })
      const blob = resp.data as Blob
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `assets-${selectedIds.length}-${Date.now()}.zip`
      a.click()
      URL.revokeObjectURL(url)
      toast(`已打包下载 ${selectedIds.length} 个文件`, 'success')
    } catch (e: any) {
      toast(e?.message || '批量下载失败', 'error')
    }
  }
  // 把勾选的资产原文逐个缓存到本地（桌面端本地磁盘 / 浏览器 IndexedDB），实现「离线可用、不重复下载」
  const cacheSelected = async () => {
    if (!selectedIds.length) return
    let ok = 0
    for (const id of selectedIds) {
      try {
        const asset = assets.find((a) => a.id === id)
        const resp = await api.get(`/assets/${id}/file`, { responseType: 'blob' })
        const blob = resp.data as Blob
        await cacheAsset(id, asset?.name || id, blob)
        ok++
      } catch {
        /* 跳过单个失败 */
      }
    }
    const latest = await listCached().catch(() => [])
    setCachedIds(latest)
    toast(`已缓存 ${ok} 个文件到本地${isDesktop() ? '（磁盘）' : '（本机）'}`, 'success')
  }
  const handleUpload = async (payload: { base64: string; name: string; mime: string; folderId: string | null; tags: string[]; description: string }) => {
    await unwrap(api.post('/assets/upload', { spaceId, ...payload }))
    toast('上传成功', 'success')
    setShowUpload(false)
    reloadAll()
  }
  const handleCreateFolder = async (name: string, parentId: string | null) => {
    await unwrap(api.post('/folders', { spaceId, name, parentId: parentId || undefined }))
    toast('文件夹已创建', 'success')
    setShowFolder(false)
    loadFolders(spaceId).catch(() => {})
  }
  const handleCreateTag = async (name: string) => {
    await unwrap(api.post('/tags', { spaceId, name }))
    toast('标签已保存', 'success')
    setShowTag(false)
    loadTags(spaceId).catch(() => {})
  }
  const handleDeleteFolder = async (f: Folder) => {
    const ok = await confirm({ title: '删除文件夹', message: `确定删除「${f.path}」？子文件夹将一并删除，资产不会被删除（仅移出目录）。` })
    if (!ok) return
    try {
      await unwrap(api.delete(`/folders/${f.id}`))
      toast('文件夹已删除', 'success')
      if (folderId === f.id) setFolderId(null)
      reloadAll()
    } catch (e: any) { toast(e?.message || '删除失败', 'error') }
  }
  const handleDeleteAsset = async (a: Asset) => {
    const ok = await confirm({ title: '删除资产', message: `确定删除「${a.name}」？文件将永久移除。` })
    if (!ok) return
    try {
      await unwrap(api.delete(`/assets/${a.id}`))
      toast('资产已删除', 'success')
      setSelected(null)
      reloadAll()
    } catch (e: any) { toast(e?.message || '删除失败', 'error') }
  }

  const sortedFolders = useMemo(() => [...folders].sort((a, b) => a.path.localeCompare(b.path)), [folders])

  return (
    <div className="min-h-screen bg-panel-200 pb-6 md:pb-0">
      <div className="md:shrink-0">
        <Header
          title="资料库"
          right={
            <div className="flex items-center gap-1">
              <button onClick={() => setShowTag(true)} className="p-2 text-accent-600" title="新建标签"><Tag size={20} /></button>
              <button onClick={() => setShowFolder(true)} className="p-2 text-accent-600" title="新建文件夹"><FolderPlus size={20} /></button>
              <button onClick={() => setShowUpload(true)} className="p-2 text-primary-500" title="上传资产"><Upload size={20} /></button>
            </div>
          }
        />
      </div>

      {/* 空间选择：移动端横向 chips（PC 端由左侧栏竖向列表替代，故隐藏） */}
      <div className="px-4 pt-3 md:hidden">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {spaces.map((s) => (
            <button
              key={s.id}
              onClick={() => setSpaceId(s.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-sm border ${spaceId === s.id ? 'bg-primary-500 text-white border-primary-500' : 'bg-panel-300 text-accent-700 border-accent-200'}`}
            >
              {s.name}
            </button>
          ))}
          {!spaces.length && <span className="text-sm text-accent-400">暂无空间</span>}
        </div>
      </div>

      {spaceId && (
        <div className="flex gap-3 px-4 pt-3 md:flex-row md:gap-4 md:items-start md:px-4 md:pt-3">
          {/* 左侧栏：PC 工作台常驻（空间 + 文件夹树） */}
          <aside className="w-36 shrink-0 bg-panel-300 rounded-xl p-2 max-h-[60vh] overflow-y-auto md:w-64 md:max-h-[calc(100vh-6rem)] md:overflow-y-auto md:p-0">
            {/* PC 端：空间竖向列表（移动端已在顶部 chips 选择，此处隐藏） */}
            <div className="hidden md:block md:p-3 md:border-b md:border-accent-200">
              <div className="text-xs text-accent-400 font-medium mb-2 px-1">资料空间</div>
              <div className="space-y-1">
                {spaces.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSpaceId(s.id)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate ${spaceId === s.id ? 'bg-primary-500 text-white' : 'text-accent-700 hover:bg-panel-200'}`}
                  >
                    {s.name}
                  </button>
                ))}
                {!spaces.length && <div className="text-sm text-accent-400 px-1">暂无空间</div>}
              </div>
            </div>
            {/* 文件夹树（移动/PC 共用） */}
            <div className="md:p-2 md:max-h-[calc(100vh-12rem)] md:overflow-y-auto">
              <FolderNode
                label="全部"
                active={folderId === null}
                depth={0}
                icon={<Home size={14} />}
                onClick={() => setFolderId(null)}
              />
              {sortedFolders.map((f) => {
                const depth = f.path.split('/').length - 1
                return (
                  <div key={f.id} className="group flex items-center">
                    <FolderNode
                      label={f.name}
                      active={folderId === f.id}
                      depth={depth}
                      count={f._count?.assets}
                      onClick={() => setFolderId(f.id)}
                    />
                    <button
                      onClick={() => handleDeleteFolder(f)}
                      className="ml-auto mr-1 text-accent-300 opacity-0 group-hover:opacity-100 hover:text-red-500"
                      title="删除文件夹"
                    ><Trash2 size={13} /></button>
                  </div>
                )
              })}
            </div>
          </aside>

          {/* 右侧：筛选 + 资产网格 */}
          <main className="flex-1 min-w-0 space-y-3 md:min-w-0">
              {/* 桌面端：PC 自动采集与同步（仅 Electron 环境显示） */}
              <SyncPanel />

              {/* 搜索 + 类型 */}
              <div className="flex gap-2">
                <div className="flex-1 relative">
                  <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-accent-400" />
                  <input
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setPage(1) }}
                    placeholder="搜索文件名 / 描述"
                    className="w-full pl-9 pr-3 py-2 rounded-xl bg-panel-300 text-sm outline-none border border-accent-200 focus:border-primary-400"
                  />
                </div>
                <select
                  value={typeFilter}
                  onChange={(e) => { setTypeFilter(e.target.value); setPage(1) }}
                  className="px-2 py-2 rounded-xl bg-panel-300 text-sm border border-accent-200 outline-none"
                >
                  <option value="">全部类型</option>
                  {TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
                </select>
              </div>

              {/* 离线语义分类筛选（智能归纳结果，按后端 classifyAsset 的 10 类） */}
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => { setCategoryFilter(''); setPage(1) }}
                  className={`px-2.5 py-1 rounded-full text-xs border ${categoryFilter === '' ? 'bg-primary-500 text-white border-primary-500' : 'bg-panel-300 text-accent-600 border-accent-200'}`}
                >全部</button>
                {CATEGORIES.map((c) => {
                  const meta = CATEGORY_META[c] || CATEGORY_META['其他']
                  const active = categoryFilter === c
                  return (
                    <button
                      key={c}
                      onClick={() => { setCategoryFilter(active ? '' : c); setPage(1) }}
                      className={`px-2.5 py-1 rounded-full text-xs border ${active ? `${meta.bg} ${meta.color} border-current` : 'bg-panel-300 text-accent-600 border-accent-200'}`}
                    >{c}</button>
                  )
                })}
              </div>

              {/* 分类统计看板（按智能归纳的 10 类汇总，DAM 归纳概览） */}
              <div className="card p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-sm font-medium text-accent-700">
                    分类统计{stats ? ` · 共 ${stats.total} 项` : ''}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={openRuleModal}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-panel-300 text-accent-700 text-xs border border-accent-200 hover:border-primary-400"
                    ><Pencil size={13} /> 分类规则</button>
                    <button
                      onClick={runReclassify}
                      disabled={reclassifying}
                      className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-panel-300 text-accent-700 text-xs border border-accent-200 hover:border-primary-400 disabled:opacity-40"
                    ><RefreshCw size={13} className={reclassifying ? 'animate-spin' : ''} /> 重新分类</button>
                  </div>
                </div>
                {stats && stats.total > 0 ? (
                  <div className="space-y-1.5">
                    {CATEGORIES.filter((c) => (stats.byCategory[c] || 0) > 0).map((c) => {
                      const cnt = stats.byCategory[c] || 0
                      const pct = Math.round((cnt / stats.total) * 100)
                      const meta = CATEGORY_META[c] || CATEGORY_META['其他']
                      return (
                        <button
                          key={c}
                          onClick={() => { setCategoryFilter((categoryFilter === c ? '' : c)); setPage(1) }}
                          className="w-full flex items-center gap-2 group"
                          title={`筛选「${c}」`}
                        >
                          <span className={`w-12 text-right text-xs ${meta.color}`}>{c}</span>
                          <span className="flex-1 h-3 rounded-full bg-panel-200 overflow-hidden">
                            <span className={`block h-full ${meta.bg} ${meta.color}`} style={{ width: `${pct}%` }} />
                          </span>
                          <span className="w-14 text-right text-xs text-accent-400">{cnt} 项 · {pct}%</span>
                        </button>
                      )
                    })}
                  </div>
                ) : (
                  <div className="text-xs text-accent-400 py-2">暂无资产数据</div>
                )}

                {/* 近 30 天新增趋势 */}
                {stats && stats.trend && stats.trend.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-accent-100">
                    <div className="text-xs text-accent-500 mb-1">近 30 天新增趋势</div>
                    <TrendChart data={stats.trend} />
                  </div>
                )}
              </div>

              {/* 批量选择与下载（分开下载一部分） */}
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1 text-xs text-accent-500 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={assets.length > 0 && selectedIds.length === assets.length}
                    onChange={(e) => setSelectedIds(e.target.checked ? assets.map((a) => a.id) : [])}
                    className="w-4 h-4 accent-primary-500"
                  />
                  全选本页
                </label>
                <button
                  disabled={selectedIds.length === 0}
                  onClick={downloadSelected}
                  className="ml-auto flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-sm disabled:opacity-40"
                >
                  <Download size={16} /> 下载选中{selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                </button>
                <button
                  disabled={selectedIds.length === 0}
                  onClick={cacheSelected}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-panel-300 text-accent-700 text-sm border border-accent-200 disabled:opacity-40"
                  title="把勾选的文件缓存到本地，断网后可用"
                >
                  <RefreshCw size={16} /> 缓存选中{selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
                </button>
              </div>

              {/* 标签过滤 */}
              {tags.length > 0 && (
                <div className="flex gap-1.5 flex-wrap">
                  {tags.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => { setTagFilter(tagFilter === t.name ? '' : t.name); setPage(1) }}
                      className={`px-2 py-0.5 rounded-full text-xs border ${tagFilter === t.name ? 'bg-primary-100 text-primary-600 border-primary-400' : 'bg-panel-300 text-accent-600 border-accent-200'}`}
                    >
                      #{t.name} <span className="opacity-60">{t._count?.assetTags || 0}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 资产网格 */}
              {loading ? <LoadingState /> : error ? <ErrorState text={error} onRetry={reloadAll} />
                : assets.length === 0 ? <EmptyState text="该目录下还没有资产，点右上角上传" />
                  : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 md:gap-3">
                        {assets.map((a) => {
                          const meta = TYPE_META[a.type] || { label: a.type, icon: File, color: 'text-accent-500' }
                          const Icon = meta.icon
                          return (
                            <button
                              key={a.id}
                              onClick={() => setSelected(a)}
                              className={`relative text-left bg-panel-300 rounded-xl p-3 border transition ${selectedIds.includes(a.id) ? 'border-primary-400 ring-1 ring-primary-200' : 'border-accent-100 hover:border-primary-300'}`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedIds.includes(a.id)}
                                onClick={(e) => e.stopPropagation()}
                                onChange={(e) => setSelectedIds((prev) => e.target.checked ? [...new Set([...prev, a.id])] : prev.filter((id) => id !== a.id))}
                                className="absolute top-2 right-2 w-4 h-4 accent-primary-500"
                              />
                              <Icon size={22} className={meta.color} />
                              <div className="mt-2 text-sm font-medium text-accent-800 truncate">{a.name}</div>
                              <div className="text-[11px] text-accent-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                <span>{meta.label}</span><span>·</span><span>{fmtSize(a.size)}</span>
                                {a.category && a.category !== '其他' && (() => {
                                  const cm = CATEGORY_META[a.category] || CATEGORY_META['其他']
                                  return <span className={`px-1.5 py-0.5 rounded-full ${cm.bg} ${cm.color}`}>{a.category}</span>
                                })()}
                              </div>
                              {a.tags.length > 0 && (
                                <div className="mt-1 flex gap-1 flex-wrap">
                                  {a.tags.slice(0, 3).map((t) => (
                                    <span key={t.tag.id} className="text-[10px] text-primary-500 bg-primary-50 px-1 rounded">#{t.tag.name}</span>
                                  ))}
                                </div>
                              )}
                              {cachedIds.includes(a.id) && (
                                <span className="absolute bottom-2 left-2 text-[10px] text-green-600 bg-green-50 px-1 rounded flex items-center gap-0.5">
                                  <Check size={10} /> 已缓存
                                </span>
                              )}
                            </button>
                          )
                        })}
                      </div>
                      {/* 分页 */}
                      <div className="flex items-center justify-center gap-3 pt-1 text-sm text-accent-500">
                        <button disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="disabled:opacity-40">上一页</button>
                        <span>{page} / {totalPages}（共 {total}）</span>
                        <button disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))} className="disabled:opacity-40">下一页</button>
                      </div>
                    </>
                  )}
            </main>
          </div>
        )}

      {/* 弹窗 */}
      {showUpload && (
        <UploadModal
          folders={sortedFolders}
          tags={tags}
          onClose={() => setShowUpload(false)}
          onSubmit={handleUpload}
        />
      )}
      {showFolder && (
        <FolderModal folders={sortedFolders} onClose={() => setShowFolder(false)} onSubmit={handleCreateFolder} />
      )}
      {showTag && (
        <TagModal onClose={() => setShowTag(false)} onSubmit={handleCreateTag} />
      )}
      {selected && (
        <DetailDrawer
          asset={selected}
          spaceId={spaceId}
          onClose={() => setSelected(null)}
          onChanged={reloadAll}
          onDelete={handleDeleteAsset}
          onCacheChanged={() => listCached().then(setCachedIds).catch(() => {})}
        />
      )}

      {/* 分类自定义映射规则 */}
      {ruleModal && (
        <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={() => setRuleModal(false)}>
          <div className="w-full max-w-lg bg-panel-200 rounded-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-accent-200">
              <h2 className="text-base font-semibold text-accent-800">分类规则（自定义映射）</h2>
              <button onClick={() => setRuleModal(false)} className="p-1 text-accent-500"><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs text-accent-400">
                规则优先级高于内置分类引擎；命中即采用其目标分类。修改后点击「重新分类」对本空间全部资产生效。
              </p>

              {/* 导出 / 导入（备份 / 迁移） */}
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-gray-500 whitespace-nowrap">导入方式</span>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 text-xs flex-1">
                  <button
                    onClick={() => setImportMode('cover')}
                    className={`flex-1 px-2 py-1 rounded-md transition-colors ${importMode === 'cover' ? 'bg-white text-primary-600 shadow-sm font-medium' : 'text-gray-500'}`}
                  >覆盖（替换全部）</button>
                  <button
                    onClick={() => setImportMode('merge')}
                    className={`flex-1 px-2 py-1 rounded-md transition-colors ${importMode === 'merge' ? 'bg-white text-primary-600 shadow-sm font-medium' : 'text-gray-500'}`}
                  >合并（增量去重）</button>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={handleExportRules}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-panel-300 text-accent-700 text-sm border border-accent-200 hover:border-primary-400"
                >⬇ 导出规则</button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-panel-300 text-accent-700 text-sm border border-accent-200 hover:border-primary-400"
                >⬆ 导入规则</button>
                <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleImportFile} />
              </div>

              {/* 新建表单 */}
              <div className="grid grid-cols-2 gap-2">
                <select
                  value={ruleForm.matchType}
                  onChange={(e) => setRuleForm((f) => ({ ...f, matchType: e.target.value as CategoryRuleMatchType }))}
                  className="px-2 py-2 rounded-xl bg-panel-300 text-sm border border-accent-200 outline-none"
                >
                  <option value="extension">扩展名 =</option>
                  <option value="nameContains">文件名包含</option>
                  <option value="mimeStartsWith">MIME 前缀</option>
                </select>
                <input
                  value={ruleForm.pattern}
                  onChange={(e) => setRuleForm((f) => ({ ...f, pattern: e.target.value }))}
                  placeholder={ruleForm.matchType === 'extension' ? '例如 pdf' : ruleForm.matchType === 'nameContains' ? '例如 发票' : '例如 image/'}
                  className="px-2 py-2 rounded-xl bg-panel-300 text-sm border border-accent-200 outline-none"
                />
                <select
                  value={ruleForm.targetCategory}
                  onChange={(e) => setRuleForm((f) => ({ ...f, targetCategory: e.target.value }))}
                  className="px-2 py-2 rounded-xl bg-panel-300 text-sm border border-accent-200 outline-none"
                >
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min={0} max={999}
                    value={ruleForm.priority}
                    onChange={(e) => setRuleForm((f) => ({ ...f, priority: Number(e.target.value) }))}
                    className="w-20 px-2 py-2 rounded-xl bg-panel-300 text-sm border border-accent-200 outline-none"
                    title="优先级（越大越优先）"
                  />
                  <button
                    onClick={createRule}
                    className="flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-primary-500 text-white text-sm"
                  ><Check size={15} /> 添加规则</button>
                </div>
              </div>

              {/* 规则列表 */}
              <div className="space-y-2">
                {rules.length === 0 && <div className="text-xs text-accent-400 py-2">暂无自定义规则，将使用内置分类口径。</div>}
                {rules.map((r) => {
                  const meta = CATEGORY_META[r.targetCategory] || CATEGORY_META['其他']
                  return (
                    <div key={r.id} className="flex items-center gap-2 bg-panel-300 rounded-xl p-2">
                      <span className="text-xs px-2 py-0.5 rounded bg-panel-200 text-accent-500">
                        {r.matchType === 'extension' ? '扩展名' : r.matchType === 'nameContains' ? '含' : 'MIME'}
                      </span>
                      <code className="text-xs text-accent-700">{r.pattern}</code>
                      <span className="text-accent-400">→</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{r.targetCategory}</span>
                      {!r.enabled && <span className="text-[10px] text-accent-300">已停用</span>}
                      <span className="text-[10px] text-accent-300 ml-1">P{r.priority}</span>
                      <button onClick={() => removeRule(r.id)} className="ml-auto text-accent-300 hover:text-red-500"><Trash2 size={14} /></button>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={runReclassify}
                disabled={reclassifying}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 rounded-xl bg-panel-300 text-accent-700 text-sm border border-accent-200 disabled:opacity-40"
              ><RefreshCw size={15} className={reclassifying ? 'animate-spin' : ''} /> 重新分类（应用全部规则）</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ===== 文件夹节点 =====
function FolderNode({ label, active, depth, icon, count, onClick }: { label: string; active: boolean; depth: number; icon?: React.ReactNode; count?: number; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 12 }}
      className={`w-full flex items-center gap-1 py-1 px-1 rounded-lg text-left text-sm ${active ? 'bg-primary-100 text-primary-600 font-medium' : 'text-accent-700 hover:bg-panel-200'}`}
    >
      {icon || <ChevronRight size={12} className="text-accent-300" />}
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && <span className="text-[10px] text-accent-400">{count}</span>}
    </button>
  )
}

// ===== 上传弹窗 =====
function UploadModal({ folders, tags, onClose, onSubmit }: {
  folders: Folder[]; tags: TagItem[]; onClose: () => void
  onSubmit: (p: { base64: string; name: string; mime: string; folderId: string | null; tags: string[]; description: string }) => void
}) {
  const toast = useToast((s) => s.show)
  const [file, setFile] = useState<File | null>(null)
  const [folderId, setFolderId] = useState<string>('')
  const [desc, setDesc] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [busy, setBusy] = useState(false)

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) setFile(f)
  }
  const submit = async () => {
    if (!file) { toast('请选择文件', 'error'); return }
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      // 分块转换，避免大文件 String.fromCharCode(...spread) 栈溢出
      let bin = ''
      const CHUNK = 0x8000
      for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[])
      }
      const base64 = btoa(bin)
      await onSubmit({
        base64,
        name: file.name,
        mime: file.type || 'application/octet-stream',
        folderId: folderId || null,
        description: desc,
        tags: tagInput.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean),
      })
    } catch (e: any) { toast(e?.message || '上传失败', 'error') } finally { setBusy(false) }
  }

  return (
    <ModalShell title="上传资产" onClose={onClose}>
      <label className="block border-2 border-dashed border-accent-200 rounded-xl p-6 text-center cursor-pointer hover:border-primary-400">
        <input type="file" onChange={pick} className="hidden" />
        <Upload size={28} className="mx-auto text-accent-400" />
        <div className="mt-2 text-sm text-accent-600">{file ? file.name : '点击选择文件（自动转 base64 上传）'}</div>
      </label>
      <Field label="保存到文件夹">
        <select value={folderId} onChange={(e) => setFolderId(e.target.value)} className="input">
          <option value="">根目录</option>
          {folders.map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </Field>
      <Field label="标签（逗号分隔）">
        <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="如：合同, 重要" className="input" />
        <div className="mt-1 flex gap-1 flex-wrap">
          {tags.map((t) => <span key={t.id} className="text-[10px] text-accent-500">#{t.name}</span>)}
        </div>
      </Field>
      <Field label="描述">
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="input" placeholder="可选" />
      </Field>
      <button onClick={submit} disabled={busy} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium disabled:opacity-50">
        {busy ? '上传中…' : '上传'}
      </button>
    </ModalShell>
  )
}

// ===== 新建文件夹弹窗 =====
function FolderModal({ folders, onClose, onSubmit }: { folders: Folder[]; onClose: () => void; onSubmit: (name: string, parentId: string | null) => void }) {
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<string>('')
  const submit = () => {
    if (!name.trim()) return
    onSubmit(name.trim(), parentId || null)
  }
  return (
    <ModalShell title="新建文件夹" onClose={onClose}>
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="文件夹名称" /></Field>
      <Field label="父目录">
        <select value={parentId} onChange={(e) => setParentId(e.target.value)} className="input">
          <option value="">根目录</option>
          {[...folders].sort((a, b) => a.path.localeCompare(b.path)).map((f) => <option key={f.id} value={f.id}>{f.path}</option>)}
        </select>
      </Field>
      <button onClick={submit} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium">创建</button>
    </ModalShell>
  )
}

// ===== 新建标签弹窗 =====
function TagModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (name: string) => void }) {
  const [name, setName] = useState('')
  const submit = () => { if (name.trim()) onSubmit(name.trim()) }
  return (
    <ModalShell title="新建标签" onClose={onClose}>
      <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" placeholder="标签名（空间内唯一）" /></Field>
      <button onClick={submit} className="w-full py-2.5 rounded-xl bg-primary-500 text-white font-medium">保存</button>
    </ModalShell>
  )
}

// ===== 资产详情抽屉 =====
function DetailDrawer({ asset, spaceId, onClose, onChanged, onDelete, onCacheChanged }: {
  asset: Asset; spaceId: string; onClose: () => void; onChanged: () => void; onDelete: (a: Asset) => void
  onCacheChanged?: () => void
}) {
  const toast = useToast((s) => s.show)
  const [versions, setVersions] = useState<Version[]>([])
  const [meta, setMeta] = useState(() => {
    try { return JSON.parse(asset.metadata || '{}') } catch { return {} as any }
  })
  const [desc, setDesc] = useState(meta.description || '')
  const [name, setName] = useState(asset.name)
  const [tab, setTab] = useState<'info' | 'versions' | 'share'>('info')
  const [share, setShare] = useState<ShareResult | null>(null)
  const [sharePwd, setSharePwd] = useState('')
  const [sharePerm, setSharePerm] = useState<'view' | 'download'>('download')
  const [busy, setBusy] = useState(false)
  const [cached, setCached] = useState(false)
  const [caching, setCaching] = useState(false)

  // 抽屉打开时检查本地是否已缓存，决定「离线可用」提示
  useEffect(() => {
    getCached(asset.id).then(setCached).catch(() => setCached(false))
  }, [asset.id])

  const fetchOnline = async (): Promise<Blob> => {
    const resp = await api.get(`/assets/${asset.id}/file`, { responseType: 'blob' })
    return resp.data as Blob
  }

  const loadVersions = useCallback(() => {
    unwrap<Version[]>(api.get(`/assets/${asset.id}/versions`)).then(setVersions).catch(() => {})
  }, [asset.id])
  useEffect(() => { loadVersions() }, [loadVersions])

  // 离线优先下载：本地已缓存则直接读取本地副本（断网可用），否则在线下载并自动缓存供离线使用
  const download = async () => {
    try {
      let blob: Blob | null = null
      if (await getCached(asset.id)) {
        blob = await readCached(asset.id)
      }
      if (!blob) {
        blob = await fetchOnline()
        // 下载成功后自动缓存，下次断网也能用
        cacheAsset(asset.id, asset.name, blob).then(() => {
          setCached(true)
          onCacheChanged?.()
        }).catch(() => {})
      } else {
        toast('已从本机缓存打开（离线可用）', 'success')
      }
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = asset.name; a.click()
      URL.revokeObjectURL(url)
    } catch (e: any) { toast(e?.message || '下载失败', 'error') }
  }
  // 显式把单个文件缓存到本机（桌面端写磁盘 / 浏览器写 IndexedDB）
  const cacheOne = async () => {
    setCaching(true)
    try {
      const blob = await fetchOnline()
      await cacheAsset(asset.id, asset.name, blob)
      setCached(true)
      onCacheChanged?.()
      toast(`已缓存到本机${isDesktop() ? '（磁盘）' : '（本机）'}`, 'success')
    } catch (e: any) { toast(e?.message || '缓存失败', 'error') } finally { setCaching(false) }
  }
  const restore = async (vid: string) => {
    try {
      await unwrap(api.post(`/assets/${asset.id}/versions/${vid}/restore`))
      toast('已恢复到该版本', 'success'); loadVersions(); onChanged()
    } catch (e: any) { toast(e?.message || '恢复失败', 'error') }
  }
  const saveMeta = async () => {
    setBusy(true)
    try {
      await unwrap(api.patch(`/assets/${asset.id}`, { name: name.trim() || asset.name, description: desc }))
      toast('已保存', 'success'); onChanged()
    } catch (e: any) { toast(e?.message || '保存失败', 'error') } finally { setBusy(false) }
  }
  const createShare = async () => {
    setBusy(true)
    try {
      const r = await unwrap<ShareResult>(api.post(`/assets/${asset.id}/share`, {
        permission: sharePerm,
        password: sharePwd || undefined,
        expireAt: new Date(Date.now() + 7 * 86400000).toISOString(),
      }))
      setShare(r); toast('分享链接已创建', 'success')
    } catch (e: any) { toast(e?.message || '创建失败', 'error') } finally { setBusy(false) }
  }

  const meta2 = TYPE_META[asset.type] || { label: asset.type }
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const shareUrl = share ? `${origin}/api/v1/share/${share.token}` : ''
  const shareFileUrl = share ? `${origin}/api/v1/share/${share.token}/file${sharePwd ? '?password=' + encodeURIComponent(sharePwd) : ''}` : ''

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-panel-200 h-full overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-accent-200">
          <h2 className="text-base font-semibold text-accent-800 truncate">{asset.name}</h2>
          <button onClick={onClose} className="p-1 text-accent-500"><X size={20} /></button>
        </div>

        {/* tabs */}
        <div className="flex border-b border-accent-200 text-sm">
          {([['info', '信息'], ['versions', '版本'], ['share', '分享']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? 'text-primary-500 font-medium border-b-2 border-primary-500' : 'text-accent-500'}`}>{l}</button>
          ))}
        </div>

        <div className="p-4 space-y-4">
          {tab === 'info' && (
            <>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <Info label="类型" value={meta2.label} />
                <Info label="大小" value={fmtSize(asset.size)} />
                <Info label="智能分类" value={asset.category || '其他'} />
                <Info label="创建时间" value={formatDateTime(asset.createdAt)} />
                <Info label="标签" value={asset.tags.map((t) => '#' + t.tag.name).join(' ') || '—'} />
              </div>
              <button onClick={download} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-500 text-white font-medium"><Download size={18} /> 下载原文件</button>
              {cached ? (
                <div className="flex items-center justify-center gap-1 text-xs text-green-600"><Check size={14} /> 已缓存到本机，断网可用</div>
              ) : (
                <button onClick={cacheOne} disabled={caching} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-panel-300 text-accent-700 text-sm border border-accent-200 font-medium disabled:opacity-50">
                  <RefreshCw size={16} /> {caching ? '缓存中…' : '缓存到本机（离线可用）'}
                </button>
              )}
              <Field label="名称"><input value={name} onChange={(e) => setName(e.target.value)} className="input" /></Field>
              <Field label="描述">
                <textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={3} className="input" />
              </Field>
              <button onClick={saveMeta} disabled={busy} className="w-full py-2.5 rounded-xl bg-accent-700 text-white font-medium disabled:opacity-50">保存修改</button>
              <button onClick={() => onDelete(asset)} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-red-200 text-red-500 font-medium"><Trash2 size={18} /> 删除资产</button>
            </>
          )}

          {tab === 'versions' && (
            <div className="space-y-2">
              {versions.length === 0 && <EmptyState text="暂无版本" />}
              {versions.map((v, i) => (
                <div key={v.id} className="flex items-center gap-3 bg-panel-300 rounded-xl p-3">
                  <History size={18} className="text-accent-400" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-accent-800 truncate">{v.note || ('版本 ' + (versions.length - i))}</div>
                    <div className="text-[11px] text-accent-400">{fmtSize(v.size)} · {formatDateTime(v.createdAt)}</div>
                  </div>
                  <button onClick={() => restore(v.id)} className="text-xs text-primary-500 flex items-center gap-1"><RefreshCw size={14} /> 恢复</button>
                </div>
              ))}
            </div>
          )}

          {tab === 'share' && (
            <div className="space-y-4">
              <div className="flex gap-2">
                <select value={sharePerm} onChange={(e) => setSharePerm(e.target.value as any)} className="input flex-1">
                  <option value="download">允许下载</option>
                  <option value="view">仅预览</option>
                </select>
                <input value={sharePwd} onChange={(e) => setSharePwd(e.target.value)} placeholder="访问密码（可选）" className="input flex-1" />
              </div>
              <button onClick={createShare} disabled={busy} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary-500 text-white font-medium disabled:opacity-50"><Share2 size={18} /> {share ? '重新生成链接' : '创建分享链接'}</button>

              {share && (
                <div className="bg-panel-300 rounded-xl p-3 space-y-2">
                  <div className="text-xs text-accent-500">公开访问链接（无需登录）</div>
                  <CopyRow label="分享页" value={shareUrl} />
                  <CopyRow label="直接下载" value={shareFileUrl} />
                  {sharePwd && <div className="text-xs text-amber-600">访问密码：{sharePwd}（7 天后过期）</div>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ===== 小组件 =====
function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="w-full max-w-md bg-panel-200 rounded-t-2xl sm:rounded-2xl p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-accent-800">{title}</h2>
          <button onClick={onClose} className="p-1 text-accent-500"><X size={20} /></button>
        </div>
        {children}
      </div>
    </div>
  )
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-accent-500 mb-1">{label}</div>
      {children}
    </div>
  )
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel-300 rounded-xl p-2">
      <div className="text-[11px] text-accent-400">{label}</div>
      <div className="text-sm text-accent-800 truncate">{value}</div>
    </div>
  )
}
function CopyRow({ label, value }: { label: string; value: string }) {
  const toast = useToast((s) => s.show)
  const copy = () => { navigator.clipboard?.writeText(value); toast('已复制', 'success') }
  return (
    <div>
      <div className="text-[11px] text-accent-500 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <input readOnly value={value} className="input flex-1 text-[11px]" />
        <button onClick={copy} className="shrink-0 p-2 rounded-lg bg-primary-100 text-primary-600"><Check size={16} /></button>
      </div>
    </div>
  )
}

// 近 30 天新增资产趋势（纯 SVG 折线，无外部依赖）
function TrendChart({ data }: { data: { date: string; count: number }[] }) {
  const W = 300
  const H = 56
  const max = Math.max(1, ...data.map((d) => d.count))
  const step = data.length > 1 ? W / (data.length - 1) : W
  const pts = data.map((d, i) => {
    const x = (i * step).toFixed(1)
    const y = (H - 4 - (d.count / max) * (H - 12)).toFixed(1)
    return `${x},${y}`
  })
  const line = pts.join(' ')
  const area = `0,${H} ${line} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-14" preserveAspectRatio="none">
      <polygon points={area} fill="#6366f1" opacity={0.12} />
      <polyline points={line} fill="none" stroke="#6366f1" strokeWidth={1.5} />
    </svg>
  )
}
