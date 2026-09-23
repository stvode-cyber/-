/**
 * 倒计时 Mock 数据种子脚本
 *
 * 用途：本地验证倒计时功能与递减式提醒调度器是否正常工作
 *
 * 覆盖场景（共 20 条倒计时）：
 * - 4 种类型：single / recurring / important / goal
 * - 5 种循环模式：daily / weekly / monthly / yearly / custom
 * - 3 种提醒规则：decreasing / fixed / custom
 * - 7 个递减区间：over30days / 7to30days / 1to7days / last24hours / last1hour / deadline / overdue
 * - 4 种状态：active / paused / completed / cancelled
 * - 主页置顶 / 重要标记 / 里程碑链 / 完成快照
 *
 * 调度器即时验证（lastNotified=null，启动后 1 分钟内会被扫描到）：
 * - 倒计时 #4 紧急修复（12h 后截止）：应触发 last24hours 提醒
 * - 倒计时 #5 提交代码（30 分钟后截止）：应触发 last1hour 提醒
 * - 倒计时 #6 会议开始（5 分钟后截止）：应触发 deadline 提醒
 * - 倒计时 #7 逾期任务（已超期 2 小时）：应被自动标记为 completed
 * - 倒计时 #8 每日下班（nextTrigger 设为 1 分钟前）：应推进 nextTrigger 并触发循环提醒
 *
 * 用法：
 *   npm run seed:countdown          # 创建 mock 数据
 *   npm run seed:countdown:clean     # 清空所有倒计时数据
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** 时间工具（基于脚本运行时） */
const now = new Date()
const minutes = (n: number) => new Date(now.getTime() + n * 60 * 1000)
const hours = (n: number) => new Date(now.getTime() + n * 60 * 60 * 1000)
const days = (n: number) => new Date(now.getTime() + n * 24 * 60 * 60 * 1000)

/** 默认递减式提醒规则（与后端 countdown.lib.ts pickDecreasingZone 对齐） */
const defaultDecreasingRule = {
  over30days: '每周一 09:00',
  '7to30days': '每2天 09:00',
  '1to7days': '每天 09:00',
  last24hours: '每4小时',
  last1hour: '每15分钟',
}

/** 默认递减式提醒配置 */
const decreasingReminder = {
  enabled: true,
  rule: 'decreasing' as const,
  decreasingRule: defaultDecreasingRule,
}

/** 默认庆祝配置 */
const defaultCelebration = {
  enabled: true,
  style: 'confetti' as const,
  message: '🎉 你做到了！',
}

