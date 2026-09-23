import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Download, Upload, FileText, Database, Check, Loader2, AlertTriangle, X, ChevronRight,
  Clock, RotateCcw, CalendarDays, Trash2,
} from 'lucide-react'
import Header from '../../components/Header'
import { Switch } from '../../components/ui/switch'
import { useToast } from '../../components/Toast'
import { useConfirm } from '../../components/ConfirmDialog'
import {
  exportLocalData, downloadBackup, parseBackup, importLocalData,
  previewBackup, formatBytes, type BackupData,
} from '../../lib/backup'
import {
  loadConfig, saveConfig, runBackupNow, listHistory, removeHistory,
  clearAllHistory, restoreFromHistory, startAutoBackupScheduler,
  cleanupExpired,
  type AutoBackupConfig, type AutoBackupHistoryItem,
  TIME_OPTIONS, RETENTION_OPTIONS, DEFAULT_CONFIG,
} from '../../lib/auto-backup'

/**
 * 数据备份与恢复页（设置子页）
 *
 * - 导出：手动一键导出 JSON
 * - 导入：选择备份文件 → 预览 → 确认恢复
 * - 自动备份（v1.0.2 新增）：定时后台自动备份，历史保留 N 天
 *
 * 技术：
 *   - 配置存 localStorage（aie_auto_backup_*）
 *   - 历史存 IndexedDB（DB: aie-auto-backup, Store: history）
 *   - 调度：startAutoBackupScheduler() 在 App 根部启动，每小时检查一次
 */

// 单例 — 页面首次挂载时启动调度器（幂等）
let _schedulerStarted = false

