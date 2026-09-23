import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { success, HttpError } from '../utils/response.js'
import { authRequired } from '../middleware/auth.js'

/**
 * 数据导出路由
 *
 * 用途：将用户数据导出为 CSV 或 JSON 格式，便于备份或外部分析。
 *
 * 路由清单：
 * - GET /export/modules          获取可导出的模块列表
 * - GET /export/:module?format=  导出指定模块数据（csv/json）
 * - GET /export/all?format=json  导出全部数据（仅支持 json）
 */

const router = Router()
router.use(authRequired)

/** 可导出模块配置 */
interface ExportModuleConfig {
  label: string
  description: string
}

const EXPORT_MODULES: Record<string, ExportModuleConfig> = {
  tasks: { label: '任务', description: '所有任务及状态' },
  bills: { label: '账单', description: '收支记录' },
  diets: { label: '饮食', description: '饮食记录' },
  sleeps: { label: '睡眠', description: '睡眠记录' },
  reminders: { label: '提醒', description: '提醒事项' },
  handovers: { label: '交接单', description: '工作交接记录' },
  fragments: { label: '碎片', description: '碎片笔记' },
  countdowns: { label: '倒计时', description: '倒计时目标' },
}

/**
 * 获取可导出的模块列表
 */
router.get('/modules', (_req, res, next) => {
  try {
    const modules = Object.entries(EXPORT_MODULES).map(([key, cfg]) => ({
      key,
      label: cfg.label,
      description: cfg.description,
    }))
    return success(res, { modules })
  } catch (e) {
    next(e)
  }
})

/**
 * 查询指定模块的数据
 */
async function fetchModuleData(module: string, userId: string): Promise<Record<string, unknown>[]> {
  switch (module) {
    case 'tasks':
      return prisma.task.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'bills':
      return prisma.bill.findMany({
        where: { userId },
        orderBy: { billDate: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'diets':
      return prisma.diet.findMany({
        where: { userId },
        orderBy: { eatenAt: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'sleeps':
      return prisma.sleep.findMany({
        where: { userId },
        orderBy: { sleepDate: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'reminders':
      return prisma.reminder.findMany({
        where: { userId },
        orderBy: { remindAt: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'handovers':
      return prisma.handover.findMany({
        where: { userId },
        orderBy: { handoverDate: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'fragments':
      return prisma.fragment.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    case 'countdowns':
      return prisma.countdown.findMany({
        where: { userId },
        orderBy: { createdDate: 'desc' },
      }) as Promise<Record<string, unknown>[]>
    default:
      throw new HttpError(`不支持的导出模块: ${module}`, 422)
  }
}

/**
 * 导出指定模块数据
 * - format=csv：返回 CSV 文件（Content-Type: text/csv）
 * - format=json：返回 JSON 数据（通过统一 success 包装）
 */
router.get('/:module', async (req, res, next) => {
  try {
    const module = req.params.module
    if (!EXPORT_MODULES[module]) {
      throw new HttpError(`不支持的导出模块: ${module}`, 422)
    }
    const format = (req.query.format as string) || 'json'
    const userId = req.user!.userId

    const data = await fetchModuleData(module, userId)

    if (format === 'csv') {
      const csv = toCSV(data)
      const filename = `${module}_${formatDate(new Date())}.csv`
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      // BOM 头确保 Excel 正确识别 UTF-8
      return res.send('\ufeff' + csv)
    }

    // JSON 格式走统一响应
    return success(res, { module, count: data.length, data })
  } catch (e) {
    next(e)
  }
})

/**
 * 导出全部数据（仅 JSON）
 * - 一次性返回所有可导出模块的数据
 */
router.get('/all/json', async (req, res, next) => {
  try {
    const userId = req.user!.userId
    const modules = Object.keys(EXPORT_MODULES)

    const entries = await Promise.all(
      modules.map(async (m) => [m, await fetchModuleData(m, userId)] as const)
    )

    const data: Record<string, unknown[]> = {}
    let total = 0
    for (const [m, rows] of entries) {
      data[m] = rows
      total += rows.length
    }

    return success(res, {
      exportedAt: new Date().toISOString(),
      total,
      data,
    })
  } catch (e) {
    next(e)
  }
})

/**
 * 将对象数组转换为 CSV 字符串
 * - 自动提取所有字段的并集作为表头
 * - 值中的逗号、双引号、换行符进行转义
 */
function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return ''
  // 收集所有字段（保持出现顺序）
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))]
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return ''
    let s: string
    if (val instanceof Date) {
      s = val.toISOString()
    } else if (typeof val === 'object') {
      s = JSON.stringify(val)
    } else {
      s = String(val)
    }
    // 包含逗号、双引号、换行符时用双引号包裹并转义内部双引号
    if (/[",\n\r]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const lines = [headers.join(',')]
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(','))
  }
  return lines.join('\n')
}

/** 格式化日期为 YYYYMMDD */
function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}${m}${day}`
}

export default router