async function main() {
  console.log('⏰ 开始倒计时 Mock 数据初始化...')

  // 使用 demo 用户（与主 seed.ts 一致）
  const demo = await prisma.user.findUnique({ where: { username: 'demo' } })
  if (!demo) {
    console.error('❌ 未找到 demo 用户，请先运行: npm run seed')
    process.exit(1)
  }
  const userId = demo.id
  console.log(`  使用用户: ${demo.username} (${userId})`)

  // 先清空旧倒计时数据（避免重复）
  await prisma.countdownReminder.deleteMany({ where: { userId } })
  await prisma.countdown.deleteMany({ where: { userId } })
  console.log('  已清空旧倒计时数据')

  // ============ 1. 递减式提醒 7 区间覆盖 ============
  console.log('\n  [1] 递减式提醒 7 区间验证（lastNotified=null，调度器会立即触发提醒）')

  // 1) over30days 区间（>30天，normal 等级）
  await createCountdown({
    userId,
    type: 'single',
    title: '项目V3正式上线',
    description: '完成最终测试与发布',
    targetDate: days(35),
    isPinned: true,
    reminderConfig: decreasingReminder,
  })

  // 2) 7to30days 区间（7-30天，normal 等级）
  await createCountdown({
    userId,
    type: 'single',
    title: '客户演示准备',
    description: '15 天后向客户演示 V3 功能',
    targetDate: days(15),
    reminderConfig: decreasingReminder,
  })

  // 3) 1to7days 区间（1-7天，appropriate 等级）
  await createCountdown({
    userId,
    type: 'single',
    title: '方案评审会议',
    description: '3 天后召开方案评审',
    targetDate: days(3),
    isImportant: true,
    reminderConfig: decreasingReminder,
  })

  // 4) last24hours 区间（<24h，appropriate 等级，lastNotified=null 立即触发）
  await createCountdown({
    userId,
    type: 'single',
    title: '紧急修复上线',
    description: '12 小时后必须修复完成',
    targetDate: hours(12),
    lastNotified: null,
    reminderConfig: decreasingReminder,
  })

  // 5) last1hour 区间（<1h，urgent 等级，lastNotified=null 立即触发）
  await createCountdown({
    userId,
    type: 'single',
    title: '提交代码截止',
    description: '30 分钟后必须提交 PR',
    targetDate: minutes(30),
    lastNotified: null,
    reminderConfig: decreasingReminder,
  })

  // 6) deadline 区间（5 分钟后到截止时刻，urgent 等级）
  await createCountdown({
    userId,
    type: 'single',
    title: '会议开始倒计时',
    description: '5 分钟后会议开始',
    targetDate: minutes(5),
    lastNotified: null,
    reminderConfig: decreasingReminder,
  })

  // 7) overdue 区间（已超期 2 小时，urgent + 守护者模式）
  //    调度器扫描时应自动标记为 completed
  await createCountdown({
    userId,
    type: 'single',
    title: '逾期任务（应自动完成）',
    description: '已超期 2 小时，调度器应自动完成',
    targetDate: hours(-2),
    lastNotified: null,
    reminderConfig: decreasingReminder,
  })

  // ============ 2. 5 种循环模式覆盖 ============
  console.log('\n  [2] 循环倒计时 5 种模式验证')

  // 8) daily：每日下班倒计时（nextTrigger 设为 1 分钟前，调度器会推进并触发）
  await createCountdown({
    userId,
    type: 'recurring',
    title: '每日下班倒计时',
    description: '每天 18:00 下班',
    targetDate: null,
    recurringConfig: {
      pattern: 'daily',
      nextTrigger: minutes(-1).toISOString(), // 已过 1 分钟，调度器应推进到次日并触发提醒
    },
    reminderConfig: {
      enabled: true,
      rule: 'custom',
      customReminders: [{ daysBefore: 0, time: '17:30', level: 'appropriate' }],
    },
  })

  // 9) weekly：每周例会（下周一）
  await createCountdown({
    userId,
    type: 'recurring',
    title: '每周例会',
    description: '每周一上午 10:00',
    targetDate: null,
    recurringConfig: {
      pattern: 'weekly',
      nextTrigger: getNextMonday().toISOString(),
    },
    reminderConfig: {
      enabled: true,
      rule: 'custom',
      customReminders: [
        { daysBefore: 1, time: '09:00', level: 'normal' },
        { daysBefore: 0, time: '09:30', level: 'appropriate' },
      ],
    },
  })

  // 10) monthly：每月还款日（下月 10 号）
  await createCountdown({
    userId,
    type: 'recurring',
    title: '每月还款日',
    description: '每月 10 号还款',
    targetDate: null,
    recurringConfig: {
      pattern: 'monthly',
      nextTrigger: getNextMonthDay(10).toISOString(),
    },
    reminderConfig: {
      enabled: true,
      rule: 'custom',
      customReminders: [
        { daysBefore: 3, time: '09:00', level: 'normal' },
        { daysBefore: 1, time: '09:00', level: 'appropriate' },
        { daysBefore: 0, time: '08:00', level: 'urgent' },
      ],
    },
    linkedModules: { wishFund: 'demo-fund-001' },
  })

  // 11) yearly：生日倒计时（明年同月同日）
  await createCountdown({
    userId,
    type: 'recurring',
    title: '生日倒计时',
    description: '每年的生日',
    targetDate: null,
    recurringConfig: {
      pattern: 'yearly',
      nextTrigger: getNextYearSameDay().toISOString(),
    },
    reminderConfig: {
      enabled: true,
      rule: 'custom',
      customReminders: [
        { daysBefore: 7, time: '09:00', level: 'normal' },
        { daysBefore: 0, time: '09:00', level: 'appropriate' },
      ],
    },
    celebrationConfig: {
      enabled: true,
      style: 'fireworks',
      message: '🎂 生日快乐！',
    },
  })

  // 12) custom：自定义每周五 18:00
  await createCountdown({
    userId,
    type: 'recurring',
    title: '每周五下班',
    description: '每周五 18:00 下班',
    targetDate: null,
    recurringConfig: {
      pattern: 'custom',
      customRule: '每周五 18:00',
      nextTrigger: getNextFriday(18, 0).toISOString(),
    },
    reminderConfig: decreasingReminder,
  })

  // ============ 3. important 类型 ============
  console.log('\n  [3] important 重要日型验证')

  // 13) 见女友（7 天后，1to7days 区间）
  await createCountdown({
    userId,
    type: 'important',
    title: '见女友',
    description: '7 天后的约会',
    targetDate: days(7),
    isImportant: true,
    reminderConfig: decreasingReminder,
    celebrationConfig: {
      enabled: true,
      style: 'minimal',
      message: '今天就是期待已久的日子！',
    },
  })

  // 14) 婚礼（60 天后，over30days 区间）
  await createCountdown({
    userId,
    type: 'important',
    title: '婚礼当天',
    description: '60 天后的婚礼',
    targetDate: days(60),
    isPinned: true,
    isImportant: true,
    reminderConfig: decreasingReminder,
    celebrationConfig: {
      enabled: true,
      style: 'milestone',
      message: '💍 新婚快乐！',
    },
  })

  // ============ 4. goal 类型 + 里程碑链 ============
  console.log('\n  [4] goal 目标分化型 + 里程碑验证')

  // 15) 30 天瘦 10 斤（完整里程碑链）
  await createCountdown({
    userId,
    type: 'goal',
    title: '30 天瘦 10 斤',
    description: '每天运动 + 控制饮食',
    targetDate: days(30),
    isImportant: true,
    progress: 25, // 当前进度 25%，第一个里程碑已达成
    milestones: [
      { label: '减 2.5 斤', percentage: 25, reached: true },
      { label: '减 5 斤', percentage: 50, reached: false },
      { label: '减 7.5 斤', percentage: 75, reached: false },
      { label: '达成 10 斤', percentage: 100, reached: false },
    ],
    reminderConfig: decreasingReminder,
    celebrationConfig: {
      enabled: true,
      style: 'confetti',
      message: '🎉 减重 10 斤达成！',
    },
  })

  // 16) 100 天读书打卡（部分里程碑已达成）
  await createCountdown({
    userId,
    type: 'goal',
    title: '100 天读书打卡',
    description: '每天读 30 分钟',
    targetDate: days(100),
    progress: 35,
    milestones: [
      { label: '坚持 30 天', percentage: 30, reached: true },
      { label: '坚持 60 天', percentage: 60, reached: false },
      { label: '完成 100 天', percentage: 100, reached: false },
    ],
    reminderConfig: decreasingReminder,
    celebrationConfig: {
      enabled: true,
      style: 'fireworks',
      message: '📚 100 天读书完成！',
    },
  })

  // ============ 5. 其他状态验证 ============
  console.log('\n  [5] 其他状态（paused / completed / cancelled）验证')

  // 17) 暂停中的倒计时（不应被调度器扫描）
  await createCountdown({
    userId,
    type: 'single',
    title: '暂停中的项目',
    description: '此倒计时已暂停，调度器不应处理',
    targetDate: days(10),
    status: 'paused',
    reminderConfig: decreasingReminder,
  })

  // 18) 已完成的倒计时（带完成快照，详情页可展示回顾）
  await createCountdown({
    userId,
    type: 'single',
    title: '已完成的项目V2',
    description: 'V2 版本已上线',
    targetDate: days(-5),
    status: 'completed',
    progress: 100,
    completedAt: days(-5),
    completionSnapshot: {
      title: '已完成的项目V2',
      type: 'single',
      targetDate: days(-5).toISOString(),
      createdDate: days(-35).toISOString(),
      completedAt: days(-5).toISOString(),
      durationDays: 30,
      milestones: null,
    },
    milestones: [{ label: '完成', percentage: 100, reached: true }],
    reminderConfig: { enabled: false, rule: 'decreasing' },
  })

  // 19) 已取消的倒计时
  await createCountdown({
    userId,
    type: 'single',
    title: '已取消的需求',
    description: '需求变更，倒计时已取消',
    targetDate: days(20),
    status: 'cancelled',
    reminderConfig: { enabled: false, rule: 'decreasing' },
  })

  // ============ 6. 其他提醒规则验证 ============
  console.log('\n  [6] 其他提醒规则（fixed / custom）验证')

  // 20) 自定义提醒（custom 规则，30 天后截止，配置 30/7/1/0 天前提醒）
  await createCountdown({
    userId,
    type: 'single',
    title: '自定义提醒规则测试',
    description: '30 天后截止，自定义提醒列表',
    targetDate: days(30),
    reminderConfig: {
      enabled: true,
      rule: 'custom',
      customReminders: [
        { daysBefore: 30, time: '09:00', level: 'normal' },
        { daysBefore: 7, time: '09:00', level: 'appropriate' },
        { daysBefore: 1, time: '09:00', level: 'appropriate' },
        { daysBefore: 0, time: '08:00', level: 'urgent' },
      ],
    },
    celebrationConfig: defaultCelebration,
  })

  // 21) 固定间隔提醒（fixed 规则，仅做配置展示）
  await createCountdown({
    userId,
    type: 'single',
    title: '固定间隔提醒测试',
    description: '10 天后截止，固定间隔提醒',
    targetDate: days(10),
    reminderConfig: {
      enabled: true,
      rule: 'fixed',
    },
  })

  console.log('\n✅ 倒计时 Mock 数据初始化完成')
  console.log('\n📋 验证清单：')
  console.log('  - 倒计时列表页：访问 /countdowns 查看 19 条进行中倒计时')
  console.log('  - 主页倒计时卡片：访问 / 查看置顶与重要倒计时')
  console.log('  - 调度器即时验证（启动后端后 1 分钟内）：')
  console.log('    · 紧急修复上线 → 应生成 last24hours 提醒（appropriate 等级）')
  console.log('    · 提交代码截止 → 应生成 last1hour 提醒（urgent 等级）')
  console.log('    · 会议开始倒计时 → 应生成 deadline 提醒（urgent 等级）')
  console.log('    · 逾期任务（应自动完成）→ 应被标记为 completed')
  console.log('    · 每日下班倒计时 → 应推进 nextTrigger 并触发循环提醒')
  console.log('  - 智能建议：访问 /countdowns 点击 ✨ 查看基于任务/事件/账单的建议')
  console.log('  - 详情页里程碑：点击 "30 天瘦 10 斤" 查看里程碑链')
  console.log('  - 完成庆祝：点击任意倒计时的"完成"按钮触发庆祝动画')
  console.log('  - 提醒列表：访问 /countdowns/reminders 查看调度器生成的提醒')
  console.log('\n🔑 登录账号: demo / 123456\n')
}

