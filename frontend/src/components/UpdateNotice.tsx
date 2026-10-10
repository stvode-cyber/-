import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { IntentInstaller } from '../lib/intent-installer'

/** 当前 APK 版本号（与 android/app/build.gradle versionName 严格对齐） */
const CURRENT_APK_VERSION = '1.0.2'

/** 移动端启动时自动检查更新 → App 内下载 → 调系统安装器
 *
 * 链路：
 *   React 渲染 → 3s 延迟 → GET /api/v1/app/android-version
 *   → hasUpdate=true → 弹 Dialog
 *   → 用户点"立即更新" → fetch 下载 APK → Filesystem 写 app 内部存储
 *   → IntentInstallerPlugin.install() 调 Intent.ACTION_VIEW 触发系统安装
 *
 * 依赖：
 *   - @capacitor/filesystem（npm 已装）
 *   - IntentInstallerPlugin（android/app/src/main/java 下的原生插件）
 *   - AndroidManifest: REQUEST_INSTALL_PACKAGES + FileProvider
 */
interface UpdateInfo {
  version: string
  current: string
  hasUpdate: boolean
  forceUpdate: boolean
  sizeMB: number
  apkUrl: string
  apkMd5: string
  notes: string
}

export default function UpdateNotice() {
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [visible, setVisible] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (__BUILD_MODE__ !== 'mobile') return

    const timer = setTimeout(async () => {
      try {
        const data = await unwrap<UpdateInfo>(
          api.get('/app/android-version', {
            params: { current: CURRENT_APK_VERSION },
          }),
        )
        if (!data?.hasUpdate) return

        const dismissed = localStorage.getItem('aie_update_dismissed')
        if (!data.forceUpdate && dismissed === data.version) return

        setInfo(data)
        setVisible(true)
      } catch {
        // 检查失败静默忽略
      }
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  if (!visible || !info) return null

  async function handleUpdate() {
    if (downloading || !info) return
    setDownloading(true)
    setProgress(0)
    setError(null)

    try {
      // 1. fetch 下载 APK（用 arrayBuffer）
      const resp = await fetch(info.apkUrl)
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      const total = Number(resp.headers.get('content-length') || info.sizeMB * 1024 * 1024)

      const reader = resp.body!.getReader()
      const chunks: Uint8Array[] = []
      let received = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        setProgress(Math.round((received / total) * 100))
      }
      const blob = new Blob(chunks as any[], { type: 'application/vnd.android.package-archive' })

      // 2. Blob → base64（Filesystem.writeFile 需要 base64 字符串）
      const base64 = await blobToBase64(blob)
      const fileName = `update-${info.version}.apk`

      // 3. 写到 app 内部存储（Directory.Data 外部不可见，FileProvider 可访问）
      const writeResult = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Data,
      })

      // 4. 调原生插件 → Intent.ACTION_VIEW → 系统安装器
      const installPath = writeResult.uri.replace('file://', '')
      await IntentInstaller.install({ path: installPath })

      localStorage.setItem('aie_update_dismissed', info.version)
      setVisible(false)
    } catch (e) {
      const msg = e instanceof Error ? e.message : '未知错误'
      setError(msg)
    } finally {
      setDownloading(false)
    }
  }

  function handleLater() {
    localStorage.setItem('aie_update_dismissed', info!.version)
    setVisible(false)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* 头部渐变 */}
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download size={20} />
              <span className="font-semibold">发现新版本</span>
            </div>
            {!info.forceUpdate && !downloading && (
              <button
                onClick={handleLater}
                className="p-1 rounded-full hover:bg-white/20 transition-colors"
                aria-label="关闭"
              >
                <X size={18} />
              </button>
            )}
          </div>
          <div className="text-sm opacity-90 mt-1.5">
            v{info.current} → <span className="font-bold">v{info.version}</span>
            <span className="ml-2 opacity-75">({info.sizeMB.toFixed(1)} MB)</span>
          </div>
        </div>

        {/* 更新说明 / 进度条 */}
        <div className="px-5 py-4 min-h-[80px]">
          {downloading ? (
            <div>
              <div className="text-sm text-gray-600 mb-2">下载中... {progress}%</div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">
              下载失败：{error}
            </div>
          ) : (
            <>
              {info.notes && (
                <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
                  {info.notes}
                </div>
              )}
              {info.forceUpdate && (
                <div className="mt-3 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">
                  🔴 本次更新为强制更新，请尽快安装
                </div>
              )}
            </>
          )}
        </div>

        {/* 按钮区 */}
        <div className="flex gap-3 px-5 pb-5">
          {!downloading && !info.forceUpdate && (
            <button
              onClick={handleLater}
              disabled={downloading}
              className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50"
            >
              下次再说
            </button>
          )}
          <button
            onClick={handleUpdate}
            disabled={downloading}
            className="flex-1 py-2.5 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 transition-colors font-medium disabled:opacity-50"
          >
            {downloading ? `${progress}%` : error ? '重试' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Blob → base64 字符串（Capacitor Filesystem.writeFile 需要） */
async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      // FileReader.result 是 "data:application/...;base64,XXX"，去掉前缀
      const result = reader.result as string
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : result)
    }
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}
