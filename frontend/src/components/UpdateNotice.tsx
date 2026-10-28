import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import { api, unwrap } from '../lib/api'
import { Filesystem, Directory } from '@capacitor/filesystem'
import { IntentInstaller } from '../lib/intent-installer'

/** 当前 APK 版本号（与 android/app/build.gradle versionName 严格对齐） */
const CURRENT_APK_VERSION = '1.0.4'

/** 移动端启动时自动检查更新 → App 内下载 → 写内部存储 → 调系统安装器
 *
 * 链路：
 *   React 渲染 → 3s 延迟 → GET /api/v1/app/android-version
 *   → hasUpdate=true → 弹 Dialog
 *   → 用户点"立即更新" → Filesystem.downloadFile() 原生下载 APK
 *   → IntentInstaller.install() → FileProvider + Intent.ACTION_VIEW → 系统安装器
 *
 * 为什么不用 fetch？
 *   Capacitor v8 的 CapacitorHttp 原生插件拦截了 WebView fetch，
 *   用原生 OkHttp 执行，对 HTTP cleartext 有额外限制 → "Failed to fetch"。
 *   Filesystem.downloadFile 是原生下载，一步到位，完全绕过 fetch 拦截。
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
      } catch (e) {
        console.error('[UpdateNotice] check failed:', e)
      }
    }, 3000)

    return () => clearTimeout(timer)
  }, [])

  if (!visible || !info) return null

  async function handleUpdate() {
    if (downloading || !info) return
    setDownloading(true)
    setProgress(5)
    setError(null)

    try {
      const fileName = `update-${info.version}.apk`

      // 1. Filesystem.downloadFile 原生下载（绕过 CapacitorHttp 对 fetch 的拦截）
      const dlResult = await Filesystem.downloadFile({
        url: info.apkUrl,
        path: fileName,
        directory: Directory.Data,
      })
      setProgress(85)

      // 2. 调原生插件 → FileProvider + Intent.ACTION_VIEW → 系统安装器
      const rawPath = dlResult.path
      if (!rawPath) throw new Error('下载结果路径为空，无法安装')
      let installPath: string = rawPath
      if (installPath.startsWith('file://')) {
        installPath = installPath.replace('file://', '')
      }
      await IntentInstaller.install({ path: installPath })

      localStorage.setItem('aie_update_dismissed', info.version)
      setVisible(false)
    } catch (e) {
      console.error('[UpdateNotice] handleUpdate failed:', e)
      const msg = e instanceof Error ? e.message : '未知错误'
      setError(msg)
    } finally {
      setDownloading(false)
      setProgress(0)
    }
  }

  function handleLater() {
    localStorage.setItem('aie_update_dismissed', info!.version)
    setVisible(false)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-6">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-4 text-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Download size={20} />
              <span className="font-semibold">发现新版本</span>
            </div>
            {!info.forceUpdate && !downloading && (
              <button onClick={handleLater} className="p-1 rounded-full hover:bg-white/20">
                <X size={18} />
              </button>
            )}
          </div>
          <div className="text-sm opacity-90 mt-1.5">
            v{info.current} → <span className="font-bold">v{info.version}</span>
            <span className="ml-2 opacity-75">({info.sizeMB.toFixed(1)} MB)</span>
          </div>
        </div>

        <div className="px-5 py-4 min-h-[80px]">
          {downloading ? (
            <div>
              <div className="text-sm text-gray-600 mb-2">下载中... {progress}%</div>
              <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary-500 to-primary-600 transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">下载失败：{error}</div>
          ) : (
            <>
              {info.notes && <div className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{info.notes}</div>}
              {info.forceUpdate && <div className="mt-3 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-2">🔴 本次更新为强制更新</div>}
            </>
          )}
        </div>

        <div className="flex gap-3 px-5 pb-5">
          {!downloading && !info.forceUpdate && (
            <button onClick={handleLater} disabled={downloading} className="flex-1 py-2.5 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50">
              下次再说
            </button>
          )}
          <button onClick={handleUpdate} disabled={downloading} className="flex-1 py-2.5 text-sm text-white bg-primary-500 rounded-lg hover:bg-primary-600 font-medium disabled:opacity-50">
            {downloading ? `${progress}%` : error ? '重试' : '立即更新'}
          </button>
        </div>
      </div>
    </div>
  )
}
