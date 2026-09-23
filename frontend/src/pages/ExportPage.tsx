import { useState, useEffect } from 'react'
import { Download, FileText, FileJson, Check, Loader2, Archive } from 'lucide-react'
import { getExportModules, exportModuleCSV, exportModuleJSON, exportAllJSON, type ExportModule } from '../lib/api'
import { useToast } from '../components/Toast'

/**
 * 数据导出页面
 *
 * 支持将用户数据导出为 CSV 或 JSON 格式：
 * - 单模块导出：选择模块 + 格式 → 下载文件
 * - 全量导出：一键导出所有模块为 JSON
 */

type Format = 'csv' | 'json'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

const MODULE_ICONS: Record<string, typeof FileText> = {
  tasks: FileText,
  bills: Archive,
  diets: FileText,
  sleeps: FileText,
  reminders: FileText,
  handovers: FileText,
  fragments: FileText,
  countdowns: FileText,
}

export default function ExportPage() {
  const { show: toast } = useToast()
  const [modules, setModules] = useState<ExportModule[]>([])
  const [format, setFormat] = useState<Format>('csv')
  const [exporting, setExporting] = useState<string | null>(null)
  const [exportedModule, setExportedModule] = useState<string | null>(null)

  useEffect(() => {
    getExportModules()
      .then((res) => setModules(res.modules))
      .catch(() => toast('加载模块列表失败', 'error'))
  }, [toast])

  const handleExportModule = async (module: ExportModule) => {
    setExporting(module.key)
    setExportedModule(null)
    try {
      if (format === 'csv') {
        const blob = await exportModuleCSV(module.key)
        downloadBlob(blob, `${module.key}_${formatDate(new Date())}.csv`)
      } else {
        const res = await exportModuleJSON(module.key)
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: 'application/json' })
        downloadBlob(blob, `${module.key}_${formatDate(new Date())}.json`)
      }
      setExportedModule(module.key)
      toast(`${module.label}导出成功`, 'success')
    } catch {
      toast(`${module.label}导出失败`, 'error')
    } finally {
      setExporting(null)
    }
  }

  const handleExportAll = async () => {
    setExporting('all')
    try {
      const res = await exportAllJSON()
      const blob = new Blob([JSON.stringify(res, null, 2)], { type: 'application/json' })
      downloadBlob(blob, `aie_export_all_${formatDate(new Date())}.json`)
      toast(`全量导出成功（${res.total} 条记录）`, 'success')
    } catch {
      toast('全量导出失败', 'error')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      {/* 格式选择 */}
      <div>
        <h2 className="text-lg font-semibold text-accent-800 mb-3">导出格式</h2>
        <div className="flex gap-3">
          <button
            onClick={() => setFormat('csv')}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all ${
              format === 'csv'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-accent-200 bg-white text-accent-500 hover:border-accent-300'
            }`}
          >
            <FileJson size={20} />
            <div className="text-left">
              <div className="text-[14px] font-medium">CSV</div>
              <div className="text-[11px] opacity-70">Excel 可直接打开</div>
            </div>
          </button>
          <button
            onClick={() => setFormat('json')}
            className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border transition-all ${
              format === 'json'
                ? 'border-primary-300 bg-primary-50 text-primary-700'
                : 'border-accent-200 bg-white text-accent-500 hover:border-accent-300'
            }`}
          >
            <FileText size={20} />
            <div className="text-left">
              <div className="text-[14px] font-medium">JSON</div>
              <div className="text-[11px] opacity-70">结构化数据</div>
            </div>
          </button>
        </div>
      </div>

      {/* 模块列表 */}
      <div>
        <h2 className="text-lg font-semibold text-accent-800 mb-3">选择导出内容</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {modules.map((m) => {
            const Icon = MODULE_ICONS[m.key] || FileText
            const isExporting = exporting === m.key
            const isExported = exportedModule === m.key
            return (
              <div
                key={m.key}
                className="flex items-center gap-3 p-4 rounded-xl border border-accent-200 bg-white hover:border-accent-300 transition-colors"
              >
                <div className="w-10 h-10 rounded-lg bg-accent-50 flex items-center justify-center text-accent-500 shrink-0">
                  <Icon size={18} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-medium text-accent-700">{m.label}</div>
                  <div className="text-[12px] text-accent-400 truncate">{m.description}</div>
                </div>
                <button
                  onClick={() => handleExportModule(m)}
                  disabled={isExporting}
                  className={`shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all flex items-center gap-1.5 ${
                    isExported
                      ? 'bg-green-50 text-green-600'
                      : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
                  } disabled:opacity-50`}
                >
                  {isExporting ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : isExported ? (
                    <Check size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {isExporting ? '导出中' : isExported ? '已导出' : '导出'}
                </button>
              </div>
            )
          })}
        </div>
      </div>

      {/* 全量导出 */}
      <div className="p-5 rounded-xl border border-primary-200 bg-primary-50/50">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 flex items-center justify-center text-primary-600 shrink-0">
            <Archive size={20} />
          </div>
          <div className="flex-1">
            <div className="text-[14px] font-medium text-primary-700">全量导出（JSON）</div>
            <div className="text-[12px] text-primary-500">一键导出所有模块数据为单个 JSON 文件</div>
          </div>
          <button
            onClick={handleExportAll}
            disabled={exporting === 'all'}
            className="shrink-0 px-4 py-2 rounded-lg text-[13px] font-medium bg-primary-500 text-white hover:bg-primary-600 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {exporting === 'all' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Download size={14} />
            )}
            {exporting === 'all' ? '导出中' : '导出全部'}
          </button>
        </div>
      </div>

      {/* 说明 */}
      <div className="p-4 rounded-lg bg-accent-50 text-[12px] text-accent-400 leading-relaxed">
        <p>· CSV 格式适合用 Excel、WPS 等表格软件打开查看</p>
        <p>· JSON 格式保留完整数据结构，适合程序化处理或备份恢复</p>
        <p>· 导出的数据仅包含当前账号的内容，不含社区帖子等公开数据</p>
      </div>
    </div>
  )
}
