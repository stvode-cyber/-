import { useEffect, useState } from 'react'
import { Server, RotateCcw, PlugZap, CheckCircle2, Loader2 } from 'lucide-react'
import Header from '../../components/Header'
import { api, getEffectiveBaseURL, setServerBaseURL } from '../../lib/api'
import { getDefaultAPIBaseURL, resetServerBaseURL, normalizeBaseURL } from '../../lib/serverConfig'
import { useToast } from '../../components/Toast'

/**
 * 服务器地址设置（正式版：换服务器 / 自填地址无需重新打包）
 *
 * - 默认地址：编译时用 VITE_API_BASE_URL 内置（.env.mobile）
 * - 自设地址：保存到本地，启动时覆盖默认，当前会话即生效
 * - 提供「连接测试」验证地址可用性
 */
export default function ServerSettingsPage() {
  const toast = useToast((s) => s.show)
  const [input, setInput] = useState<string>('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState<null | { ok: boolean }>(null)

  useEffect(() => {
    setInput(getEffectiveBaseURL())
  }, [])

  // 实时校验 + 安全标识（http 明文 / https 加密）
  const normalized = normalizeBaseURL(input)
  const isHttps = !!normalized && normalized.startsWith('https://')
  const inputValid = !!normalized

  /** 连接测试：请求 health，判断地址是否可用 */
  const testConnection = async (url?: string) => {
    const target = url ? normalizeBaseURL(url) : normalized
    if (!target) return
    setTesting(true)
    setTestResult(null)
    try {
      // 临时指向目标地址做健康检查，不影响已保存的配置
      const res = await api.get('/health', {
        baseURL: target,
        timeout: 8000,
      })
      setTestResult({ ok: res && (res as any).status === 'ok' !== false })
    } catch {
      setTestResult({ ok: false })
    } finally {
      setTesting(false)
    }
  }

  /** 保存：切换 baseURL + 持久化 */
  const handleSave = async () => {
    if (!inputValid || !normalized) {
      toast('服务器地址无效，请填写合法的 http/https 地址', 'error')
      return
    }
    setSaving(true)
    try {
      await setServerBaseURL(normalized)
      toast(isHttps ? '服务器地址已保存（HTTPS 加密）' : '服务器地址已保存（HTTP 明文）', 'success')
    } catch {
      toast('保存失败，稍后再试', 'error')
    } finally {
      setSaving(false)
    }
  }

  /** 恢复默认：清自设地址，回到内置地址 */
  const handleReset = async () => {
    setInput(getDefaultAPIBaseURL())
    await resetServerBaseURL()
    await setServerBaseURL(getDefaultAPIBaseURL())
    toast('已恢复默认地址', 'success')
  }

  return (
    <div className="app-shell pb-6">
      <Header title="服务器设置" />

      <div className="px-3 py-3 space-y-3">
        {/* 地址编辑 */}
        <div className="card p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-xl bg-primary-50 flex items-center justify-center flex-shrink-0">
              <Server size={20} className="text-primary-600" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-800">后端服务器地址</div>
              <div className="text-xs text-gray-400 mt-0.5">
                默认：{getDefaultAPIBaseURL().replace(/^https?:\/\//, '')}
              </div>
            </div>
          </div>

          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setTestResult(null) }}
            placeholder="lujax.fun:8443 或 http://ip:3001/api/v1"
            className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm font-mono text-gray-700 focus:outline-none focus:ring-2 focus:ring-primary-300 bg-white"
          />
          {/* 安全标识 */}
          {input !== '' && (
            <div className={`mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${inputValid ? (isHttps ? 'bg-green-50 text-green-600' : 'bg-amber-50 text-amber-600') : 'bg-red-50 text-red-500'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${inputValid ? (isHttps ? 'bg-green-500' : 'bg-amber-500') : 'bg-red-500'}`} />
              {!inputValid
                ? '地址格式不正确'
                : isHttps
                  ? 'HTTPS 加密连接'
                  : 'HTTP 明文连接（数据不加密，正式环境建议用 HTTPS）'}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-2 leading-relaxed">
            换服务器或自填地址时修改这里，保存后无需重新安装 App。可填 https 或 http；缺协议时自动补 https。
          </p>

          {/* 操作按钮 */}
          <div className="flex items-center gap-2 mt-3">
            <button
              onClick={() => testConnection()}
              disabled={testing || !inputValid}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-primary-600 bg-primary-50 hover:bg-primary-100 transition-colors disabled:opacity-50"
            >
              {testing ? <Loader2 size={14} className="animate-spin" /> : <PlugZap size={14} />}
              连接测试
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !inputValid}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm text-white bg-primary-500 hover:bg-primary-600 transition-colors disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              保存
            </button>
            <button
              onClick={handleReset}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm text-gray-500 bg-gray-50 hover:bg-gray-100 transition-colors ml-auto"
            >
              <RotateCcw size={14} />
              恢复默认
            </button>
          </div>

          {/* 测试结果 */}
          {testResult && (
            <div className={`mt-3 flex items-center gap-1.5 text-sm ${testResult.ok ? 'text-green-600' : 'text-red-500'}`}>
              <CheckCircle2 size={14} />
              {testResult.ok ? '连接成功，地址可用' : '连接失败，请检查地址与网络'}
            </div>
          )}
        </div>

        <p className="text-xs text-gray-300 leading-relaxed px-1">
          服务器地址只保存在本地，不会上传。切换后如需登录，请使用新服务器的账号。
        </p>
      </div>
    </div>
  )
}