// ============ 辅助函数 ============

interface CreateCountdownInput {
  userId: string
  type: 'single' | 'recurring' | 'important' | 'goal'
  title: string
  description?: string
  targetDate?: Date | null
  recurringConfig?: {
    pattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
    customRule?: string
    nextTrigger?: string
  }
  milestones?: { label: string; percentage: number; reached: boolean }[]
  reminderConfig?: {
    enabled: boolean
    rule: 'decreasing' | 'fixed' | 'custom'
    decreasingRule?: typeof defaultDecreasingRule
    customReminders?: { daysBefore: number; time: string; level: 'normal' | 'appropriate' | 'urgent' }[]
  }
  celebrationConfig?: {
    enabled: boolean
    style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
    message?: string
  }
  linkedModules?: { wishFund?: string; goalPlan?: string; importantDay?: string }
  status?: 'active' | 'paused' | 'completed' | 'cancelled'
  progress?: number
  isPinned?: boolean
  isImportant?: boolean
  lastNotified?: Date | null
  completedAt?: Date
  completionSnapshot?: Record<string, unknown>
}

async function createCountdown(input: CreateCountdownInput) {
  const data: any = {
    userId: input.userId,
    type: input.type,
    title: input.title,
    description: input.description || null,
    targetDate: input.targetDate || null,
    recurringConfig: input.recurringConfig ? JSON.stringify(input.recurringConfig) : null,
    milestones: input.milestones ? JSON.stringify(input.milestones) : null,
    reminderConfig: input.reminderConfig ? JSON.stringify(input.reminderConfig) : null,
    celebrationConfig: input.celebrationConfig ? JSON.stringify(input.celebrationConfig) : null,
    linkedModules: input.linkedModules ? JSON.stringify(input.linkedModules) : null,
    status: input.status || 'active',
    progress: input.progress || 0,
    isPinned: input.isPinned || false,
    isImportant: input.isImportant || false,
    lastNotified: input.lastNotified === undefined ? null : input.lastNotified,
    completedAt: input.completedAt || null,
    completionSnapshot: input.completionSnapshot ? JSON.stringify(input.completionSnapshot) : null,
  }
  const created = await prisma.countdown.create({ data })
  console.log(`    ✓ #${created.id.slice(-6)} ${input.title} [${input.type}]`)
  return created
}

/** 下周一 00:00 */
function getNextMonday(): Date {
  const d = new Date(now)
  const day = d.getDay()
  const diff = (8 - day) % 7 || 7
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 下月某日 00:00 */
function getNextMonthDay(day: number): Date {
  const d = new Date(now)
  d.setMonth(d.getMonth() + 1, day)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 明年同月同日 00:00 */
function getNextYearSameDay(): Date {
  const d = new Date(now)
  d.setFullYear(d.getFullYear() + 1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 下一个周五 HH:mm（若已过则下周） */
function getNextFriday(hour: number, minute: number): Date {
  const d = new Date(now)
  const day = d.getDay()
  // 周日=0，周五=5
  let diff = (5 - day + 7) % 7
  if (diff === 0) {
    // 今天就是周五：若时间已过则推到下周
    if (hour < d.getHours() || (hour === d.getHours() && minute <= d.getMinutes())) {
      diff = 7
    }
  }
  d.setDate(d.getDate() + diff)
  d.setHours(hour, minute, 0, 0)
  return d
}

main()
  .catch((e) => {
    console.error('❌ 倒计时 Mock 数据初始化失败:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
