/**
 * 领域常量集中定义
 *
 * 收纳跨页面复用的分类列表、状态/班次/优先级等映射表，
 * 避免在组件文件内硬编码导致口径不一致。
 *
 * 配色规则：label 为中文标签，color/bg 为 Tailwind 类名片段。
 */

/** 账单分类（与后端 finance 路由口径一致） */
export const BILL_CATEGORIES = [
  '食物', '交通', '购物', '住房', '娱乐',
  '医疗', '教育', '工资', '其他',
] as const

/**
 * 账单快捷分类（AI 卡片一键入账用）
 * - 取最常见 4 项，减少用户选择成本
 * - 完整分类见 BILL_CATEGORIES
 */
export const BILL_QUICK_CATEGORIES = ['食物', '交通', '购物', '其他'] as const

/** 社区帖子分类 */
export const COMMUNITY_CATEGORIES = ['life', 'work', 'finance'] as const

/**
 * 社区/任务分类 → 中文标签 + 徽章配色
 *
 * 复用场景：
 * - CommunityPage 帖子分类标签
 * - AdminCommunity 帖子分类过滤器和标签
 * - TasksPage 任务分类标签
 *
 * 配色规则：color 为合并的 Tailwind 类名（bg-xxx-50 text-xxx-600）
 */
export const communityCategoryMeta: Record<string, { label: string; color: string }> = {
  life: { label: '生活', color: 'bg-green-50 text-green-600' },
  work: { label: '工作', color: 'bg-blue-50 text-blue-600' },
  finance: { label: '财务', color: 'bg-amber-50 text-amber-600' },
}

/** 审计台账分类（用于 AdminAuditLogs 过滤器，与后端 audit category 对齐） */
export const AUDIT_CATEGORIES = [
  'auth', 'task', 'diet', 'bill', 'wallet',
  'chat', 'reminder', 'community', 'handover', 'admin', 'system',
  'fragment', 'crisis', 'voice_memo',
] as const

/**
 * 审计分类 → 中文标签 + 徽章配色
 *
 * 复用场景：
 * - AdminAuditLogs 过滤器、列表徽章、占比条
 * - AdminUserDetail 用户操作记录列表
 *
 * 配色规则：color 为合并的 Tailwind 类名（bg-xxx-100 text-xxx-700）
 */
export const auditCategoryMeta: Record<string, { label: string; color: string }> = {
  auth: { label: '认证', color: 'bg-blue-100 text-blue-700' },
  task: { label: '任务', color: 'bg-purple-100 text-purple-700' },
  diet: { label: '饮食', color: 'bg-orange-100 text-orange-700' },
  bill: { label: '账单', color: 'bg-green-100 text-green-700' },
  wallet: { label: '钱包', color: 'bg-yellow-100 text-yellow-700' },
  chat: { label: '对话', color: 'bg-pink-100 text-pink-700' },
  reminder: { label: '提醒', color: 'bg-indigo-100 text-indigo-700' },
  community: { label: '社区', color: 'bg-teal-100 text-teal-700' },
  handover: { label: '交接', color: 'bg-teal-100 text-teal-700' },
  admin: { label: '管理', color: 'bg-gray-200 text-gray-700' },
  system: { label: '系统', color: 'bg-red-100 text-red-700' },
  fragment: { label: '碎片', color: 'bg-violet-100 text-violet-700' },
  crisis: { label: '危机干预', color: 'bg-red-200 text-red-800' },
  voice_memo: { label: '录音纪要', color: 'bg-accent-100 text-accent-700' },
}

/**
 * 交接单状态 → 中文标签 + 配色
 * - label：中文标签
 * - color / bg / dot：Tailwind 类名片段（UI 使用）
 */
export const handoverStatusMeta: Record<
  string,
  { label: string; color: string; bg: string; dot: string }
> = {
  draft: { label: '草稿', color: 'text-gray-600', bg: 'bg-gray-100', dot: 'bg-gray-400' },
  submitted: { label: '已提交', color: 'text-blue-600', bg: 'bg-blue-100', dot: 'bg-blue-500' },
  archived: { label: '已归档', color: 'text-green-600', bg: 'bg-green-100', dot: 'bg-green-500' },
}

