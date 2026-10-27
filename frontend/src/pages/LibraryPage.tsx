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

import {
  TYPE_META, CATEGORY_META, CATEGORIES, PAGE_SIZE, TYPES, fmtSize,
  FolderNode, UploadModal, FolderModal, TagModal, DetailDrawer,
  CategoryStatsPanel, CategoryRuleModal,
  type Folder, type TagItem, type Asset, type Space,
} from '../components/library/LibraryWidgets'

// ===== 以下常量/类型/组件已搬到 components/library/LibraryWidgets.tsx =====

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

              {/* 分类统计看板 */}
              <CategoryStatsPanel
                stats={stats} categoryFilter={categoryFilter}
                onFilterCategory={(c) => { setCategoryFilter(c); setPage(1) }}
                onOpenRules={openRuleModal}
                onReclassify={runReclassify}
                reclassifying={reclassifying}
              />

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
      <CategoryRuleModal
        open={ruleModal} onClose={() => setRuleModal(false)}
        rules={rules} ruleForm={ruleForm} importMode={importMode}
        reclassifying={reclassifying}
        setRuleForm={setRuleForm} setImportMode={setImportMode}
        onExport={handleExportRules} onImportFile={handleImportFile}
        onCreateRule={createRule} onRemoveRule={removeRule}
        onRunReclassify={runReclassify}
        fileInputRef={fileInputRef}
      />
    </div>
  )
}

// ===== 以下组件已搬到 components/library/LibraryWidgets.tsx =====
