import { useEffect, useState, useRef } from 'react'
import { X, Plus, Trash2, Sparkles, ChevronDown, ChevronRight } from 'lucide-react'
import { api, unwrap } from '../../lib/api'
import { useToast } from '../Toast'
import {
  COUNTDOWN_TYPES,
  countdownTypeMeta,
  RECURRING_PATTERNS,
  recurringPatternMeta,
  CELEBRATION_STYLES,
  celebrationStyleMeta,
  COUNTDOWN_REMINDER_LEVELS,
  countdownReminderLevelMeta,
  DECREASING_ZONES,
} from '../../lib/constants'

/**
 * 倒计时创建/编辑弹层
 *
 * 设计要点：
 * - 4 种类型选择：single / recurring / important / goal
 * - 循环型：选择循环模式（daily/weekly/monthly/yearly/custom）+ 自定义规则
 * - 提醒配置：递减式（默认）/ 固定间隔 / 自定义提醒列表
 * - 庆祝配置：4 种样式 + 祝福语
 * - 里程碑：可添加多个节点（label + percentage）
 *
 * 编辑模式：传入 countdown 字段时自动填充
 */

export interface CountdownFormData {
  type: 'single' | 'recurring' | 'important' | 'goal'
  title: string
  description?: string
  targetDate?: string
  recurringConfig?: {
    pattern: 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'
    customRule?: string
    /** 触发时间（HH:mm），如 "18:00"。仅 daily/weekly/monthly/yearly 有效 */
    triggerTime?: string
    /** 倒计时显示开始时间（HH:mm），如 "09:00"。未设置时默认一直显示倒计时 */
    countdownStartAt?: string
  }
  reminderConfig?: {
    enabled: boolean
    rule: 'decreasing' | 'fixed' | 'custom'
    intensity?: 'light' | 'normal' | 'strong'
    customReminders?: { daysBefore: number; time: string; level: 'normal' | 'appropriate' | 'urgent' }[]
  }
  celebrationConfig?: {
    enabled: boolean
    style: 'confetti' | 'fireworks' | 'milestone' | 'minimal'
    message?: string
  }
  isPinned?: boolean
  isImportant?: boolean
}

export interface Milestone {
  label: string
  percentage: number
  reached: boolean
}

/** 将 Date 转为 datetime-local input 接受的本地时间字符串 (YYYY-MM-DDTHH:mm) */
function formatLocalDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface Props {
  /** 编辑模式：传入现有倒计时数据；新建模式：null */
  countdown?: {
    id: string
    type: string
    title: string
    description?: string | null
    targetDate?: string | null
    recurringConfig?: { pattern: string; customRule?: string; triggerTime?: string | null; countdownStartAt?: string | null } | null
    reminderConfig?: {
      enabled: boolean
      rule: string
      intensity?: string
      customReminders?: { daysBefore: number; time: string; level: string }[]
    } | null
    celebrationConfig?: {
      enabled: boolean
      style: string
      message?: string
    } | null
  } | null
  onClose: () => void
  onSaved: () => void
}

