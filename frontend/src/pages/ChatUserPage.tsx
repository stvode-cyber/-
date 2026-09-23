import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, Send, MoreVertical, Image as ImageIcon, FileText, MapPin, Plus, Smartphone } from 'lucide-react'
import { api, unwrap, getSSEUrl } from '../lib/api'
import { LoadingState, ErrorState } from '../components/StateView'
import { AppShareCard } from '../components/AppShareCard'

/**
 * 用户私聊 / 群聊会话页
 * - 路由 /chat/u/:convId → 私聊
 * - 路由 /chat/g/:convId → 群聊
 *
 * 与 ChatPage（AI 对话，含 DG-* 卡片）解耦：本页只处理文本/图片/文件/位置消息。
 */

interface ConversationInfo {
  id: string
  type: 'user' | 'group'
  remark: string | null
  targetUserId: string | null
  groupId: string | null
  targetUser: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  } | null
  group: {
    id: string
    name: string
    avatar: string | null
  } | null
}

interface Message {
  id: string
  senderId: string
  isMe: boolean
  sender: {
    id: string
    username: string
    nickname: string | null
    avatar: string | null
  } | null
  content: string
  messageType: 'text' | 'image' | 'file' | 'location' | 'system' | 'app_share'
  mediaUrl: string | null
  createdAt: string
}

