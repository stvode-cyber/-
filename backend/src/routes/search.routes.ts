import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'

/**
 * 全局搜索路由
 *
 * 用途：跨模块聚合搜索，一次查询覆盖 11 大模块。
 *
 * 实现说明：
 * - 关键词 q 通过 Prisma `contains` 模糊匹配（大小写不敏感）
 * - 每个模块最多返回 5 条，避免结果过多
 * - 仅搜索当前用户自己的数据（社区帖子除外，按内容公开搜索）
 * - 返回结果按模块分组，前端可分 Tab 展示
 *
 * 路由清单：
 * - GET /search?q=keyword  全局聚合搜索
 * - GET /search/hot         热门搜索词（MVP 阶段返回静态推荐）
 */

const router = Router()
router.use(authRequired)

/** 每个模块返回的最大条数 */
const MAX_PER_MODULE = 5

/**
 * 全局聚合搜索
 * - q：搜索关键词（最少 1 字符）
 * - 返回 6 大模块的匹配结果
 */
router.get('/', async (req, res, next) => {
  try {
    const q = (req.query.q as string)?.trim()
    if (!q || q.length < 1) {
      throw new HttpError('请输入搜索关键词', 422)
    }
    const userId = req.user!.userId

    // 并行查询 11 大模块
    const [tasks, bills, diets, reminders, posts, handovers, fragments, voiceMemos, manualEvents, countdowns, stickyNotes] = await Promise.all([
      // 1. 任务：按标题模糊匹配
      prisma.task.findMany({
        where: { userId, title: { contains: q } },
        select: { id: true, title: true, status: true, priority: true, dueDate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 2. 账单：按标题模糊匹配
      prisma.bill.findMany({
        where: { userId, title: { contains: q } },
        select: { id: true, title: true, type: true, amount: true, category: true, billDate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 3. 饮食：按食物名称模糊匹配
      prisma.diet.findMany({
        where: { userId, foodName: { contains: q } },
        select: { id: true, foodName: true, mealType: true, calories: true, eatenAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 4. 提醒：按标题模糊匹配
      prisma.reminder.findMany({
        where: { userId, title: { contains: q } },
        select: { id: true, title: true, remindAt: true, done: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 5. 帖子：按内容模糊匹配（社区公开可见）
      prisma.post.findMany({
        where: { content: { contains: q } },
        select: { id: true, content: true, category: true, likesCount: true, commentsCount: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 6. 交接单：按标题模糊匹配
      prisma.handover.findMany({
        where: { userId, title: { contains: q } },
        select: { id: true, title: true, status: true, handoverDate: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 7. 碎片：按内容模糊匹配
      prisma.fragment.findMany({
        where: { userId, content: { contains: q } },
        select: { id: true, content: true, kind: true, tags: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 8. 语音备忘：按标题/转写文本模糊匹配
      prisma.voiceMemo.findMany({
        where: { userId, OR: [{ title: { contains: q } }, { transcript: { contains: q } }] },
        select: { id: true, title: true, duration: true, status: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 9. 手动事件：按标题/描述模糊匹配
      prisma.manualEvent.findMany({
        where: { userId, OR: [{ title: { contains: q } }, { description: { contains: q } }] },
        select: { id: true, title: true, scope: true, startTime: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 10. 倒计时：按标题模糊匹配
      prisma.countdown.findMany({
        where: { userId, title: { contains: q } },
        select: { id: true, title: true, type: true, targetDate: true, status: true, createdDate: true },
        orderBy: { createdDate: 'desc' },
        take: MAX_PER_MODULE,
      }),
      // 11. 便签：按内容模糊匹配
      prisma.stickyNote.findMany({
        where: { userId, content: { contains: q } },
        select: { id: true, content: true, color: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: MAX_PER_MODULE,
      }),
    ])

    // 统一序列化
    const results = {
      tasks: tasks.map((t) => ({
        id: t.id,
        type: 'task' as const,
        title: t.title,
        subtitle: t.status === 'done' ? '已完成' : priorityLabel(t.priority),
        status: t.status,
        dueDate: t.dueDate,
        createdAt: t.createdAt,
      })),
      bills: bills.map((b) => ({
        id: b.id,
        type: 'bill' as const,
        title: b.title,
        subtitle: `${b.type === 'income' ? '收入' : '支出'} ¥${b.amount}`,
        category: b.category,
        billDate: b.billDate,
        createdAt: b.createdAt,
      })),
      diets: diets.map((d) => ({
        id: d.id,
        type: 'diet' as const,
        title: d.foodName,
        subtitle: `${mealTypeLabel(d.mealType)} · ${d.calories || 0}kcal`,
        eatenAt: d.eatenAt,
        createdAt: d.createdAt,
      })),
      reminders: reminders.map((r) => ({
        id: r.id,
        type: 'reminder' as const,
        title: r.title,
        subtitle: r.done ? '已完成' : '待提醒',
        remindAt: r.remindAt,
        createdAt: r.createdAt,
      })),
      posts: posts.map((p) => ({
        id: p.id,
        type: 'post' as const,
        title: p.content.length > 50 ? p.content.slice(0, 50) + '...' : p.content,
        subtitle: `${categoryLabel(p.category)} · 👍${p.likesCount} 💬${p.commentsCount}`,
        content: p.content,
        createdAt: p.createdAt,
      })),
      handovers: handovers.map((h) => ({
        id: h.id,
        type: 'handover' as const,
        title: h.title,
        subtitle: handoverStatusLabel(h.status),
        handoverDate: h.handoverDate,
        createdAt: h.createdAt,
      })),
      fragments: fragments.map((f) => ({
        id: f.id,
        type: 'fragment' as const,
        title: f.content.length > 50 ? f.content.slice(0, 50) + '...' : f.content,
        subtitle: `${fragmentKindLabel(f.kind)}${f.tags ? ' · ' + f.tags : ''}`,
        content: f.content,
        createdAt: f.createdAt,
      })),
      voiceMemos: voiceMemos.map((v) => ({
        id: v.id,
        type: 'voiceMemo' as const,
        title: v.title,
        subtitle: `${Math.round(v.duration / 1000)}s · ${voiceMemoStatusLabel(v.status)}`,
        createdAt: v.createdAt,
      })),
      manualEvents: manualEvents.map((e) => ({
        id: e.id,
        type: 'manualEvent' as const,
        title: e.title,
        subtitle: `${scopeLabel(e.scope)} · ${new Date(e.startTime).toLocaleDateString('zh-CN')}`,
        startTime: e.startTime,
        createdAt: e.createdAt,
      })),
      countdowns: countdowns.map((c) => ({
        id: c.id,
        type: 'countdown' as const,
        title: c.title,
        subtitle: `${countdownTypeLabel(c.type)} · ${countdownStatusLabel(c.status)}`,
        targetDate: c.targetDate,
        createdAt: c.createdDate,
      })),
      stickyNotes: stickyNotes.map((s) => ({
        id: s.id,
        type: 'stickyNote' as const,
        title: s.content.length > 50 ? s.content.slice(0, 50) + '...' : s.content,
        subtitle: '便签',
        content: s.content,
        createdAt: s.createdAt,
      })),
    }

    // 统计总数
    const total =
      results.tasks.length + results.bills.length + results.diets.length +
      results.reminders.length + results.posts.length + results.handovers.length +
      results.fragments.length + results.voiceMemos.length + results.manualEvents.length +
      results.countdowns.length + results.stickyNotes.length

    return success(res, { results, total, q })
  } catch (e) {
    next(e)
  }
})

/**
 * 热门搜索词（MVP 阶段返回静态推荐）
 * - 前端用于无搜索历史时展示推荐词
 */
router.get('/hot', async (_req, res, next) => {
  try {
    const hot = [
      '早餐', '午餐', '晚餐',
      '工资', '房租', '微信',
      '开会', '打卡', '汇报',
      '生成交接单',
    ]
    return success(res, hot)
  } catch (e) {
    next(e)
  }
})

/** 优先级 → 中文标签 */
function priorityLabel(p: string): string {
  return { low: '低', medium: '中', high: '高', urgent: '紧急' }[p] || '中'
}

/** 餐次 → 中文标签 */
function mealTypeLabel(m: string): string {
  return { breakfast: '早餐', lunch: '午餐', dinner: '晚餐', snack: '加餐' }[m] || '加餐'
}

/** 帖子分类 → 中文标签 */
function categoryLabel(c: string): string {
  return { life: '生活', work: '工作', finance: '财务' }[c] || '生活'
}

/** 交接单状态 → 中文标签 */
function handoverStatusLabel(s: string): string {
  return { draft: '草稿', submitted: '已提交', archived: '已归档' }[s] || '草稿'
}

/** 碎片类型 → 中文标签 */
function fragmentKindLabel(k: string): string {
  return { note: '笔记', link: '链接', todo: '待办', idea: '想法', snippet: '代码片段' }[k] || '笔记'
}

/** 语音备忘状态 → 中文标签 */
function voiceMemoStatusLabel(s: string): string {
  return { uploaded: '已上传', transcribed: '已转写', extracted: '已提取', failed: '失败' }[s] || '已上传'
}

/** 事件范围 → 中文标签 */
function scopeLabel(s: string): string {
  return { work: '工作', life: '生活', finance: '财务' }[s] || '生活'
}

/** 倒计时类型 → 中文标签 */
function countdownTypeLabel(t: string): string {
  return { single: '单次', recurring: '循环', important: '重要', goal: '目标' }[t] || '单次'
}

/** 倒计时状态 → 中文标签 */
function countdownStatusLabel(s: string): string {
  return { active: '进行中', paused: '已暂停', completed: '已完成', cancelled: '已取消' }[s] || '进行中'
}

export default router
