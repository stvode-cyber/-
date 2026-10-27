import { Paperclip, MapPin, Link, Sparkles, FileText, Eye, Download, Image as ImageIcon, X, ArrowRight, Fingerprint } from 'lucide-react'
import type { Message, MessageMetadata, TaskItem, HandoverPendingItem } from './chatTypes'
import { MsgAvatar, TaskCard, BillCard, DietCard, HandoverCard, ScheduleCard, FragmentCard, DigestCard, ConnectionsCard, InsightsCard, PreparationCard, CrisisCard, UnifiedTaskCard, formatFileSize, downloadOfficeDoc } from './ChatWidgets'
export function MessageBubble({
  message,
  avatar,
  onFeedback,
  onTaskDone,
  onBillConfirm,
  onDietJump,
  onHandoverCreate,
  onQuickReply,
}: {
  message: Message
  avatar?: string
  onFeedback: (id: string, f: 'like' | 'dislike') => void
  onTaskDone: (taskId: string) => void
  onBillConfirm: (amount: number, category: string) => void
  onDietJump: (mealType: string) => void
  onHandoverCreate: (data: {
    completedItems: string[]
    pendingItems: { text: string; priority: string; dueDate?: string }[]
    billsSummary?: { expense: number; income: number; count: number }
    dietsSummary?: { meals: number; totalCalories: number }
  }) => void
  onQuickReply?: (text: string) => void
}) {
  const isUser = message.role === 'user'
  let metadata: MessageMetadata | null = null
  try {
    metadata = message.metadata ? JSON.parse(message.metadata) : null
  } catch {
    // ignore
  }

  return (
    <div className={`flex gap-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {/* AI 头像：产品红线——AI 也用用户头像，右下「角」角标区分身份 */}
      {!isUser && <MsgAvatar avatar={avatar} isAi />}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        {/* DG-02 多模态消息渲染：图片/文件/位置 */}
        {isUser && message.messageType === 'image' && message.mediaUrl && (
          <div className="rounded-2xl rounded-tr-sm overflow-hidden bg-white shadow-sm">
            <img
              src={message.mediaUrl}
              alt={message.content}
              className="max-w-full max-h-64 object-cover"
            />
            {message.content && message.content !== '[图片]' && (
              <div className="px-3 py-1.5 text-xs text-gray-700">{message.content}</div>
            )}
          </div>
        )}
        {isUser && message.messageType === 'file' && message.mediaUrl && (
          <a
            href={message.mediaUrl}
            download={(metadata as { fileName?: string } | null)?.fileName || message.content}
            className="flex items-center gap-2 px-4 py-3 text-white rounded-2xl rounded-tr-sm shadow-sm shadow-primary-200/40 bg-gradient-accent"
          >
            <Paperclip size={18} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium truncate">{message.content}</div>
              {(metadata as { fileSize?: number } | null)?.fileSize && (
                <div className="text-[10px] opacity-80">
                  {formatFileSize((metadata as { fileSize: number }).fileSize)}
                </div>
              )}
            </div>
          </a>
        )}
        {isUser && message.messageType === 'location' && (
          <div
            className="px-4 py-3 text-white rounded-2xl rounded-tr-sm shadow-sm shadow-primary-200/40 bg-gradient-accent"
          >
            <div className="flex items-center gap-2">
              <MapPin size={16} />
              <span className="text-sm font-medium">位置共享</span>
            </div>
            <div className="text-xs mt-1 opacity-90">{message.content}</div>
            {(metadata as { accuracy?: number } | null)?.accuracy && (
              <div className="text-[10px] mt-0.5 opacity-70">
                精度 ±{Math.round((metadata as { accuracy: number }).accuracy)}m
              </div>
            )}
          </div>
        )}
        {/* v5: 表情包消息渲染 */}
        {message.messageType === 'sticker' && message.mediaUrl && (
          <div className="rounded-2xl overflow-hidden bg-transparent shadow-sm" style={{ maxWidth: '120px' }}>
            <img
              src={message.mediaUrl}
              alt={message.content}
              className="w-full h-auto object-cover rounded-xl"
            />
          </div>
        )}
        {/* 普通文本消息（非多模态、非表情包） */}
        {!(
          isUser &&
          (message.messageType === 'image' ||
            message.messageType === 'file' ||
            message.messageType === 'location')
        ) && message.messageType !== 'sticker' && (
          <div
            className={`px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
              isUser
                ? 'text-white rounded-[20px] rounded-br-md shadow-md shadow-primary-500/30 bg-gradient-accent'
                : 'bg-white text-gray-800 rounded-[20px] rounded-bl-md shadow-sm border-[1.5px] border-primary-100'
            }`}
          >
            {message.content}
          </div>
        )}

        {/* 卡片渲染（交接点：可交互的功能卡片） */}
        {!isUser && message.messageType === 'task_card' && metadata?.tasks && (
          <TaskCard
            tasks={metadata.tasks}
            onDone={onTaskDone}
          />
        )}
        {!isUser && message.messageType === 'bill_card' && metadata && (
          <BillCard
            amount={metadata.amount || 0}
            type={metadata.type || '其他'}
            confirmed={metadata.confirmed}
            autoCategory={metadata.autoCategory}
            onConfirm={onBillConfirm}
          />
        )}
        {!isUser && message.messageType === 'diet_card' && metadata && (
          <DietCard mealType={metadata.mealType || 'breakfast'} onJump={onDietJump} />
        )}
        {!isUser && message.messageType === 'handover_card' && metadata && (
          <HandoverCard
            completedItems={metadata.completedItems || []}
            pendingItems={metadata.pendingItems || []}
            billsSummary={metadata.billsSummary}
            dietsSummary={metadata.dietsSummary}
            onCreate={onHandoverCreate}
          />
        )}
        {!isUser && message.messageType === 'schedule_card' && metadata?.schedule && (
          <ScheduleCard schedule={metadata.schedule} />
        )}
        {!isUser && message.messageType === 'fragment_card' && metadata?.fragments && (
          <FragmentCard fragments={metadata.fragments} />
        )}
        {!isUser && message.messageType === 'digest_card' && metadata?.digest && (
          <DigestCard digest={metadata.digest} />
        )}
        {/* P1 周报：@回顾 文本气泡下追加「看完整周报」跳转卡 */}
        {!isUser && metadata?.weeklyReport && (
          <Link
            to="/weekly-report"
            className="mt-1.5 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-primary-100 hover:border-primary-300 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs text-gray-600">
              <Sparkles size={14} className="text-primary-500" />
              图表版周报 · 收支/情绪/角角落
            </span>
            <ArrowRight size={14} className="text-primary-400" />
          </Link>
        )}
        {/* P3 画像：@画像 文本气泡下追加「看完整画像」跳转卡 */}
        {!isUser && metadata?.portrait && (
          <Link
            to="/profile-panel"
            className="mt-1.5 flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-primary-100 hover:border-primary-300 transition-colors"
          >
            <span className="flex items-center gap-2 text-xs text-gray-600">
              <Fingerprint size={14} className="text-primary-500" />
              图表版画像 · 消费/情绪/记忆
            </span>
            <ArrowRight size={14} className="text-primary-400" />
          </Link>
        )}
        {/* P2 办公小助手：新版本/导出结果卡片（预览 + 下载） */}
        {!isUser && metadata?.office && (metadata.office.type === 'write' || metadata.office.type === 'export') && metadata.office.docId && (
          <div className="mt-1.5 px-3.5 py-3 bg-white rounded-xl rounded-tl-sm shadow-sm border border-emerald-100">
            <div className="flex items-center gap-2 mb-2">
              <FileText size={14} className="text-emerald-500" />
              <span className="text-xs font-medium text-gray-700 truncate">{metadata.office.title || '新文档'}</span>
              {metadata.office.basedOn && (
                <span className="text-[10px] text-gray-400 truncate">基于 {metadata.office.basedOn} · 原件未动</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/office-doc/${metadata.office!.docId}`}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-emerald-600 bg-emerald-50 rounded-lg hover:bg-emerald-100 transition-colors"
              >
                <Eye size={12} /> 预览
              </Link>
              <button
                onClick={() => downloadOfficeDoc(metadata.office!.docId!, metadata.office!.format === 'txt' ? 'txt' : 'md', metadata.office!.title)}
                className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-gray-600 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <Download size={12} /> 下载 {String(metadata.office.format === 'txt' ? 'txt' : 'md').toUpperCase()}
              </button>
            </div>
          </div>
        )}
        {/* P2 办公小助手：读文档摘要卡 */}
        {!isUser && metadata?.office?.type === 'read' && (
          <div className="mt-1.5 flex items-center gap-2 px-3.5 py-2.5 bg-white rounded-xl rounded-tl-sm shadow-sm border border-gray-100">
            <FileText size={14} className="text-gray-400" />
            <span className="text-[11px] text-gray-500 truncate">
              {metadata.office.fileName} · {metadata.office.charCount} 字{metadata.office.format ? ` · ${metadata.office.format}` : ''}
            </span>
          </div>
        )}
        {!isUser && message.messageType === 'connections_card' && metadata?.connections && (
          <ConnectionsCard connections={metadata.connections} />
        )}
        {!isUser && message.messageType === 'insights_card' && metadata?.insights && (
          <InsightsCard insights={metadata.insights} />
        )}
        {!isUser && message.messageType === 'preparation_card' && metadata?.preparation && (
          <PreparationCard preparation={metadata.preparation} />
        )}
        {/* DG-16 危机干预卡 */}
        {!isUser && message.messageType === 'crisis_card' && metadata?.crisis && (
          <CrisisCard crisis={metadata.crisis} />
        )}
        {/* v4: 统一任务交互卡片（选项卡 + 结果卡合并） */}
        {!isUser && (message.messageType === 'task_created_card' || message.messageType === 'task_options_card') && (
          <UnifiedTaskCard
            options={metadata?.options}
            actionResult={metadata?.actionResult}
            onQuickReply={onQuickReply}
          />
        )}

        {/* 反馈按钮 */}
        {!isUser && message.messageType !== 'text' && (
          <div className="flex gap-2 mt-1 px-1">
            <button
              onClick={() => onFeedback(message.id, 'like')}
              className={`text-xs ${message.feedback === 'like' ? 'text-green-500' : 'text-gray-400'}`}
            >
              👍
            </button>
            <button
              onClick={() => onFeedback(message.id, 'dislike')}
              className={`text-xs ${message.feedback === 'dislike' ? 'text-red-500' : 'text-gray-400'}`}
            >
              👎
            </button>
          </div>
        )}
      </div>
      {/* 用户头像（右侧） */}
      {isUser && <MsgAvatar avatar={avatar} />}
    </div>
  )
}