/**
 * 交接单状态 → 简化配色（用于管理后台 Badge）
 * - color 为合并的 Tailwind 类名（bg-xxx-100 text-xxx-700）
 */
export const handoverStatusBadge: Record<string, { label: string; color: string }> = {
  draft: { label: '草稿', color: 'bg-gray-100 text-gray-700' },
  submitted: { label: '已提交', color: 'bg-blue-100 text-blue-700' },
  archived: { label: '已归档', color: 'bg-green-100 text-green-700' },
}

/** 班次 → 中文标签 + emoji */
export const handoverShiftMeta: Record<
  string,
  { label: string; icon: string }
> = {
  morning: { label: '早班', icon: '🌅' },
  afternoon: { label: '午班', icon: '☀️' },
  night: { label: '夜班', icon: '🌙' },
  'all-day': { label: '全天', icon: '📅' },
  custom: { label: '自定义', icon: '✏️' },
}

/**
 * 提醒等级（四级优先级） → 中文标签 + 配色
 *
 * 四级语义：
 * - urgent：闹钟级，强提醒（响铃 + 震动）
 * - proper：横幅，常规提醒（顶部横幅展示）
 * - normal：普通，列表内可见
 * - silent：静默，不打扰
 *
 * 复用场景：
 * - RemindersPage 列表徽章、等级筛选、新建弹层
 */
export const reminderLevelMeta: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  urgent: { label: '闹钟级', color: 'text-red-600 bg-red-50', dot: 'bg-red-500' },
  proper: { label: '横幅', color: 'text-blue-600 bg-blue-50', dot: 'bg-blue-500' },
  normal: { label: '普通', color: 'text-gray-600 bg-gray-50', dot: 'bg-gray-400' },
  silent: { label: '静默', color: 'text-gray-400 bg-gray-50', dot: 'bg-gray-300' },
}

/** 提醒等级列表（用于新建/筛选按钮的顺序展示） */
export const REMINDER_LEVELS = ['urgent', 'proper', 'normal', 'silent'] as const

/**
 * 睡眠质量评分 → 中文标签 + 配色 + emoji
 *
 * 评分范围 1-5：
 * - 5：极好（精力充沛）
 * - 4：良好（休息充分）
 * - 3：一般（尚可）
 * - 2：较差（有点累）
 * - 1：很差（疲惫）
 *
 * 复用场景：
 * - SleepPage 列表徽章、新建弹层评分选择
 */
export const sleepQualityMeta: Record<number, { label: string; color: string; emoji: string }> = {
  5: { label: '极好', color: 'bg-green-100 text-green-700', emoji: '😊' },
  4: { label: '良好', color: 'bg-teal-100 text-teal-700', emoji: '🙂' },
  3: { label: '一般', color: 'bg-amber-100 text-amber-700', emoji: '😐' },
  2: { label: '较差', color: 'bg-orange-100 text-orange-700', emoji: '😣' },
  1: { label: '很差', color: 'bg-red-100 text-red-700', emoji: '😫' },
}

/** 睡眠质量评分列表（从高到低，用于评分选择按钮） */
export const SLEEP_QUALITIES = [5, 4, 3, 2, 1] as const

/**
 * 实名认证等级（SA-08 Lv0-Lv5 五级体系） → 中文标签 + 配色 + 描述
 *
 * 等级递进：
 * - Lv0：未认证
 * - Lv1：基础实名（手机+邮箱绑定，自动授予，未来支持）
 * - Lv2：已实名（姓名+身份证审核通过）
 * - Lv3：企业认证（营业执照，阶段二后续）
 * - Lv4：专业资质（证书上传+核验，阶段二后续）
 * - Lv5：顶级认证（多重认证组合）
 *
 * 复用场景：
 * - VerifyPage 顶部等级展示卡
 * - ProfilePage 实名认证入口描述
 * - AdminUserDetail 用户认证等级展示
 */