function isImgAvatar(avatar: string | null | undefined): avatar is string {
  return !!avatar && (
    avatar.startsWith('data:image') ||
    avatar.startsWith('http') ||
    avatar.startsWith('/')
  )
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const oneDay = 24 * 60 * 60 * 1000
  const time = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (diff < oneDay && now.getDate() === d.getDate()) return time
  if (diff < 2 * oneDay) return `昨天 ${time}`
  if (diff < 7 * oneDay) {
    const days = ['日', '一', '二', '三', '四', '五', '六']
    return `周${days[d.getDay()]} ${time}`
  }
  return `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

export default function ChatUserPage() {
  const { convId = '', type } = useParams<{ convId: string; type: string }>()
  // 路由 /chat/u/:convId → type='u'，/chat/g/:convId → type='g'
  // 我们直接用 conversation.type 字段判断，不依赖 URL 参数 type
  const nav = useNavigate()
  const [conv, setConv] = useState<ConversationInfo | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showAttach, setShowAttach] = useState(false)

  const imageInputRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pollTimer = useRef<number | null>(null)

  /** 加载会话信息 */
  const loadConversation = useCallback(async () => {
    try {
      // 通过 conversations 列表找到对应会话
      const list = await unwrap<ConversationInfo[]>(api.get('/conversations'))
      const found = list.find((c) => c.id === convId)
      if (!found) {
        setError('会话不存在')
        return
      }
      setConv(found)
    } catch (e: any) {
      setError(e?.message || '加载会话失败')
    }
  }, [convId])

  /** 加载消息 */
  const loadMessages = useCallback(async () => {
    try {
      const r = await unwrap<{ messages: Message[]; hasMore: boolean }>(
        api.get(`/conversations/${convId}/messages?limit=100`),
      )
      setMessages(r.messages)
      // 标记已读
      await api.patch(`/conversations/${convId}/read`).catch(() => {})
    } catch (e: any) {
      setError(e?.message || '加载消息失败')
    } finally {
      setLoading(false)
    }
  }, [convId])

  const loadAll = useCallback(async () => {
    setLoading(true)
    await loadConversation()
    await loadMessages()
  }, [loadConversation, loadMessages])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 轮询新消息（降级为 15 秒，SSE 不可用时兜底）
  useEffect(() => {
    if (!convId) return
    pollTimer.current = window.setInterval(async () => {
      try {
        const r = await unwrap<{ messages: Message[] }>(
          api.get(`/conversations/${convId}/messages?limit=100`),
        )
        setMessages(r.messages)
        await api.patch(`/conversations/${convId}/read`).catch(() => {})
      } catch {
        /* ignore */
      }
    }, 15000)
    return () => {
      if (pollTimer.current) window.clearInterval(pollTimer.current)
    }
  }, [convId])

  // SSE 实时消息推送
  const sseRef = useRef<EventSource | null>(null)
  useEffect(() => {
    if (!convId) return
    let reconnectTimer: number | null = null

    function connect() {
      try {
        const es = new EventSource(getSSEUrl())
        sseRef.current = es

        es.addEventListener('message', async (e) => {
          try {
            const msg = JSON.parse(e.data)
            // 只处理当前会话的消息
            if (msg.conversationId === convId || msg.conversationId === undefined) {
              const r = await unwrap<{ messages: Message[] }>(
                api.get(`/conversations/${convId}/messages?limit=100`),
              )
              setMessages(r.messages)
              await api.patch(`/conversations/${convId}/read`).catch(() => {})
            }
          } catch {
            /* ignore parse errors */
          }
        })

        es.onerror = () => {
          es.close()
          sseRef.current = null
          // 5 秒后重连
          reconnectTimer = window.setTimeout(connect, 5000)
        }
      } catch {
        /* EventSource not supported, polling will handle it */
      }
    }

    connect()

    return () => {
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      sseRef.current?.close()
      sseRef.current = null
    }
  }, [convId])

  // 自动滚动到底部
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  /** 发送文本消息 */
  const sendText = async () => {
    if (!input.trim() || sending) return
    setSending(true)
    const content = input.trim()
    setInput('')
    try {
      await api.post(`/conversations/${convId}/messages`, {
        content,
        messageType: 'text',
      })
      await loadMessages()
    } catch (e: any) {
      setInput(content)
      setError(e?.message || '发送失败')
    } finally {
      setSending(false)
    }
  }

  /** 发送图片 */
  const sendImage = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError('图片不能超过 5MB')
      return
    }
    setSending(true)
    try {
      const dataUrl = await readFileAsDataURL(file)
      // 客户端压缩（同 ChatPage 逻辑）
      const compressed = await compressImage(dataUrl, 1280, 0.8)
      await api.post(`/conversations/${convId}/messages`, {
        content: file.name,
        messageType: 'image',
        mediaUrl: compressed,
      })
      await loadMessages()
    } catch (e: any) {
      setError(e?.message || '图片发送失败')
    } finally {
      setSending(false)
    }
  }

  /** 发送文件 */
  const sendFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) {
      setError('文件不能超过 5MB')
      return
    }
    setSending(true)
    try {
      const dataUrl = await readFileAsDataURL(file)
      await api.post(`/conversations/${convId}/messages`, {
        content: file.name,
        messageType: 'file',
        mediaUrl: dataUrl,
      })
      await loadMessages()
    } catch (e: any) {
      setError(e?.message || '文件发送失败')
    } finally {
      setSending(false)
    }
  }

  /** 发送位置 */
  const sendLocation = async () => {
    if (!navigator.geolocation) {
      setError('浏览器不支持定位')
      return
    }
    setSending(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const content = `位置：${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`
          await api.post(`/conversations/${convId}/messages`, {
            content,
            messageType: 'location',
          })
          await loadMessages()
        } catch (e: any) {
          setError(e?.message || '位置发送失败')
        } finally {
          setSending(false)
        }
      },
      (err) => {
        setError(err.message || '获取位置失败')
        setSending(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  /** 发送应用分享 */
  const sendAppShare = async () => {
    setSending(true)
    try {
      await api.post(`/conversations/${convId}/messages`, {
        content: '绿角犀 App',
        messageType: 'app_share',
      })
      await loadMessages()
    } catch (e: any) {
      setError(e?.message || '分享失败')
    } finally {
      setSending(false)
    }
  }

  /** 渲染单条消息 */
  const renderMessage = (m: Message, prev: Message | null) => {
    const showSenderName =
      conv?.type === 'group' && !m.isMe && (
        !prev || prev.senderId !== m.senderId
      )

    return (
      <div
        key={m.id}
        className={`flex ${m.isMe ? 'justify-end' : 'justify-start'} px-3 mb-2`}
      >
        <div className={`flex gap-2 max-w-[80%] ${m.isMe ? 'flex-row-reverse' : 'flex-row'}`}>
          {/* 头像（群聊显示发送者头像） */}
          {conv?.type === 'group' && (
            <div className="flex-shrink-0 w-8 h-8 mt-5">
              {m.sender && isImgAvatar(m.sender.avatar) ? (
                <img
                  src={m.sender.avatar!}
                  alt=""
                  className="w-8 h-8 rounded-full object-cover"
                />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-base">
                  {m.sender?.avatar || '👤'}
                </div>
              )}
            </div>
          )}
          <div className={`flex flex-col ${m.isMe ? 'items-end' : 'items-start'}`}>
            {showSenderName && (
              <span className="text-xs text-gray-500 mb-0.5 px-1">
                {m.sender?.nickname || m.sender?.username || '未知'}
              </span>
            )}
            <div className="flex items-end gap-1">
              <span className="text-[10px] text-gray-400 mb-1">
                {formatTime(m.createdAt)}
              </span>
              <div
                className={`px-3 py-2 rounded-2xl text-sm break-words ${
                  m.isMe
                    ? 'text-white rounded-tr-sm'
                    : 'bg-white text-gray-800 rounded-tl-sm border border-gray-100 shadow-sm'
                }`}
                style={
                  m.isMe
                    ? { background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)' }
                    : undefined
                }
              >
                {m.messageType === 'image' && m.mediaUrl ? (
                  <img
                    src={m.mediaUrl}
                    alt={m.content}
                    className="max-w-[200px] max-h-[200px] rounded-lg"
                  />
                ) : m.messageType === 'file' && m.mediaUrl ? (
                  <a
                    href={m.mediaUrl}
                    download={m.content}
                    className="flex items-center gap-2 underline"
                  >
                    <FileText size={16} />
                    <span className="text-xs">{m.content}</span>
                  </a>
                ) : m.messageType === 'location' ? (
                  <div className="flex items-center gap-2 min-w-[180px]">
                    <MapPin size={16} />
                    <span className="text-xs">{m.content}</span>
                  </div>
                ) : m.messageType === 'app_share' ? (
                  <div className="min-w-[260px]" style={{ background: 'transparent', padding: 0 }}>
                    <AppShareCard />
                  </div>
                ) : (
                  m.content
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // 标题：私聊用备注/昵称，群聊用群名
  const title = conv
    ? conv.type === 'group'
      ? conv.group?.name || '群聊'
      : conv.remark || conv.targetUser?.nickname || conv.targetUser?.username || '私聊'
    : '加载中...'

  return (
    <div className="min-h-screen flex flex-col bg-primary-50/20">
      {/* 顶部 */}
      <header
        className="sticky top-0 z-30 text-white shadow-md bg-gradient-to-br from-primary-500 to-teal-500"
      >
        <div className="flex items-center justify-between px-2 py-3">
          <button
            onClick={() => nav('/chat')}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="返回"
          >
            <ChevronLeft size={22} />
          </button>
          <h1 className="flex-1 text-center font-semibold truncate">{title}</h1>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="p-2 rounded-full hover:bg-white/10"
            aria-label="更多"
          >
            <MoreVertical size={20} />
          </button>
        </div>
      </header>

      {/* 消息列表 */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-3">
        {loading ? (
          <LoadingState text="加载消息..." />
        ) : error ? (
          <ErrorState text={error} onRetry={loadAll} />
        ) : messages.length === 0 ? (
          <div className="text-center text-gray-400 py-12">
            <p className="text-sm">还没有消息，发条消息打个招呼吧～</p>
          </div>
        ) : (
          messages.map((m, i) => renderMessage(m, i > 0 ? messages[i - 1] : null))
        )}
      </div>

      {/* 输入区 */}
      <div className="sticky bottom-0 bg-white border-t border-gray-100 p-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAttach((v) => !v)}
            className="p-2 text-gray-500 rounded-full hover:bg-primary-50"
            aria-label="附件"
          >
            <Plus size={22} />
          </button>
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                sendText()
              }
            }}
            placeholder="发消息..."
            className="input flex-1 py-2"
          />
          <button
            onClick={sendText}
            disabled={!input.trim() || sending}
            className="p-2.5 text-white rounded-full disabled:opacity-40 transition-all active:scale-90"
            style={{ background: 'linear-gradient(135deg, #059669 0%, #0D9488 100%)' }}
            aria-label="发送"
          >
            <Send size={18} />
          </button>
        </div>

        {/* 附件菜单 */}
        {showAttach && (
          <div className="grid grid-cols-4 gap-2 mt-2 pt-2 border-t border-gray-50">
            <button
              onClick={() => {
                imageInputRef.current?.click()
                setShowAttach(false)
              }}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl hover:bg-primary-50"
            >
              <ImageIcon size={22} className="text-primary-500" />
              <span className="text-xs text-gray-600">图片</span>
            </button>
            <button
              onClick={() => {
                fileInputRef.current?.click()
                setShowAttach(false)
              }}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl hover:bg-primary-50"
            >
              <FileText size={22} className="text-accent-500" />
              <span className="text-xs text-gray-600">文件</span>
            </button>
            <button
              onClick={() => {
                sendLocation()
                setShowAttach(false)
              }}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl hover:bg-primary-50"
            >
              <MapPin size={22} className="text-mint-500" />
              <span className="text-xs text-gray-600">位置</span>
            </button>
            <button
              onClick={() => {
                sendAppShare()
                setShowAttach(false)
              }}
              disabled={sending}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl hover:bg-primary-50 disabled:opacity-40"
            >
              <Smartphone size={22} className="text-teal-500" />
              <span className="text-xs text-gray-600">分享App</span>
            </button>
          </div>
        )}

        {/* 隐藏的文件输入 */}
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) sendImage(f)
            e.target.value = ''
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) sendFile(f)
            e.target.value = ''
          }}
        />
      </div>

      {/* 右上角菜单 */}
      {menuOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setMenuOpen(false)}
          />
          <div className="absolute right-2 top-14 z-50 bg-white rounded-xl shadow-lg shadow-black/10 overflow-hidden min-w-[120px]">
            <button
              onClick={() => {
                nav('/chat')
              }}
              className="w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-primary-50 text-left"
            >
              返回列表
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ============ 工具函数 ============

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

/** 客户端图片压缩（同 ChatPage.tsx 逻辑） */
function compressImage(dataUrl: string, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      let { width, height } = img
      if (width > maxSize || height > maxSize) {
        if (width > height) {
          height = (height * maxSize) / width
          width = maxSize
        } else {
          width = (width * maxSize) / height
          height = maxSize
        }
      }
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        resolve(dataUrl)
        return
      }
      ctx.drawImage(img, 0, 0, width, height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = reject
    img.src = dataUrl
  })
}
