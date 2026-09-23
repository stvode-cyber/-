import { useState, useEffect, useCallback } from 'react'
import { Check, Loader2, AlertTriangle, CheckCircle2, RefreshCw, Edit3, Send } from 'lucide-react'
import Header from '../../components/Header'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../../components/Toast'
import { useAuthStore, type UserInfo } from '../../stores/auth'
import { toneMeta } from '../../lib/utils'

/**
 * AI 助理设定页（设置子页）
 *
 * 核心功能：
 * 1. AI 备注名：用户自定义 AI 助理的称呼（默认"角角"）
 * 2. AI 语气偏好：9 种对话风格选择
 * 3. AI 状态检测：检查 LLM 连接是否正常，异常时提醒后端
 *
 * 接口：
 * - PATCH /auth/me { aiNickname, preferredTone }
 * - GET  /chat/llm-status  获取 LLM 连接状态
 * - POST /chat/sessions/:id/messages  发送测试消息
 */

interface LLMStatus {
  available: boolean
  model?: string
  error?: string
}

export default function AIAssistantPage() {
  const toast = useToast((s) => s.show)
  const { user, updateUser } = useAuthStore()

  // 备注名
  const [nickEdit, setNickEdit] = useState(false)
  const [nickValue, setNickValue] = useState(user?.aiNickname || '角角')
  const [nickSaving, setNickSaving] = useState(false)

  // 语气
  const [toneSaving, setToneSaving] = useState(false)

  // LLM 状态
  const [llmStatus, setLLMStatus] = useState<LLMStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [testMsg, setTestMsg] = useState('')
  const [testReply, setTestReply] = useState('')
  const [testing, setTesting] = useState(false)

  // 获取 LLM 状态
  const checkLLM = useCallback(async () => {
    setChecking(true)
    try {
      const data = await unwrap<LLMStatus>(api.get('/chat/llm-status'))
      setLLMStatus(data)
      // 异常时提醒后端（写入审计日志）
      if (!data.available) {
        try {
          await api.post('/chat/report-issue', {
            issue: 'llm_unavailable',
            detail: data.error || 'LLM 服务不可用',
            timestamp: new Date().toISOString(),
          })
        } catch { /* 静默，不阻塞 */ }
      }
    } catch (e) {
      setLLMStatus({ available: false, error: (e as Error).message })
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => { checkLLM() }, [checkLLM])

  // 保存备注名
  const saveNickname = async () => {
    const trimmed = nickValue.trim()
    if (!trimmed) { toast('备注名不能为空', 'error'); return }
    if (trimmed.length > 10) { toast('备注名不能超过 10 字', 'error'); return }
    setNickSaving(true)
    updateUser({ aiNickname: trimmed })
    try {
      const updated = await unwrap<UserInfo>(api.patch('/auth/me', { aiNickname: trimmed }))
      updateUser(updated)
      toast('备注名已更新', 'success')
      setNickEdit(false)
    } catch (err) {
      updateUser({ aiNickname: user?.aiNickname || '角角' })
      toast((err as Error).message, 'error')
    } finally {
      setNickSaving(false)
    }
  }

  // 切换语气
  const changeTone = async (tone: string) => {
    if (tone === user?.preferredTone) return
    setToneSaving(true)
    updateUser({ preferredTone: tone })
    try {
      const updated = await unwrap<UserInfo>(api.patch('/auth/me', { preferredTone: tone }))
      updateUser(updated)
      toast('语气偏好已切换', 'success')
    } catch (err) {
      updateUser({ preferredTone: user?.preferredTone || 'gentle' })
      toast((err as Error).message, 'error')
    } finally {
      setToneSaving(false)
    }
  }

  // 发送测试消息
  const sendTest = async () => {
    if (!testMsg.trim()) return
    setTesting(true)
    setTestReply('')
    try {
      // 创建会话
      const session = await unwrap<{ id: string }>(api.post('/chat/sessions', { title: 'AI 测试' }))
      // 发送消息
      const data = await unwrap<{ reply?: string; aiReply?: string; content?: string }>(
        api.post(`/chat/sessions/${session.id}/messages`, { content: testMsg.trim() })
      )
      const reply = data.reply || data.aiReply || data.content || '（无回复）'
      setTestReply(reply)
    } catch (e) {
      setTestReply(`发送失败：${(e as Error).message}`)
    } finally {
      setTesting(false)
    }
  }

  const tones = Object.entries(toneMeta)
  const aiName = user?.aiNickname || '角角'

  return (
    <div className="app-shell">
      <Header title="AI 助理设定" />

      <div className="px-3 py-4 space-y-4">
        {/* AI 状态检测 */}
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800">AI 状态检测</span>
            <button
              onClick={checkLLM}
              disabled={checking}
              className="text-gray-400 hover:text-primary-500 disabled:opacity-50"
            >
              <RefreshCw size={16} className={checking ? 'animate-spin' : ''} />
            </button>
          </div>

          {checking && !llmStatus ? (
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Loader2 size={14} className="animate-spin" /> 正在检测...
            </div>
          ) : llmStatus?.available ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <CheckCircle2 size={16} />
              <span>已连接</span>
              {llmStatus.model && <span className="text-gray-400 text-xs">· {llmStatus.model}</span>}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-start gap-2 text-sm text-amber-600 bg-amber-50 rounded-lg p-2.5">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <div>
                  <div className="font-medium">AI 服务异常</div>
                  {llmStatus?.error && <div className="text-xs text-amber-500 mt-0.5">{llmStatus.error}</div>}
                  <div className="text-xs text-amber-500 mt-0.5">已自动通知后端，请稍后重试</div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* 备注名 */}
        <section className="card">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-800">备注名</span>
            {!nickEdit && (
              <button onClick={() => { setNickValue(aiName); setNickEdit(true) }} className="text-gray-400 hover:text-primary-500">
                <Edit3 size={14} />
              </button>
            )}
          </div>
          {nickEdit ? (
            <div className="flex gap-2">
              <input
                value={nickValue}
                onChange={(e) => setNickValue(e.target.value)}
                maxLength={10}
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') saveNickname(); if (e.key === 'Escape') setNickEdit(false) }}
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-400"
                placeholder="输入 AI 备注名"
              />
              <button onClick={saveNickname} disabled={nickSaving} className="px-3 py-2 rounded-lg bg-primary-500 text-white text-sm hover:bg-primary-600 disabled:opacity-50">
                {nickSaving ? <Loader2 size={14} className="animate-spin" /> : '保存'}
              </button>
            </div>
          ) : (
            <div className="text-sm text-gray-600">{aiName}</div>
          )}
          <p className="text-xs text-gray-400 mt-1.5">这个名称会显示在对话页顶部</p>
        </section>

        {/* 语气偏好 */}
        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-gray-800">语气偏好</span>
            {toneSaving && <Loader2 size={14} className="animate-spin text-gray-400" />}
          </div>
          <p className="text-xs text-gray-400 mb-3">选择 {aiName} 与你的对话风格</p>
          <div className="grid grid-cols-3 gap-2">
            {tones.map(([key, meta]) => {
              const active = user?.preferredTone === key
              return (
                <button
                  key={key}
                  onClick={() => changeTone(key)}
                  disabled={toneSaving}
                  className={`flex flex-col items-center gap-1 py-3 rounded-lg border transition-colors ${
                    active
                      ? 'border-primary-500 bg-primary-50 text-primary-600'
                      : 'border-gray-200 text-gray-600 hover:bg-gray-50'
                  } disabled:opacity-50`}
                >
                  <span className="text-xl">{meta.emoji}</span>
                  <span className="text-xs">{meta.label}</span>
                  {active && <Check size={12} className="text-primary-500" />}
                </button>
              )
            })}
          </div>
        </section>

        {/* 测试对话 */}
        <section className="card">
          <div className="text-sm font-semibold text-gray-800 mb-3">测试对话</div>
          <div className="flex gap-2">
            <input
              value={testMsg}
              onChange={(e) => setTestMsg(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !testing) sendTest() }}
              placeholder={`给 ${aiName} 发条消息试试...`}
              className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-primary-400"
              disabled={!llmStatus?.available}
            />
            <button onClick={sendTest} disabled={testing || !testMsg.trim() || !llmStatus?.available} className="px-3 py-2 rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50">
              {testing ? <Loader2 size={14} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          {testReply && (
            <div className="mt-3 p-3 rounded-lg bg-gray-50 text-sm text-gray-700 whitespace-pre-wrap">
              <span className="text-xs text-gray-400 mr-1">{aiName}：</span>
              {testReply}
            </div>
          )}
          {!llmStatus?.available && (
            <p className="text-xs text-amber-500 mt-2">AI 服务不可用，无法测试</p>
          )}
        </section>
      </div>
    </div>
  )
}