export const verifyLevelMeta: Record<
  string,
  { label: string; color: string; bg: string; icon: string; desc: string }
> = {
  Lv0: { label: '未认证', color: 'text-gray-500', bg: 'bg-gray-100', icon: '⚪', desc: '提交实名信息解锁更多权益' },
  Lv1: { label: '基础实名', color: 'text-blue-600', bg: 'bg-blue-50', icon: '🔵', desc: '已绑定手机和邮箱' },
  Lv2: { label: '已实名', color: 'text-green-600', bg: 'bg-green-50', icon: '🟢', desc: '姓名和身份证已通过审核' },
  Lv3: { label: '企业认证', color: 'text-purple-600', bg: 'bg-purple-50', icon: '🟣', desc: '营业执照已核验' },
  Lv4: { label: '专业资质', color: 'text-orange-600', bg: 'bg-orange-50', icon: '🟠', desc: '专业证书已核验' },
  Lv5: { label: '顶级认证', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: '🟡', desc: '多重认证组合完成' },
}

/** 认证等级递进列表（用于等级展示顺序） */
export const VERIFY_LEVELS = ['Lv0', 'Lv1', 'Lv2', 'Lv3', 'Lv4', 'Lv5'] as const

/** 实名审核状态 → 中文标签 + 配色 */
export const verifyStatusMeta: Record<string, { label: string; color: string }> = {
  pending: { label: '审核中', color: 'text-amber-600 bg-amber-50' },
  approved: { label: '已通过', color: 'text-green-600 bg-green-50' },
  rejected: { label: '已驳回', color: 'text-red-600 bg-red-50' },
}

/**
 * 碎片信息分类（DG-07）→ 中文标签 + 配色 + emoji
 *
 * kind 含义：
 * - note：普通笔记/想法
 * - link：URL 链接
 * - todo：待办线索
 * - idea：灵感/创意
 * - snippet：代码片段/引用
 *
 * 复用场景：
 * - ChatPage FragmentCard 碎片卡片渲染
 * - FragmentPage 碎片管理页分类筛选与展示
 */
export const fragmentKindMeta: Record<
  string,
  { label: string; color: string; bg: string; emoji: string }
> = {
  note: { label: '笔记', color: 'text-gray-700', bg: 'bg-gray-50', emoji: '📝' },
  link: { label: '链接', color: 'text-blue-600', bg: 'bg-blue-50', emoji: '🔗' },
  todo: { label: '待办', color: 'text-amber-700', bg: 'bg-amber-50', emoji: '✅' },
  idea: { label: '灵感', color: 'text-purple-600', bg: 'bg-purple-50', emoji: '💡' },
  snippet: { label: '代码', color: 'text-green-700', bg: 'bg-green-50', emoji: '⌗' },
}

/** 碎片分类列表（用于筛选标签栏） */
export const FRAGMENT_KINDS = ['note', 'link', 'todo', 'idea', 'snippet'] as const

/**
 * 事件视角元数据（EV-05 / EV-06）
 *
 * - home.events.scope 字段统一使用 work | life | finance
 * - HomePage 视角切换 Tab、事件项 emoji、手动事件表单选项 均复用本表
 *
 * 字段：
 * - label：中文标签
 * - emoji：emoji 前缀
 * - color / bg：Tailwind 类名片段
 */
export const eventScopeMeta: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
  work: { label: '工作', emoji: '💼', color: 'text-blue-600', bg: 'bg-blue-50' },
  life: { label: '生活', emoji: '🌿', color: 'text-green-600', bg: 'bg-green-50' },
  finance: { label: '财务', emoji: '💰', color: 'text-amber-600', bg: 'bg-amber-50' },
}

/** 事件视角列表（手动事件表单选项 / 视角切换 Tab） */
export const EVENT_SCOPES = ['work', 'life', 'finance'] as const

/**
 * 手动事件颜色选项（EV-06 AddEventModal 颜色选择器）
 *
 * 与后端 ManualEvent.color 字段对齐，前端用作左侧色块标识。
 */
