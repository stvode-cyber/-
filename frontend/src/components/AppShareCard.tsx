import { useState, useEffect } from 'react'
import { getApkDownloadUrl, getAppInfo, type AppInfo } from '../lib/api'
import { isCapacitor } from '../lib/platform'

export function AppShareCard() {
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    getAppInfo().then(setInfo).catch(() => {})
  }, [])

  async function handleInstall() {
    if (downloading) return
    setDownloading(true)

    try {
      const url = getApkDownloadUrl()

      if (isCapacitor) {
        // Android: 通过系统浏览器打开 APK 下载链接，浏览器下载后自动弹出安装提示
        window.open(url, '_system')
        setTimeout(() => setDownloading(false), 2000)
      } else {
        // Web/Electron: 直接下载
        const a = document.createElement('a')
        a.href = url
        a.download = 'greenrhino.apk'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setDownloading(false)
      }
    } catch (err) {
      console.error('Download failed:', err)
      alert('下载失败，请重试')
      setDownloading(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      background: 'linear-gradient(135deg, #059669 0%, #10b981 100%)',
      borderRadius: '12px',
      maxWidth: '320px',
      color: '#fff',
    }}>
      <div style={{
        width: '48px',
        height: '48px',
        borderRadius: '12px',
        background: 'rgba(255,255,255,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
        flexShrink: 0,
      }}>
        🦏
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, fontSize: '15px' }}>绿角犀 App</div>
        <div style={{ fontSize: '12px', opacity: 0.85, marginTop: '2px' }}>
          {info ? `${info.version} · ${info.sizeFormatted}` : 'Android 安装包'}
        </div>
        {downloading && (
          <div style={{ fontSize: '11px', opacity: 0.8, marginTop: '4px' }}>
            {isCapacitor ? '正在打开浏览器下载...' : '下载中...'}
          </div>
        )}
      </div>
      {!downloading && (
        <button
          onClick={handleInstall}
          style={{
            padding: '6px 14px',
            background: 'rgba(255,255,255,0.25)',
            border: '1px solid rgba(255,255,255,0.4)',
            borderRadius: '8px',
            color: '#fff',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {isCapacitor ? '安装' : '下载'}
        </button>
      )}
    </div>
  )
}
