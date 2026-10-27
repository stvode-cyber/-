/**
 * Chat 页面共享类型定义
 * 从 ChatPage.tsx 拆出，供 MessageBubble / ChatWidgets / ChatPage 共用
 */

/** 交接卡中待跟进事项结构 */
export interface HandoverPendingItem {
  text: string
  priority: string
  dueDate?: string
}

/**
 * 单条消息（与后端 ChatMessage 模型对应）
 */
export interface Message {
  id: string
  role: string
  content: string
  messageType: string
  metadata?: string | null
  mediaUrl?: string | null
  feedback?: string | null
  createdAt: string
}

/** 任务卡片中的单项任务 */
export interface TaskItem {
  id: string
  title: string
  priority: string
  progress: number
  dueDate?: string | null
  important?: boolean
  status?: string
}

/** 会话列表项（与后端 /chat/sessions 返回对应） */
export interface ChatSessionItem {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  _count?: { messages: number }
}

/** 消息 metadata 结构 */
export interface MessageMetadata {
  tasks?: TaskItem[]
  amount?: number
  type?: string
  confirmed?: boolean
  confirmedCategory?: string
  mealType?: string
  completedItems?: string[]
  pendingItems?: HandoverPendingItem[]
  billsSummary?: { expense: number; income: number; count: number }
  dietsSummary?: { meals: number; totalCalories: number }
  title?: string
  autoCategory?: string
  schedule?: ScheduleData
  fragments?: FragmentItem[]
  digest?: DigestData
  connections?: ConnectionsData
  insights?: InsightsData
  preparation?: PreparationData
  crisis?: CrisisData
  weeklyReport?: {
    range: { start: string; end: string; label: string }
    finance: { income: number; expense: number; balance: number }
    stats: { doneTasks: number; dietCount: number; msgCount: number; streak: number }
  }
  portrait?: {
    month: string
    finance: { expense: number; topCategories: { name: string; total: number }[] }
    tasks: { total: number; done: number; doneRate: number }
    relation: { streak: number; msgCount: number }
  }
  office?: {
    type: 'read' | 'write' | 'export'
    fileName?: string
    docId?: string
    title?: string
    format?: string
    downloadUrl?: string
    basedOn?: string | null
    charCount?: number
    summary?: string
    error?: string
  }
  actionResult?: {
    task: { id: string; title: string; priority: string; category: string; dueDate: string | null }
    reminder: { id: string; remindAt: string; reminderMinutes: number } | null
  }
  pendingTaskCreation?: { title: string; date: string | null; wantReminder: boolean; period: string | null }
  options?: TaskOptionsData
}

/** v4: 任务创建选项卡数据 */
export interface TaskOptionsData {
  title: string
  dateLabel: string
  dateStr: string | null
  period: string | null
  timeSlots: Array<{ label: string; value: string }>
  preSelectedTime?: string
  preSelectedReminder?: string
  reminderOptions: Array<{ label: string; value: string; icon: string }>
  priorityOptions: Array<{ label: string; value: string; icon: string; color: string }>
}

/** DG-16 危机干预热线信息 */
export interface CrisisHotline { name: string; phone: string; desc: string }
/** DG-16 危机干预结果 */
export interface CrisisData { level: 'critical' | 'high' | 'moderate'; hotlines: CrisisHotline[]; message: string; suggestions: string[] }
/** DG-06 实时规划：单个时段块 */
export interface ScheduleBlock { time: string; type: 'warmup' | 'focus' | 'break' | 'routine' | 'review'; title: string; reason: string }
/** DG-07 碎片信息：单条碎片 */
export interface FragmentItem { id: string; content: string; kind: string; tags: string[]; sourceMsgId: string | null; digested: boolean; note: string | null; createdAt: string }
/** DG-08 隔夜整合类型 */
export interface DigestHighlight { id: string; content: string; createdAt: string }
export interface DigestKindGroup { kind: string; label: string; count: number; highlights: DigestHighlight[] }
export interface DigestTopTag { tag: string; count: number }
export interface DigestData { date: string; totalCount: number; byKind: DigestKindGroup[]; topTags: DigestTopTag[]; todoItems: string[]; summary: string; generatedAt: string }
/** DG-09 跨信息关联类型 */
export interface ConnectionSample { id: string; content: string; kind: string; createdAt: string }
export interface ConnectionGroup { tag: string; count: number; icon: string; suggestedAction: string; samples: ConnectionSample[] }
export interface ConnectionsData { days: number; totalCount: number; connections: ConnectionGroup[]; summary: string }
/** DG-09 跨模块洞察类型 */
export interface InsightSample { fragmentId: string; content: string; createdAt: string; suggestion: string }
export interface InsightTaskEcho { taskId: string; taskTitle: string; taskStatus: string; echoCount: number; samples: InsightSample[] }
export interface InsightsData { days: number; totalCount: number; signals: { orphanTodos: InsightSample[]; unactedIdeas: InsightSample[]; financeMentions: InsightSample[]; taskEchoes: InsightTaskEcho[] }; signalCount: number; summary: string; generatedAt: string }
/** EV-04 智能准备类型 */
export interface PreparationItem { text: string; optional?: boolean }
export interface PreparationEvent { taskId: string; title: string; dueDate: string; daysLeft: number; priority: string; important: boolean; category: string; checklist: PreparationItem[] }
export interface PreparationData { events: PreparationEvent[]; totalChecklistItems: number; summary: string; generatedAt: string }
/** DG-06 实时规划：规划结果 */
export interface ScheduleData { range: { label: string; start: string; end: string }; blocks: ScheduleBlock[]; tips: string[]; summary: string }
/** DG-10 录音纪要 */
export interface VoiceMemoDTO { id: string; title: string; duration: number; audioData?: string; audioFormat: string; transcript: string | null; todoItems: string[]; summary: string | null; status: string }