export default function CountdownFormModal({ countdown, onClose, onSaved }: Props) {
  const toast = useToast((s) => s.show)
  const isEdit = !!countdown

  /** 目标日期快捷选项：基于当前时间偏移 */
  const QUICK_DATES: { key: string; label: string; value: () => string }[] = [
    {
      key: '1h',
      label: '1 小时后',
      value: () => {
        const d = new Date(Date.now() + 60 * 60 * 1000)
        return formatLocalDateTime(d)
      },
    },
    {
      key: 'today',
      label: '今晚 18:00',
      value: () => {
        const d = new Date()
        d.setHours(18, 0, 0, 0)
        if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '1d',
      label: '明天',
      value: () => {
        const d = new Date()
        d.setDate(d.getDate() + 1)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '3d',
      label: '3 天后',
      value: () => {
        const d = new Date()
        d.setDate(d.getDate() + 3)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '1w',
      label: '1 周后',
      value: () => {
        const d = new Date()
        d.setDate(d.getDate() + 7)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '1m',
      label: '1 月后',
      value: () => {
        const d = new Date()
        d.setMonth(d.getMonth() + 1)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '100d',
      label: '100 天后',
      value: () => {
        const d = new Date()
        d.setDate(d.getDate() + 100)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
    {
      key: '1y',
      label: '1 年后',
      value: () => {
        const d = new Date()
        d.setFullYear(d.getFullYear() + 1)
        d.setHours(9, 0, 0, 0)
        return formatLocalDateTime(d)
      },
    },
  ]

  /** 触发时间快捷选项 */
  const QUICK_TIMES: { label: string; value: string }[] = [
    { label: '00:00', value: '00:00' },
    { label: '06:00', value: '06:00' },
    { label: '09:00', value: '09:00' },
    { label: '12:00', value: '12:00' },
    { label: '14:00', value: '14:00' },
    { label: '18:00', value: '18:00' },
    { label: '21:00', value: '21:00' },
  ]

  const [type, setType] = useState<'single' | 'recurring' | 'important' | 'goal'>(
    (countdown?.type as 'single' | 'recurring' | 'important' | 'goal') || 'single',
  )
  const [title, setTitle] = useState(countdown?.title || '')
  const [description, setDescription] = useState(countdown?.description || '')
  const [targetDate, setTargetDate] = useState(() => {
    if (!countdown?.targetDate) return ''
    // 后端返回的是 ISO UTC 字符串（如 2026-08-18T10:00:00.000Z），
    // 直接 slice(0,16) 会让浏览器按本地时间解释 UTC，导致偏移 8 小时。
    // 正确做法：转成本地时间字符串再喂给 datetime-local 输入框。
    const d = new Date(countdown.targetDate)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  })
  const [pattern, setPattern] = useState<'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom'>(
    (countdown?.recurringConfig?.pattern as 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom') ||
      'daily',
  )
  const [customRule, setCustomRule] = useState(countdown?.recurringConfig?.customRule || '')
  /** 循环模式触发时间（HH:mm），仅 daily/weekly/monthly/yearly 有效；custom 用文本输入 */
  const [triggerTime, setTriggerTime] = useState(
    countdown?.recurringConfig?.triggerTime || '09:00',
  )
  /** 倒计时显示开始时间（HH:mm），留空 = 一直显示倒计时 */
  const [countdownStartAt, setCountdownStartAt] = useState(
    countdown?.recurringConfig?.countdownStartAt || '',
  )
  const [reminderEnabled, setReminderEnabled] = useState(
    countdown?.reminderConfig?.enabled ?? true,
  )
  const [reminderRule, setReminderRule] = useState<'decreasing' | 'fixed' | 'custom'>(
    (countdown?.reminderConfig?.rule as 'decreasing' | 'fixed' | 'custom') || 'decreasing',
  )
  /** 提醒强度：light=轻度 / normal=标准 / strong=强力 */
  const [reminderIntensity, setReminderIntensity] = useState<'light' | 'normal' | 'strong'>(
    (countdown?.reminderConfig?.intensity as 'light' | 'normal' | 'strong') || 'normal',
  )
  const [customReminders, setCustomReminders] = useState<
    { daysBefore: number; time: string; level: 'normal' | 'appropriate' | 'urgent' }[]
  >(
    (countdown?.reminderConfig?.customReminders as { daysBefore: number; time: string; level: 'normal' | 'appropriate' | 'urgent' }[]) ||
      [
        { daysBefore: 7, time: '09:00', level: 'appropriate' },
        { daysBefore: 1, time: '09:00', level: 'appropriate' },
        { daysBefore: 0, time: '08:00', level: 'urgent' },
      ],
  )
  const [celebrationEnabled, setCelebrationEnabled] = useState(
    countdown?.celebrationConfig?.enabled ?? true,
  )
  const [celebrationStyle, setCelebrationStyle] = useState<'confetti' | 'fireworks' | 'milestone' | 'minimal'>(
    (countdown?.celebrationConfig?.style as 'confetti' | 'fireworks' | 'milestone' | 'minimal') ||
      'confetti',
  )
  const [celebrationMessage, setCelebrationMessage] = useState(
    countdown?.celebrationConfig?.message || '',
  )
  const [isPinned, setIsPinned] = useState(false)
  const [isImportant, setIsImportant] = useState(false)
  const [loading, setLoading] = useState(false)
  /** 高级配置折叠面板：默认收起，保证一屏内完成核心设定 */
  const [showAdvanced, setShowAdvanced] = useState(false)
  /** 日期输入框 ref：点击即弹出原生日期选择器 */
  const dateInputRef = useRef<HTMLInputElement>(null)


  const submit = async () => {
    if (!title.trim()) {
      toast('请填写标题', 'error')
      return
    }
    if (type !== 'recurring' && !targetDate) {
      toast(`${countdownTypeMeta[type].label}类型必须填写目标日期`, 'error')
      return
    }
    if (type === 'recurring' && pattern === 'custom' && !customRule.trim()) {
      toast('自定义循环模式必须填写规则描述', 'error')
      return
    }

    const payload: CountdownFormData = {
      type,
      title: title.trim(),
      description: description.trim() || undefined,
      isPinned,
      isImportant,
    }
    if (type !== 'recurring' && targetDate) {
      payload.targetDate = new Date(targetDate).toISOString()
    }
    if (type === 'recurring') {
      payload.recurringConfig = {
        pattern,
        customRule: pattern === 'custom' ? customRule.trim() : undefined,
        // custom 模式 triggerTime 由文本规则解析，不单独存
        triggerTime: pattern !== 'custom' ? triggerTime : undefined,
        // 倒计时显示开始时间（留空 = 一直显示）
        countdownStartAt: countdownStartAt.trim() || undefined,
      }
    }
    if (reminderEnabled) {
      payload.reminderConfig = {
        enabled: true,
        rule: reminderRule,
        intensity: reminderIntensity,
        customReminders: reminderRule === 'custom' ? customReminders : undefined,
      }
    }
    if (celebrationEnabled) {
      payload.celebrationConfig = {
        enabled: true,
        style: celebrationStyle,
        message: celebrationMessage.trim() || undefined,
      }
    }

    setLoading(true)
    try {
      if (isEdit && countdown) {
        await unwrap(api.patch(`/countdowns/${countdown.id}`, payload))
        toast('倒计时已更新', 'success')
      } else {
        await unwrap(api.post('/countdowns', payload))
        toast('倒计时已创建', 'success')
      }
      onSaved()
      onClose()
    } catch (err) {
      toast((err as Error).message, 'error')
    } finally {
      setLoading(false)
    }
  }

  /** 添加自定义提醒项 */
  const addCustomReminder = () => {
    setCustomReminders([...customReminders, { daysBefore: 1, time: '09:00', level: 'normal' }])
  }

  /** 更新自定义提醒项 */
  const updateCustomReminder = (idx: number, patch: Partial<{ daysBefore: number; time: string; level: 'normal' | 'appropriate' | 'urgent' }>) => {
    setCustomReminders(customReminders.map((r, i) => (i === idx ? { ...r, ...patch } : r)))
  }

  /** 删除自定义提醒项 */
  const removeCustomReminder = (idx: number) => {
    setCustomReminders(customReminders.filter((_, i) => i !== idx))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative bg-white w-full max-w-[440px] mx-auto rounded-2xl p-4 animate-slide-up max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold">{isEdit ? '编辑倒计时' : '新建倒计时'}</h3>
          <button onClick={onClose} className="p-1 -mr-1 text-gray-400 hover:text-gray-600 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="space-y-3">
          {/* 类型选择 */}
          <div>
            <label className="text-xs text-gray-500">类型</label>
            <div className="grid grid-cols-4 gap-1.5 mt-1">
              {COUNTDOWN_TYPES.map((t) => {
                const meta = countdownTypeMeta[t]
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`flex flex-col items-center py-1.5 rounded-lg border ${
                      type === t ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
                    }`}
                    title={meta.desc}
                  >
                    <span className="text-base">{meta.emoji}</span>
                    <span className={`text-[11px] mt-0.5 ${type === t ? 'text-primary-600' : 'text-gray-500'}`}>
                      {meta.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* 标题 */}
          <div>
            <label className="text-xs text-gray-500">标题</label>
            <input
              autoFocus
              className="input mt-1"
              placeholder="如：iPhone 到手 / 项目上线 / 每周例会"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {/* 目标日期 + 时间（非循环型） */}
          {type !== 'recurring' && (
            <div>
              <label className="text-xs text-gray-500">目标日期与时间</label>
              <input
                ref={dateInputRef}
                type="datetime-local"
                className="input mt-1 cursor-pointer"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                onClick={(e) => {
                  // 点击输入框直接弹出原生日期选择器，无需找右侧小图标
                  try { (e.target as HTMLInputElement).showPicker?.() } catch { /* 部分浏览器不支持 */ }
                }}
                onFocus={(e) => {
                  try { e.target.showPicker?.() } catch { /* ignore */ }
                }}
              />
              {/* 快捷时间选择 */}
              <div className="flex gap-1.5 mt-2 overflow-x-auto pb-1">
                {QUICK_DATES.map((q) => (
                  <button
                    key={q.key}
                    onClick={() => setTargetDate(q.value())}
                    className="px-2.5 py-1 rounded-full text-xs bg-gray-50 text-gray-600 hover:bg-primary-50 hover:text-primary-600 whitespace-nowrap transition-colors"
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 循环配置（仅 recurring 型） */}
          {type === 'recurring' && (
            <div>
              <label className="text-xs text-gray-500">循环模式</label>
              <div className="grid grid-cols-5 gap-1 mt-1">
                {RECURRING_PATTERNS.map((p) => {
                  const meta = recurringPatternMeta[p]
                  return (
                    <button
                      key={p}
                      onClick={() => setPattern(p)}
                      className={`flex flex-col items-center py-2 rounded-lg border ${
                        pattern === p ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
                      }`}
                      title={meta.hint}
                    >
                      <span className="text-base">{meta.emoji}</span>
                      <span className={`text-xs mt-0.5 ${pattern === p ? 'text-primary-600' : 'text-gray-500'}`}>
                        {meta.label}
                      </span>
                    </button>
                  )
                })}
              </div>

              {/* 触发时间：仅非 custom 模式 */}
              {pattern !== 'custom' && (
                <div className="mt-2">
                  <label className="text-xs text-gray-500">触发时间</label>
                  <div className="flex items-center gap-2 mt-1">
                    <input
                      type="time"
                      className="input flex-1"
                      value={triggerTime}
                      onChange={(e) => setTriggerTime(e.target.value)}
                    />
                    <span className="text-xs text-gray-400 whitespace-nowrap">
                      {recurringPatternMeta[pattern].label}触发时刻
                    </span>
                  </div>
                  {/* 常用时间快捷 */}
                  <div className="flex gap-1.5 mt-1.5 overflow-x-auto">
                    {QUICK_TIMES.map((qt) => (
                      <button
                        key={qt.value}
                        onClick={() => setTriggerTime(qt.value)}
                        className={`px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap ${
                          triggerTime === qt.value
                            ? 'bg-primary-100 text-primary-600'
                            : 'bg-gray-50 text-gray-500'
                        }`}
                      >
                        {qt.label}
                      </button>
                    ))}
                  </div>

                </div>
              )}

              {/* 自定义规则：仅 custom 模式 */}
              {pattern === 'custom' && (
                <input
                  className="input mt-2"
                  placeholder='自定义规则，如"每周五 18:00" / "每月 10 号 09:00"'
                  value={customRule}
                  onChange={(e) => setCustomRule(e.target.value)}
                />
              )}
              <div className="text-xs text-gray-400 mt-1">
                {recurringPatternMeta[pattern].hint}
              </div>
            </div>
          )}

          {/* === 高级配置折叠面板：默认收起，一屏完成核心设定 === */}
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="w-full flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            <span className="text-xs font-medium text-gray-600 flex items-center gap-1.5">
              {showAdvanced ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              高级配置（提醒 · 庆祝 · 描述 · 标记）
            </span>
            <span className="text-[10px] text-gray-400">{showAdvanced ? '收起' : '展开'}</span>
          </button>

          {showAdvanced && (
            <div className="space-y-3 pt-1">
          {/* 描述（可选） */}
          <div>
            <label className="text-xs text-gray-500">描述（可选）</label>
            <input
              className="input mt-1"
              placeholder="补充说明"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {/* 提醒配置 */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">提醒配置</label>
              <button
                onClick={() => setReminderEnabled(!reminderEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${reminderEnabled ? 'bg-primary-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${reminderEnabled ? 'translate-x-5' : ''}`}
                />
              </button>
            </div>
            {reminderEnabled && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-3 gap-1">
                  {(['decreasing', 'fixed', 'custom'] as const).map((r) => (
                    <button
                      key={r}
                      onClick={() => setReminderRule(r)}
                      className={`py-1.5 rounded-lg text-xs border ${
                        reminderRule === r ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      {r === 'decreasing' ? '递减式' : r === 'fixed' ? '固定间隔' : '自定义'}
                    </button>
                  ))}
                </div>

                {/* 提醒强度 */}
                <div className="grid grid-cols-3 gap-1">
                  {([
                    { key: 'light', label: '轻度', emoji: '🔔', desc: '间隔×2' },
                    { key: 'normal', label: '标准', emoji: '🔔🔔', desc: '默认' },
                    { key: 'strong', label: '强力', emoji: '🔔🔔🔔', desc: '间隔×0.5' },
                  ] as const).map((item) => (
                    <button
                      key={item.key}
                      onClick={() => setReminderIntensity(item.key)}
                      className={`py-1.5 rounded-lg text-xs border flex flex-col items-center gap-0.5 ${
                        reminderIntensity === item.key
                          ? item.key === 'light'
                            ? 'border-blue-400 bg-blue-50 text-blue-600'
                            : item.key === 'strong'
                              ? 'border-red-400 bg-red-50 text-red-600'
                              : 'border-primary-500 bg-primary-50 text-primary-600'
                          : 'border-gray-200 text-gray-500'
                      }`}
                    >
                      <span className="text-[10px]">{item.emoji}</span>
                      <span>{item.label}</span>
                      <span className="text-[9px] opacity-60">{item.desc}</span>
                    </button>
                  ))}
                </div>

                {/* 递减式：展示规则 */}
                {reminderRule === 'decreasing' && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg p-2 text-xs text-gray-600 space-y-1">
                    <div className="flex items-center gap-1 text-amber-700 font-medium">
                      <Sparkles size={12} />
                      <span>递减式提醒规则</span>
                    </div>
                    {DECREASING_ZONES.map((z) => (
                      <div key={z.zone} className="flex justify-between">
                        <span>{z.range}</span>
                        <span className="text-gray-500">{z.freq} · {z.level}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* 自定义：可编辑列表 */}
                {reminderRule === 'custom' && (
                  <div className="space-y-2">
                    {customReminders.map((cr, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2">
                        <input
                          type="number"
                          min={0}
                          max={365}
                          value={cr.daysBefore}
                          onChange={(e) => updateCustomReminder(idx, { daysBefore: parseInt(e.target.value, 10) || 0 })}
                          className="w-12 px-1 py-1 text-xs bg-white rounded border border-gray-200 text-center"
                          inputMode="numeric"
                        />
                        <span className="text-xs text-gray-500">天前</span>
                        <input
                          type="time"
                          value={cr.time}
                          onChange={(e) => updateCustomReminder(idx, { time: e.target.value })}
                          className="px-1 py-1 text-xs bg-white rounded border border-gray-200"
                        />
                        <select
                          value={cr.level}
                          onChange={(e) => updateCustomReminder(idx, { level: e.target.value as 'normal' | 'appropriate' | 'urgent' })}
                          className="px-1 py-1 text-xs bg-white rounded border border-gray-200"
                        >
                          {COUNTDOWN_REMINDER_LEVELS.map((l) => (
                            <option key={l} value={l}>
                              {countdownReminderLevelMeta[l].label}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={() => removeCustomReminder(idx)}
                          className="ml-auto p-1 text-gray-300 hover:text-red-500 rounded"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addCustomReminder}
                      className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
                    >
                      <Plus size={12} />
                      添加提醒
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 庆祝配置 */}
          <div className="border-t border-gray-100 pt-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-500">完成庆祝</label>
              <button
                onClick={() => setCelebrationEnabled(!celebrationEnabled)}
                className={`relative w-10 h-5 rounded-full transition-colors ${celebrationEnabled ? 'bg-primary-500' : 'bg-gray-200'}`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${celebrationEnabled ? 'translate-x-5' : ''}`}
                />
              </button>
            </div>
            {celebrationEnabled && (
              <div className="mt-2 space-y-2">
                <div className="grid grid-cols-4 gap-1">
                  {CELEBRATION_STYLES.map((s) => {
                    const meta = celebrationStyleMeta[s]
                    return (
                      <button
                        key={s}
                        onClick={() => setCelebrationStyle(s)}
                        className={`flex flex-col items-center py-2 rounded-lg border ${
                          celebrationStyle === s ? 'border-primary-500 bg-primary-50' : 'border-gray-200'
                        }`}
                        title={meta.desc}
                      >
                        <span className="text-base">{meta.emoji}</span>
                        <span className={`text-xs mt-0.5 ${celebrationStyle === s ? 'text-primary-600' : 'text-gray-500'}`}>
                          {meta.label}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <input
                  className="input"
                  placeholder="祝福语（可选），如：🎉 你做到了！"
                  value={celebrationMessage}
                  onChange={(e) => setCelebrationMessage(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* 标记 */}
          <div className="flex gap-2">
            <button
              onClick={() => setIsPinned(!isPinned)}
              className={`flex-1 py-2 rounded-lg text-xs border ${
                isPinned ? 'border-primary-500 bg-primary-50 text-primary-600' : 'border-gray-200 text-gray-500'
              }`}
            >
              {isPinned ? '📌 已置顶' : '置顶主页'}
            </button>
            <button
              onClick={() => setIsImportant(!isImportant)}
              className={`flex-1 py-2 rounded-lg text-xs border ${
                isImportant ? 'border-amber-500 bg-amber-50 text-amber-600' : 'border-gray-200 text-gray-500'
              }`}
            >
              {isImportant ? '⭐ 重要' : '标记重要'}
            </button>
          </div>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} className="btn-secondary flex-1">
            取消
          </button>
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 disabled:opacity-50">
            {loading ? '保存中...' : isEdit ? '保存' : '创建'}
          </button>
        </div>

        {/* 提示文字：放在创建按钮下方 */}
        <p className="text-[11px] text-gray-400 text-center mt-2.5 leading-relaxed">
          {type === 'recurring'
            ? '填写标题并选择循环模式即可创建，高级配置可展开调整'
            : '填写标题、选择目标日期与时间即可创建，点击日期框直接弹出选择器'}
        </p>
      </div>
    </div>
  )
}