export default function BackupSettingsPage() {
  const toast = useToast((s) => s.show)
  const confirm = useConfirm()
  const fileRef = useRef<HTMLInputElement>(null)

  // ─── 手动导入导出 ───
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState('')
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState('')
  const [preview, setPreview] = useState<{
    data: BackupData
    info: ReturnType<typeof previewBackup>
    size: number
  } | null>(null)

  // ─── 自动备份（v1.0.2 新增） ───
  const [cfg, setCfg] = useState<AutoBackupConfig>(() => loadConfig())
  const [running, setRunning] = useState(false)
  const [runProgress, setRunProgress] = useState('')
  const [history, setHistory] = useState<AutoBackupHistoryItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)

  // 启动调度器（全局只启一次）
  useEffect(() => {
    if (!_schedulerStarted) {
      startAutoBackupScheduler()
      _schedulerStarted = true
    }
    loadHistory()
  }, [])

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true)
    try {
      const h = await listHistory()
      setHistory(h)
    } catch {
      setHistory([])
    } finally {
      setHistoryLoading(false)
    }
  }, [])

  // ─── Switch 切换（带乐观更新） ───
  const toggleAutoBackup = async () => {
    const newEnabled = !cfg.enabled
    // 乐观
    const prev = cfg
    const next = saveConfig({ enabled: newEnabled })
    setCfg(next)
    toast(newEnabled ? '已开启定时自动备份' : '已关闭定时自动备份', 'success')
    // 实际没有异步操作，乐观就是真的
    void prev
  }

  const changeTime = async (time: string) => {
    const next = saveConfig({ time })
    setCfg(next)
  }

  const changeRetention = async (days: number) => {
    const next = saveConfig({ retentionDays: days })
    setCfg(next)
    // 改完立即清理一次
    await clearExpiredHistory()
  }

  const clearExpiredHistory = useCallback(async () => {
    try {
      await cleanupExpired()
      await loadHistory()
    } catch { /* ignore */ }
  }, [loadHistory])

  // ─── 立即备份 ───
  const handleRunNow = async () => {
    if (running) return
    setRunning(true)
    setRunProgress('准备中…')
    try {
      await runBackupNow((p) => setRunProgress(p.phase))
      toast('自动备份完成', 'success')
      const fresh = saveConfig({ ...loadConfig() }) // 读最新 lastRunAt
      setCfg(fresh)
      await loadHistory()
    } catch (err) {
      toast(`自动备份失败：${(err as Error).message}`, 'error')
      const fresh = saveConfig({ ...loadConfig() })
      setCfg(fresh)
    } finally {
      setRunning(false)
      setRunProgress('')
    }
  }

  // ─── 清除全部历史 ───
  const handleClearAll = async () => {
    if (!history.length) return
    if (!(await confirm({
      title: '清除全部自动备份历史',
      message: `确定要删除全部 ${history.length} 份自动备份历史？`,
      confirmText: '清除',
      danger: true,
    }))) return
    try {
      await clearAllHistory()
      setHistory([])
      toast('已清除全部历史', 'success')
    } catch (err) {
      toast(`清除失败：${(err as Error).message}`, 'error')
    }
  }

  // ─── 删除单份历史 ───
  const handleDeleteOne = async (ts: number) => {
    if (!(await confirm({
      title: '删除这份备份',
      message: '确定要删除这份自动备份历史？',
      confirmText: '删除',
      danger: true,
    }))) return
    try {
      await removeHistory(ts)
      await loadHistory()
      toast('已删除', 'success')
    } catch (err) {
      toast(`删除失败：${(err as Error).message}`, 'error')
    }
  }

  // ─── 从历史恢复 ───
  const handleRestoreFromHistory = async (item: AutoBackupHistoryItem) => {
    if (!item.data) { toast('这份备份的数据已损坏，无法恢复', 'error'); return }
    if (!(await confirm({
      title: '从自动备份恢复',
      message: `将从 ${item.label} 的备份恢复数据，现有数据将被覆盖。继续？`,
      confirmText: '恢复',
      danger: true,
    }))) return
    try {
      await restoreFromHistory(item.ts)
      toast('已恢复，即将刷新…', 'success')
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      toast(`恢复失败：${(err as Error).message}`, 'error')
    }
  }

  // ─── 手动导出 / 导入（原有逻辑不变） ───
  const handleExport = useCallback(async () => {
    setExporting(true)
    setExportProgress('正在收集本地数据…')
    try {
      const backup = await exportLocalData((p) => {
        if (p.phase === 'localStorage') setExportProgress('正在收集设置数据…')
        else if (p.phase === 'indexedDB') setExportProgress(`正在读取小说文件… (${p.current}/${p.total})`)
        else if (p.phase === 'serialize') setExportProgress('正在生成备份文件…')
      })
      const json = JSON.stringify(backup)
      const size = new Blob([json]).size
      downloadBackup(backup)
      const info = previewBackup(backup)
      toast(`备份已导出（${info.bookCount} 本书，${info.localStorageKeys.length} 项设置，${formatBytes(size)}）`, 'success')
    } catch (err) {
      toast(`导出失败：${(err as Error).message}`, 'error')
    } finally {
      setExporting(false)
      setExportProgress('')
    }
  }, [toast])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    if (file.size > 200 * 1024 * 1024) {
      toast('备份文件过大（>200MB），请检查是否选错文件', 'error')
      return
    }
    try {
      const text = await file.text()
      const data = parseBackup(text)
      const info = previewBackup(data)
      setPreview({ data, info, size: file.size })
    } catch (err) {
      toast(`文件解析失败：${(err as Error).message}`, 'error')
    }
  }, [toast])

  const handleImport = useCallback(async () => {
    if (!preview) return
    const ok = await confirm({
      title: '恢复备份数据',
      message: `将恢复 ${preview.info.localStorageKeys.length} 项设置和 ${preview.info.bookCount} 本小说文件。现有同名数据将被覆盖，确认继续？`,
      confirmText: '恢复',
      danger: true,
    })
    if (!ok) return
    setImporting(true)
    setImportProgress('正在恢复设置数据…')
    try {
      const result = await importLocalData(preview.data, (p) => {
        if (p.phase === 'localStorage') setImportProgress('正在恢复设置数据…')
        else if (p.phase === 'indexedDB') setImportProgress(`正在恢复小说文件… (${p.current}/${p.total})`)
      })
      toast(`已恢复 ${result.localStorageKeys} 项设置和 ${result.indexedDBEntries} 本小说文件`, 'success')
      setPreview(null)
      setTimeout(() => window.location.reload(), 1500)
    } catch (err) {
      toast(`恢复失败：${(err as Error).message}`, 'error')
    } finally {
      setImporting(false)
      setImportProgress('')
    }
  }, [preview, confirm, toast])

  // ─── UI ───
  const [autoLabelId, autoDescId] = [`autobak-label-${cfg.enabled}`, `autobak-desc-${cfg.enabled}`]

  return (
    <div className="app-shell pb-6">
      <Header title="数据备份" />

      <div className="px-3 py-4 space-y-4">

        {/* ════════════════════════════════
           自动备份（v1.0.2 新增）
           ════════════════════════════════ */}
        <section className="card space-y-4">
          {/* 总开关 */}
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Clock size={20} className="text-primary-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div id={autoLabelId} className="text-sm font-medium text-gray-800">定时自动备份</div>
              <div className="text-xs text-gray-400 mt-0.5">
                {cfg.enabled
                  ? `已开启 · 每天 ${cfg.time} 自动备份`
                  : '关闭时不会自动备份，需要手动导出'}
              </div>
              {cfg.lastRunAt && (
                <div className="text-[11px] text-gray-300 mt-1">
                  上次运行：{new Date(cfg.lastRunAt).toLocaleString('zh-CN', { hour12: false })}
                  {cfg.lastStatus === 'success' && <span className="text-emerald-500 ml-1">✓ 成功</span>}
                  {cfg.lastStatus === 'fail' && <span className="text-red-500 ml-1">✗ 失败：{cfg.lastError?.slice(0, 30)}</span>}
                </div>
              )}
            </div>
            <Switch
              checked={cfg.enabled}
              onChange={toggleAutoBackup}
              aria-labelledby={autoLabelId}
              aria-describedby={autoDescId}
              testId="auto-backup-switch"
            />
          </div>

          <p id={autoDescId} className="text-xs text-gray-400 leading-relaxed">
            开启后电脑每天定时自动备份到本地（不联网不上传），自动保留最近 N 份历史。备份数据和手动导出的内容相同。
          </p>

          {/* 时间 / 保留天数 / 立即备份 — 开启时显示 */}
          {cfg.enabled && (
            <div className="pt-3 border-t border-gray-100 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {/* 时间选择 */}
                <label className="text-xs text-gray-500 block">
                  备份时间
                  <select
                    value={cfg.time}
                    onChange={(e) => changeTime(e.target.value)}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none bg-white"
                    aria-label="自动备份时间"
                  >
                    {TIME_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>

                {/* 保留天数 */}
                <label className="text-xs text-gray-500 block">
                  保留最近
                  <select
                    value={cfg.retentionDays}
                    onChange={(e) => changeRetention(parseInt(e.target.value, 10))}
                    className="mt-1 w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-primary-400 focus:outline-none bg-white"
                    aria-label="自动备份保留天数"
                  >
                    {RETENTION_OPTIONS.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              {/* 立即备份按钮 */}
              <button
                onClick={handleRunNow}
                disabled={running}
                className="btn-primary w-full disabled:opacity-50"
              >
                {running ? (
                  <><Loader2 size={16} className="animate-spin mr-2" /> {runProgress || '备份中…'}</>
                ) : (
                  <><RotateCcw size={16} className="mr-2" /> 立即备份一次（测试用）</>
                )}
              </button>
            </div>
          )}
        </section>

        {/* 自动备份历史 */}
        {cfg.enabled && (
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CalendarDays size={16} className="text-gray-400" />
                <span className="text-sm font-medium text-gray-700">自动备份历史</span>
                {historyLoading && <Loader2 size={12} className="animate-spin text-gray-400" />}
              </div>
              {history.length > 0 && (
                <button
                  onClick={handleClearAll}
                  className="text-xs text-red-500 hover:text-red-600 flex items-center gap-1"
                >
                  <Trash2 size={12} /> 清空
                </button>
              )}
            </div>

            {historyLoading ? (
              <div className="text-xs text-gray-400 text-center py-4">加载中…</div>
            ) : history.length === 0 ? (
              <div className="text-xs text-gray-400 text-center py-4">暂无自动备份历史</div>
            ) : (
              <div className="space-y-2">
                {history.map(item => (
                  <div
                    key={item.ts}
                    className="flex items-center gap-3 text-xs bg-gray-50 rounded-lg px-3 py-2"
                  >
                    <span className={item.status === 'success' ? 'text-emerald-500' : 'text-red-500'}>
                      {item.status === 'success' ? '✓' : '✗'}
                    </span>
                    <span className="text-gray-600 font-mono flex-1 truncate">
                      {item.label}
                    </span>
                    {item.status === 'success' && item.size > 0 && (
                      <span className="text-gray-400">{formatBytes(item.size)}</span>
                    )}
                    {item.status === 'fail' && (
                      <span className="text-red-400 truncate max-w-[120px]">{item.error}</span>
                    )}
                    {item.status === 'success' && item.data && (
                      <button
                        onClick={() => handleRestoreFromHistory(item)}
                        className="text-primary-600 hover:text-primary-700"
                        title="从这份备份恢复"
                      >
                        <Upload size={13} />
                      </button>
                    )}
                    <button
                      onClick={() => handleDeleteOne(item.ts)}
                      className="text-gray-300 hover:text-red-500"
                      title="删除这份历史"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {/* ════════════════════════════════
           手动导出（原有，保持不变）
           ════════════════════════════════ */}
        <section className="card">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Download size={20} className="text-primary-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800">手动导出</div>
              <div className="text-xs text-gray-400 mt-0.5">
                导出后请手动保存到安全位置（U 盘 / 云盘）
              </div>
            </div>
          </div>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="btn-primary w-full disabled:opacity-50"
          >
            {exporting ? (
              <><Loader2 size={16} className="animate-spin mr-2" /> {exportProgress || '导出中…'}</>
            ) : (
              <><Download size={16} className="mr-2" /> 导出备份</>
            )}
          </button>
        </section>

        {/* ════════════════════════════════
           手动导入（原有，保持不变）
           ════════════════════════════════ */}
        <section className="card">
          <div className="flex items-start gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center flex-shrink-0">
              <Upload size={20} className="text-amber-600" />
            </div>
            <div className="flex-1">
              <div className="text-sm font-medium text-gray-800">恢复备份</div>
              <div className="text-xs text-gray-400 mt-0.5">
                从文件或自动备份历史恢复
              </div>
            </div>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            onChange={handleFileSelect}
            className="hidden"
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            className="btn-secondary w-full disabled:opacity-50"
          >
            {importing ? (
              <><Loader2 size={16} className="animate-spin mr-2" /> {importProgress || '恢复中…'}</>
            ) : (
              <><Upload size={16} className="mr-2" /> 选择备份文件</>
            )}
          </button>
        </section>

        {/* 说明 */}
        <section className="card-soft">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="text-xs text-gray-500 space-y-1">
              <p>· 自动备份和手动导出的内容相同：本地设置 + 小说文件，不含账号密码</p>
              <p>· 自动备份存在本地 IndexedDB（不上传），保留最近 N 天</p>
              <p>· App 托盘关闭后调度器停止运行（Windows 托盘不影响）</p>
              <p>· 建议定期手动导出到 U 盘作为冷备</p>
            </div>
          </div>
        </section>
      </div>

      {/* 预览弹窗（原有，保持不变） */}
      {preview && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => !importing && setPreview(null)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="relative w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <span className="font-semibold text-sm flex items-center gap-2">
                <FileText size={16} className="text-primary-500" /> 备份预览
              </span>
              <button onClick={() => !importing && setPreview(null)} className="p-1 rounded hover:bg-gray-100 disabled:opacity-50" disabled={importing}>
                <X size={16} />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-xs text-gray-400 mb-0.5">备份时间</div>
                  <div className="text-gray-800 font-medium">{preview.info.date}</div>
                </div>
                <div className="rounded-lg bg-gray-50 p-3">
                  <div className="text-xs text-gray-400 mb-0.5">文件大小</div>
                  <div className="text-gray-800 font-medium">{formatBytes(preview.size)}</div>
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                  <Database size={14} className="text-primary-500" /> 本地设置
                  <span className="text-xs text-gray-400 font-normal">（{preview.info.localStorageKeys.length} 项）</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {preview.info.localStorageKeys.slice(0, 12).map((k) => (
                    <span key={k} className="badge bg-gray-100 text-gray-600 text-[10px]">{k}</span>
                  ))}
                  {preview.info.localStorageKeys.length > 12 && (
                    <span className="badge bg-gray-100 text-gray-400 text-[10px]">+{preview.info.localStorageKeys.length - 12}</span>
                  )}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-2">
                  <FileText size={14} className="text-amber-500" /> 小说文件
                  <span className="text-xs text-gray-400 font-normal">（{preview.info.bookCount} 本）</span>
                </div>
                {preview.info.bookCount === 0 ? (
                  <div className="text-xs text-gray-400">无小说文件</div>
                ) : (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {preview.info.bookTitles.slice(0, 20).map((t, i) => (
                      <div key={i} className="text-xs text-gray-600 flex items-center gap-1">
                        <Check size={11} className="text-emerald-500 shrink-0" />
                        <span className="truncate">{t}</span>
                      </div>
                    ))}
                    {preview.info.bookTitles.length > 20 && (
                      <div className="text-xs text-gray-400">+{preview.info.bookTitles.length - 20} 本…</div>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
              <button onClick={() => setPreview(null)} disabled={importing} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={handleImport} disabled={importing} className="flex-1 py-2.5 text-sm rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 flex items-center justify-center gap-1">
                {importing ? (<><Loader2 size={14} className="animate-spin" /> {importProgress || '恢复中…'}</>) : (<><Check size={14} /> 确认恢复</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