export const manualEventColorMeta: Record<string, { label: string; dot: string; chip: string }> = {
  blue: { label: '蓝色', dot: 'bg-blue-500', chip: 'bg-blue-50 text-blue-600 border-blue-200' },
  green: { label: '绿色', dot: 'bg-green-500', chip: 'bg-green-50 text-green-600 border-green-200' },
  amber: { label: '橙色', dot: 'bg-amber-500', chip: 'bg-amber-50 text-amber-600 border-amber-200' },
  purple: { label: '紫色', dot: 'bg-purple-500', chip: 'bg-purple-50 text-purple-600 border-purple-200' },
  rose: { label: '红色', dot: 'bg-rose-500', chip: 'bg-rose-50 text-rose-600 border-rose-200' },
  teal: { label: '青色', dot: 'bg-teal-500', chip: 'bg-teal-50 text-teal-600 border-teal-200' },
}

/** 手动事件颜色列表（选项顺序） */
export const MANUAL_EVENT_COLORS = ['blue', 'green', 'amber', 'purple', 'rose', 'teal'] as const

/**
 * 录音纪要状态（DG-10）→ 中文标签 + 配色 + emoji
 *
 * 状态流转：uploaded → transcribed → extracted / failed
 * - uploaded：已上传，待转写
 * - transcribed：已转写，待提取待办
 * - extracted：已提取纪要，可操作
 * - failed：转写或提取失败
 *
 * 复用场景：
 * - VoiceMemoListPage 列表状态徽章
 * - 详情页状态展示
 */
export const voiceMemoStatusMeta: Record<
  string,
  { label: string; color: string; emoji: string; desc: string }
> = {
  uploaded: { label: '已上传', color: 'bg-gray-100 text-gray-600', emoji: '📤', desc: '已上传，待转写' },
  transcribed: { label: '已转写', color: 'bg-blue-50 text-blue-600', emoji: '📝', desc: '已转写，待提取待办' },
  extracted: { label: '已提取', color: 'bg-green-50 text-green-600', emoji: '✅', desc: '已提取纪要，可操作' },
  failed: { label: '失败', color: 'bg-red-50 text-red-600', emoji: '⚠️', desc: '转写或提取失败' },
}

/** 录音纪要状态列表（用于状态筛选 Tab） */
export const VOICE_MEMO_STATUSES = ['extracted', 'transcribed', 'uploaded', 'failed'] as const

/**
 * 倒计时类型（CD-XX 倒计时功能）
 *
 * 4 种类型：
 * - single：单次目标型（项目上线、考试、纪念日）
 * - recurring：固定循环型（每日下班、每周例会、每月还款）
 * - important：重要日型（婚礼、面试、见女友）
 * - goal：目标分化型（30天瘦10斤、100天读书打卡）
 */
export const countdownTypeMeta: Record<
  string,
  { label: string; emoji: string; color: string; bg: string; desc: string }
> = {
  single: { label: '单次目标', emoji: '⏰', color: 'text-blue-600', bg: 'bg-blue-50', desc: '有明确截止日期' },
  recurring: { label: '固定循环', emoji: '🔁', color: 'text-purple-600', bg: 'bg-purple-50', desc: '按周期重复触发' },
  important: { label: '重要日', emoji: '⭐', color: 'text-amber-600', bg: 'bg-amber-50', desc: '特定情境优化事件' },
  goal: { label: '目标分化', emoji: '🎯', color: 'text-green-600', bg: 'bg-green-50', desc: '关联长期目标计划' },
}

export const COUNTDOWN_TYPES = ['single', 'recurring', 'important', 'goal'] as const

/** 倒计时状态 → 中文标签 + 配色 */
export const countdownStatusMeta: Record<
  string,
  { label: string; color: string; bg: string; dot: string }
