import { useState } from 'react'
import { ChevronRight, Info, CheckCircle, AlertCircle, Download, RefreshCw } from 'lucide-react'
import Header from '../../components/Header'
import { useToast } from '../../components/Toast'

/**
 * 关于页（设置子页）
 *
 * 从原 SettingsPage 拆出：
 * - 当前版本：v1.0.6
 * - 用户协议 / 隐私政策：MVP 占位（Toast 提示）
 * - 检查更新：直接 fetch 云端 API https://47.116.59.141/api/v1/app/windows-version
 *
 * 版本号铁律：CURRENT_VERSION 必须与 package.json、安装包版本严格对齐。
 */

/** 当前客户端版本（与 package.json version 同步，不带 v 前缀） */
const CURRENT_VERSION = '1.0.6'

/** 云端更新检查 API（直连，不经过本地后端转发） */
const UPDATE_CHECK_URL = 'https://47.116.59.141/api/v1/app/windows-version'

interface UpdateCheckData {
  version: string
  hasUpdate: boolean
  forceUpdate: boolean
  sizeMB: number
  setupUrl: string
  portableUrl?: string
  setupSha256: string
  notes: string
  publishedAt?: string
}

export default function AboutSettingsPage() {
  const toast = useToast((s) => s.show)

  const [checking, setChecking] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<UpdateCheckData | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)

  async function handleCheckUpdate() {
    setChecking(true)
    setUpdateInfo(null)
    setCheckError(null)

    try {
      const url = `${UPDATE_CHECK_URL}?current=${encodeURIComponent(CURRENT_VERSION)}`
      const resp = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      })

      if (!resp.ok) {
        throw new Error(`服务器返回 HTTP ${resp.status}`)
      }

      const json = (await resp.json()) as { code: number; data: UpdateCheckData; message?: string }

      if (json.code !== 200 || !json.data) {
        throw new Error(json.message || '服务端返回异常')
      }

      const data = json.data
      setUpdateInfo(data)

      if (!data.hasUpdate) {
        toast('已是最新版本', 'success')
      } else {
        toast(`发现新版本 v${data.version}`, 'info')
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '未知错误'
      setCheckError(msg)
      toast(`检查更新失败：${msg}`, 'error')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="app-shell">
      <Header title="关于" />

      <div className="px-3 py-4 space-y-4">
        <section className="card">
          <div className="space-y-1">
            {/* 当前版本行 */}
            <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
              <span className="text-sm text-gray-600 flex items-center gap-2">
                <Info size={16} className="text-gray-400" /> 当前版本
              </span>
              <span className="text-xs text-gray-400">v{CURRENT_VERSION}</span>
            </div>

            {/* 检查更新区域 */}
            <div className="py-2.5 border-b border-gray-50">
              {!updateInfo && !checkError && !checking && (
                <button
                  onClick={handleCheckUpdate}
                  className="w-full flex items-center justify-between hover:bg-gray-50 -mx-1 px-1 rounded"
                >
                  <span className="text-sm text-gray-600">检查更新</span>
                  <ChevronRight size={16} className="text-gray-300" />
                </button>
              )}

              {checking && (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-500 flex items-center gap-2">
                    <RefreshCw size={14} className="animate-spin text-gray-400" />
                    正在检查...
                  </span>
                </div>
              )}

              {updateInfo && !updateInfo.hasUpdate && (
                <div className="flex items-center gap-2 py-1">
                  <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                  <span className="text-sm text-green-600">
                    已是最新版本 v{updateInfo.version}
                  </span>
                </div>
              )}

              {updateInfo && updateInfo.hasUpdate && (
                <div className="space-y-2 py-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-amber-500 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-700">
                      发现新版本 v{updateInfo.version}
                      {updateInfo.forceUpdate && (
                        <span className="ml-1 text-xs text-red-500">（强制更新）</span>
                      )}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 pl-7">
                    大小约 {updateInfo.sizeMB} MB
                  </div>
                  {updateInfo.notes && (
                    <div className="text-xs text-gray-500 pl-7 whitespace-pre-wrap">
                      {updateInfo.notes}
                    </div>
                  )}
                  <div className="flex gap-2 pt-1">
                    <a
                      href={updateInfo.setupUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-500 text-white text-xs rounded-md hover:bg-blue-600 transition-colors"
                    >
                      <Download size={14} />
                      下载安装版
                    </a>
                    {updateInfo.portableUrl && (
                      <a
                        href={updateInfo.portableUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-md hover:bg-gray-200 transition-colors"
                      >
                        <Download size={14} />
                        便携版
                      </a>
                    )}
                  </div>
                </div>
              )}

              {checkError && !checking && (
                <div className="space-y-2 py-1">
                  <div className="flex items-center gap-2">
                    <AlertCircle size={16} className="text-red-500 flex-shrink-0" />
                    <span className="text-sm text-red-600">检查更新失败</span>
                  </div>
                  <div className="text-xs text-gray-500 pl-7">{checkError}</div>
                  <button
                    onClick={handleCheckUpdate}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-md hover:bg-gray-200 transition-colors ml-7"
                  >
                    <RefreshCw size={14} />
                    重试
                  </button>
                </div>
              )}
            </div>

            {/* 用户协议 */}
            <button
              onClick={() => toast('用户协议：MVP 阶段待完善', 'info')}
              className="w-full flex items-center justify-between py-2.5 border-b border-gray-50 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600">用户协议</span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>

            {/* 隐私政策 */}
            <button
              onClick={() => toast('隐私政策：MVP 阶段待完善', 'info')}
              className="w-full flex items-center justify-between py-2.5 hover:bg-gray-50 -mx-1 px-1 rounded"
            >
              <span className="text-sm text-gray-600">隐私政策</span>
              <ChevronRight size={16} className="text-gray-300" />
            </button>
          </div>
        </section>

        <div className="text-center text-xs text-gray-300 py-2">
          绿角犀 v{CURRENT_VERSION}
        </div>
      </div>
    </div>
  )
}