> = {
  active: { label: '进行中', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  paused: { label: '已暂停', color: 'text-amber-600', bg: 'bg-amber-50', dot: 'bg-amber-500' },
  completed: { label: '已完成', color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500' },
  cancelled: { label: '已取消', color: 'text-gray-500', bg: 'bg-gray-50', dot: 'bg-gray-400' },
}

export const COUNTDOWN_STATUSES = ['active', 'paused', 'completed', 'cancelled'] as const

/**
 * 倒计时展示风格（基于剩余时间自动判定）
 * - normal：剩余>7天，正常颜色
 * - warning：剩余1-7天，黄色高亮
 * - urgent：剩余<24h，红色闪烁
 * - overdue：已超期，红色+标记
 * - completed：已完成，灰色+✓
 */
export const countdownStyleMeta: Record<
  string,
  { label: string; text: string; bg: string; ring: string }
> = {
  normal: { label: '正常', text: 'text-gray-600', bg: 'bg-gray-50', ring: 'ring-gray-100' },
  warning: { label: '临近', text: 'text-amber-600', bg: 'bg-amber-50', ring: 'ring-amber-200' },
  urgent: { label: '紧急', text: 'text-red-600', bg: 'bg-red-50', ring: 'ring-red-300' },
  overdue: { label: '超期', text: 'text-red-700', bg: 'bg-red-100', ring: 'ring-red-400' },
  completed: { label: '完成', text: 'text-gray-400', bg: 'bg-gray-50', ring: 'ring-gray-200' },
}

/** 循环模式 */
export const recurringPatternMeta: Record<
  string,
  { label: string; emoji: string; hint: string }
> = {
  daily: { label: '每日', emoji: '☀️', hint: '每天 00:00 重置' },
  weekly: { label: '每周', emoji: '📅', hint: '每周一 00:00 重置' },
  monthly: { label: '每月', emoji: '🗓️', hint: '每月 1 号 00:00 重置' },
  yearly: { label: '每年', emoji: '🎂', hint: '每年同月同日 00:00' },
  custom: { label: '自定义', emoji: '⚙️', hint: '自定义规则描述' },
}

export const RECURRING_PATTERNS = ['daily', 'weekly', 'monthly', 'yearly', 'custom'] as const

/** 庆祝样式 */
export const celebrationStyleMeta: Record<
  string,
  { label: string; emoji: string; desc: string }
> = {
  confetti: { label: '撒花', emoji: '🎉', desc: '全屏撒花动画 5 秒' },
  fireworks: { label: '烟花', emoji: '🎆', desc: '全屏烟花动画' },
  milestone: { label: '里程碑', emoji: '🏆', desc: '里程碑达成动画' },
  minimal: { label: '极简', emoji: '✨', desc: '简单横幅通知' },
}

export const CELEBRATION_STYLES = ['confetti', 'fireworks', 'milestone', 'minimal'] as const

/** 倒计时提醒等级（与后端 ReminderLevel 对齐） */
export const countdownReminderLevelMeta: Record<
  string,
  { label: string; color: string; dot: string }
> = {
  normal: { label: '普通', color: 'text-gray-600 bg-gray-50', dot: 'bg-gray-400' },
  appropriate: { label: '适当', color: 'text-amber-600 bg-amber-50', dot: 'bg-amber-500' },
  urgent: { label: '紧急', color: 'text-red-600 bg-red-50', dot: 'bg-red-500' },
}

export const COUNTDOWN_REMINDER_LEVELS = ['normal', 'appropriate', 'urgent'] as const

/** 递减式提醒区间（用于前端展示规则） */
export const DECREASING_ZONES = [
  { zone: 'over30days', range: '>30 天', freq: '每周一 09:00', level: '普通（静默）' },
  { zone: '7to30days', range: '7-30 天', freq: '每 2 天 09:00', level: '普通（静默）' },
  { zone: '1to7days', range: '1-7 天', freq: '每天 09:00', level: '适当（横幅）' },
  { zone: 'last24hours', range: '最后 24 小时', freq: '每 4 小时', level: '适当（横幅）' },
  { zone: 'last1hour', range: '最后 1 小时', freq: '每 15 分钟', level: '紧急（全屏）' },
  { zone: 'deadline', range: '截止时刻', freq: '1 次', level: '紧急（全屏）' },
  { zone: 'overdue', range: '截止超时', freq: '每 30 分钟', level: '紧急（守护者）' },
] as const

