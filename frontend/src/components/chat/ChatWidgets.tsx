import { Check, Plus, ArrowRight, Download, Eye, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { formatTime, priorityMeta } from '../../lib/utils'
import { BILL_QUICK_CATEGORIES, fragmentKindMeta } from '../../lib/constants'
import { api } from '../../lib/api'
import type { TaskItem, HandoverPendingItem, ScheduleData, ScheduleBlock, FragmentItem, DigestData, ConnectionsData, InsightSample, InsightTaskEcho, InsightsData, PreparationData, CrisisData, TaskOptionsData } from './chatTypes'
/** 消息头像：双方都用用户头像（产品红线），AI 侧加「角」角标区分 */
export function MsgAvatar({ avatar, isAi }: { avatar?: string; isAi?: boolean }) {
  const isImg = avatar && (avatar.startsWith('data:image') || avatar.startsWith('http') || avatar.startsWith('/'))
  return (
    <div className="relative w-[34px] h-[34px] rounded-[13px] flex-shrink-0 self-end mb-1 bg-primary-100 border-2 border-white shadow-md shadow-primary-500/20">
      <div className="w-full h-full rounded-[11px] overflow-hidden flex items-center justify-center text-base text-primary-700">
        {isImg ? <img src={avatar} alt="头像" className="w-full h-full object-cover" /> : <span>{avatar || '👤'}</span>}
      </div>
      {isAi && (
        <span className="absolute -right-1 -bottom-1 w-[15px] h-[15px] rounded-full bg-primary-500 border-2 border-white text-white text-[8px] flex items-center justify-center font-bold leading-none">
          角
        </span>
      )}
    </div>
  )
}

/**
 * 任务卡片
 * - 每条任务支持"完成"按钮
 * - 已完成的任务显示对勾
 */
export function TaskCard({ tasks, onDone }: { tasks: TaskItem[]; onDone: (id: string) => void }) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-primary-50 text-primary-700 text-xs font-medium">
        📋 待办列表
      </div>
      <div className="divide-y divide-gray-50">
        {tasks.map((t) => {
          const done = t.status === 'done'
          return (
            <div key={t.id} className="px-3 py-2 flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className={`text-sm ${done ? 'line-through text-gray-400' : 'text-gray-800'}`}>
                  {t.important && '🔴 '}{t.title}
                </div>
                <div className="text-xs text-gray-400 mt-0.5">
                  {t.dueDate && `截止 ${formatTime(t.dueDate)} · `}
                  进度 {t.progress}%
                </div>
              </div>
              {done ? (
                <span className="text-xs text-green-500 flex items-center gap-1">
                  <Check size={14} /> 已完成
                </span>
              ) : (
                <button
                  onClick={() => onDone(t.id)}
                  className="px-2 py-1 text-xs bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100"
                >
                  完成
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 账单卡片
 * - 点击分类按钮一键入账
 * - 入账后显示已记录提示
 */
export function BillCard({
  amount,
  type,
  confirmed,
  autoCategory,
  onConfirm,
}: {
  amount: number
  type: string
  confirmed?: boolean
  autoCategory?: string
  onConfirm: (amount: number, category: string) => void
}) {
  const categories = BILL_QUICK_CATEGORIES
  if (confirmed) {
    return (
      <div className="mt-2 bg-green-50 rounded-xl shadow-sm border border-green-100 p-3 flex items-center gap-2">
        <Check size={16} className="text-green-500" />
        <span className="text-sm text-green-700">已记录 ¥{amount.toFixed(2)}</span>
      </div>
    )
  }
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <div className="text-xs text-gray-400">识别到{type === 'expense' ? '支出' : '收入'}</div>
      <div className="text-xl font-bold text-red-500 mt-1">¥{amount.toFixed(2)}</div>
      {autoCategory && (
        <div className="mt-1 text-xs text-primary-600 flex items-center gap-1">
          <Sparkles size={10} /> AI 建议分类：{autoCategory}
        </div>
      )}
      <div className="mt-2 text-xs text-gray-500">选择分类一键入账：</div>
      <div className="mt-2 flex gap-2 flex-wrap">
        {/* AI 建议分类若不在快捷分类中，单独显示一个高亮按钮 */}
        {autoCategory && !categories.includes(autoCategory as never) && (
          <button
            onClick={() => onConfirm(amount, autoCategory)}
            className="px-3 py-1 text-xs bg-primary-500 text-white rounded-full ring-2 ring-primary-300"
          >
            {autoCategory} ✓
          </button>
        )}
        {categories.map((cat) => {
          const isSuggested = autoCategory === cat
          return (
            <button
              key={cat}
              onClick={() => onConfirm(amount, cat)}
              className={`px-3 py-1 text-xs rounded-full transition-colors ${
                isSuggested
                  ? 'bg-primary-500 text-white ring-2 ring-primary-300'
                  : 'bg-primary-50 text-primary-600 hover:bg-primary-100'
              }`}
            >
              {cat}{isSuggested ? ' ✓' : ''}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 饮食卡片
 * - 点击跳转到饮食记录页
 */
export function DietCard({ mealType, onJump }: { mealType: string; onJump: (m: string) => void }) {
  const labels: Record<string, string> = {
    breakfast: '🍳 早餐',
    lunch: '🥗 午餐',
    dinner: '🍲 晚餐',
    snack: '🍎 加餐',
  }
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 p-3">
      <div className="text-sm text-gray-700">记录{labels[mealType] || '饮食'}</div>
      <div className="mt-2 text-xs text-gray-400">点击下方按钮，前往饮食记录页填写详情</div>
      <button
        onClick={() => onJump(mealType)}
        className="mt-2 flex items-center gap-1 px-3 py-1 text-xs bg-primary-50 text-primary-600 rounded-full hover:bg-primary-100"
      >
        去记录 <ArrowRight size={12} />
      </button>
    </div>
  )
}

/**
 * 交接单生成卡
 * - 展示 AI 汇总的今日已完成事项 / 待跟进事项 / 账单 / 饮食摘要
 * - 点击"生成交接单"按钮跳转到 /handover?new=1 并通过 location.state 预填
 */
export function HandoverCard({
  completedItems,
  pendingItems,
  billsSummary,
  dietsSummary,
  onCreate,
}: {
  completedItems: string[]
  pendingItems: HandoverPendingItem[]
  billsSummary?: { expense: number; income: number; count: number }
  dietsSummary?: { meals: number; totalCalories: number }
  onCreate: (data: {
    completedItems: string[]
    pendingItems: HandoverPendingItem[]
    billsSummary?: { expense: number; income: number; count: number }
    dietsSummary?: { meals: number; totalCalories: number }
  }) => void
}) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-3 py-2 bg-teal-50 text-teal-700 text-xs font-medium">
        📋 今日数据汇总
      </div>

      <div className="p-3 space-y-3 text-sm">
        {/* 已完成事项 */}
        {completedItems.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">✓ 已完成（{completedItems.length}）</div>
            <ul className="space-y-0.5">
              {completedItems.slice(0, 5).map((item, i) => (
                <li key={i} className="text-xs text-gray-600 flex items-start gap-1">
                  <Check size={12} className="text-green-500 mt-0.5 flex-shrink-0" />
                  <span className="line-through text-gray-400">{item}</span>
                </li>
              ))}
              {completedItems.length > 5 && (
                <li className="text-xs text-gray-400">...还有 {completedItems.length - 5} 项</li>
              )}
            </ul>
          </div>
        )}

        {/* 待跟进事项 */}
        {pendingItems.length > 0 && (
          <div>
            <div className="text-xs text-gray-400 mb-1">⏳ 待跟进（{pendingItems.length}）</div>
            <ul className="space-y-1">
              {pendingItems.slice(0, 5).map((item, i) => {
                const pMeta = priorityMeta[item.priority] || priorityMeta.medium
                return (
                  <li key={i} className="flex items-center gap-1.5">
                    <span className={`badge ${pMeta.bg} ${pMeta.color} text-[10px]`}>
                      {pMeta.label}
                    </span>
                    <span className="text-xs text-gray-700 flex-1 truncate">{item.text}</span>
                  </li>
                )
              })}
              {pendingItems.length > 5 && (
                <li className="text-xs text-gray-400">...还有 {pendingItems.length - 5} 项</li>
              )}
            </ul>
          </div>
        )}

        {/* 账单摘要 */}
        {billsSummary && (
          <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded p-2">
            <span>💰 今日支出 ¥{billsSummary.expense.toFixed(2)}</span>
            {billsSummary.income > 0 && <span>· 收入 ¥{billsSummary.income.toFixed(2)}</span>}
            <span>· {billsSummary.count} 笔</span>
          </div>
        )}

        {/* 饮食摘要 */}
        {dietsSummary && (
          <div className="flex items-center gap-3 text-xs text-gray-500 bg-gray-50 rounded p-2">
            <span>🍱 {dietsSummary.meals} 餐</span>
            <span>· 🔥 {dietsSummary.totalCalories} kcal</span>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-gray-50">
        <button
          onClick={() => onCreate({ completedItems, pendingItems, billsSummary, dietsSummary })}
          className="w-full flex items-center justify-center gap-1 py-2 text-xs bg-teal-500 text-white rounded-lg hover:bg-teal-600"
        >
          <Plus size={14} /> 生成交接单 <ArrowRight size={12} />
        </button>
      </div>
    </div>
  )
}

/**
 * DG-06 实时规划：时段规划卡
 *
 * 渲染 AI 生成的时段规划，按时间顺序展示：
 * - 顶部：时段范围（label + start-end）+ 专注块数量统计
 * - 中部：时段块列表，每块含 time/type 标签/title/reason
 *   - warmup  🔍 热身回顾
 *   - focus   🎯 深度专注（核心任务）
 *   - break   ☕ 休息放松
 *   - routine 📌 常规事务（提醒）
 *   - review  ✨ 复盘总结
 * - 底部：AI 个性化提示
 */
const scheduleBlockMeta: Record<ScheduleBlock['type'], { label: string; emoji: string; color: string; bg: string; bar: string }> = {
  warmup: { label: '热身', emoji: '🔍', color: 'text-blue-600', bg: 'bg-blue-50', bar: 'bg-blue-600' },
  focus: { label: '专注', emoji: '🎯', color: 'text-purple-600', bg: 'bg-purple-50', bar: 'bg-purple-600' },
  break: { label: '休息', emoji: '☕', color: 'text-green-600', bg: 'bg-green-50', bar: 'bg-green-600' },
  routine: { label: '常规', emoji: '📌', color: 'text-orange-600', bg: 'bg-orange-50', bar: 'bg-orange-600' },
  review: { label: '复盘', emoji: '✨', color: 'text-teal-600', bg: 'bg-teal-50', bar: 'bg-teal-600' },
}

export function ScheduleCard({ schedule }: { schedule: ScheduleData }) {
  const focusCount = schedule.blocks.filter((b) => b.type === 'focus').length
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：时段范围 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📅</span>
            <span className="text-sm font-medium text-gray-800">{schedule.range.label}</span>
            <span className="text-xs text-gray-400">
              {schedule.range.start} - {schedule.range.end}
            </span>
          </div>
          <span className="text-[10px] text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">
            {focusCount} 个专注块
          </span>
        </div>
      </div>

      {/* 时段块列表 */}
      <div className="p-3 space-y-2">
        {schedule.blocks.map((block, i) => {
          const meta = scheduleBlockMeta[block.type]
          return (
            <div
              key={i}
              className={`relative pl-3 py-2 pr-2 rounded-lg ${meta.bg} border border-gray-50`}
            >
              {/* 左侧时间线 */}
              <div className={`absolute left-0 top-2 bottom-2 w-1 rounded-full ${meta.bar}`} />
              <div className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono text-gray-500">{block.time}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} bg-white border border-gray-100`}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="text-sm text-gray-800 leading-snug">{block.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{block.reason}</div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：AI 提示 */}
      {schedule.tips.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
          <div className="text-[10px] text-amber-600 font-medium mb-1">💡 个性化提示</div>
          <ul className="space-y-0.5">
            {schedule.tips.map((tip, i) => (
              <li key={i} className="text-xs text-gray-600 leading-relaxed">· {tip}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * 碎片卡片（DG-07）
 * - 展示今日已记录的碎片列表
 * - 每条碎片按 kind 显示对应配色徽章 + emoji
 * - 显示内容摘要、标签、创建时间
 * - 长内容截断显示，避免卡片过长
 */
export function FragmentCard({ fragments }: { fragments: FragmentItem[] }) {
  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 数量 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-primary-100 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🧩</span>
            <span className="text-sm font-medium text-gray-800">今日碎片</span>
            <span className="text-xs text-gray-400">{fragments.length} 条</span>
          </div>
          <span className="text-[10px] text-teal-600 bg-teal-100 px-2 py-0.5 rounded-full">
            自动分类
          </span>
        </div>
      </div>

      {/* 碎片列表 */}
      <div className="divide-y divide-gray-50 max-h-72 overflow-y-auto">
        {fragments.map((f) => {
          const meta = fragmentKindMeta[f.kind] || fragmentKindMeta.note
          const content = f.content.length > 80 ? f.content.slice(0, 80) + '…' : f.content
          const time = new Date(f.createdAt)
          const timeStr = `${String(time.getHours()).padStart(2, '0')}:${String(time.getMinutes()).padStart(2, '0')}`
          return (
            <div key={f.id} className="px-3 py-2 hover:bg-gray-50">
              <div className="flex items-start gap-2">
                <span className="text-sm flex-shrink-0 mt-0.5">{meta.emoji}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${meta.color} ${meta.bg}`}>
                      {meta.label}
                    </span>
                    <span className="text-[10px] text-gray-400 font-mono">{timeStr}</span>
                    {f.digested && (
                      <span className="text-[10px] text-purple-500 bg-purple-50 px-1 py-0.5 rounded">
                        已整合
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-gray-700 leading-snug break-words whitespace-pre-wrap">
                    {content}
                  </div>
                  {f.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {f.tags.map((tag, i) => (
                        <span
                          key={i}
                          className="text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：提示 */}
      <div className="px-3 py-1.5 bg-gray-50 border-t border-gray-100">
        <div className="text-[10px] text-gray-400">
          发送任何文字我都会自动帮你分类存储~
        </div>
      </div>
    </div>
  )
}

/**
 * 隔夜整合卡片（DG-08）
 * - 展示今日碎片的结构化总结
 * - 顶部：日期 + 总数 + 整合时间
 * - 中部：按 kind 分组的统计 + highlights
 * - 标签云：高频标签 Top 5
 * - 待跟进：todo 类型碎片列表
 * - 底部：自然语言总结
 */
export function DigestCard({ digest }: { digest: DigestData }) {
  const genTime = new Date(digest.generatedAt)
  const genTimeStr = `${String(genTime.getHours()).padStart(2, '0')}:${String(genTime.getMinutes()).padStart(2, '0')}`

  // 空整合：展示提示信息
  if (digest.totalCount === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">🌙</div>
          <div className="text-sm text-gray-600">{digest.summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">{digest.date} · {genTimeStr}</div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：日期 + 总数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🌙</span>
            <span className="text-sm font-medium text-gray-800">今日整合</span>
            <span className="text-xs text-gray-400">{digest.date}</span>
          </div>
          <span className="text-[10px] text-primary-600 bg-primary-100 px-2 py-0.5 rounded-full">
            {digest.totalCount} 条碎片
          </span>
        </div>
      </div>

      {/* 分类统计 + highlights */}
      <div className="p-3 space-y-2">
        {digest.byKind.map((group) => {
          const meta = fragmentKindMeta[group.kind] || fragmentKindMeta.note
          return (
            <div key={group.kind} className={`rounded-lg ${meta.bg} p-2 border border-gray-50`}>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm">{meta.emoji}</span>
                <span className={`text-xs font-medium ${meta.color}`}>{group.label}</span>
                <span className="text-[10px] text-gray-400">{group.count} 条</span>
              </div>
              <div className="space-y-1">
                {group.highlights.map((h) => (
                  <div key={h.id} className="text-xs text-gray-700 leading-snug pl-4 border-l-2 border-gray-200">
                    {h.content}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* 标签云 */}
      {digest.topTags.length > 0 && (
        <div className="px-3 py-2 bg-gray-50 border-t border-gray-100">
          <div className="text-[10px] text-gray-500 font-medium mb-1">🏷️ 高频标签</div>
          <div className="flex flex-wrap gap-1">
            {digest.topTags.slice(0, 5).map((t, i) => (
              <span
                key={i}
                className="text-[10px] text-indigo-600 bg-white border border-indigo-100 px-1.5 py-0.5 rounded"
              >
                #{t.tag} <span className="text-gray-400">×{t.count}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 待跟进事项 */}
      {digest.todoItems.length > 0 && (
        <div className="px-3 py-2 bg-amber-50 border-t border-amber-100">
          <div className="text-[10px] text-amber-700 font-medium mb-1">✅ 待跟进 ({digest.todoItems.length})</div>
          <ul className="space-y-0.5">
            {digest.todoItems.map((item, i) => (
              <li key={i} className="text-xs text-gray-700 leading-relaxed">· {item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* 底部：自然语言总结 */}
      <div className="px-3 py-2 bg-indigo-50 border-t border-indigo-100">
        <div className="text-xs text-gray-700 leading-relaxed">{digest.summary}</div>
        <div className="text-[10px] text-gray-400 mt-1">生成于 {genTimeStr}</div>
      </div>
    </div>
  )
}

/**
 * 跨信息关联卡片（DG-09）
 * - 展示碎片间的关联发现
 * - 顶部：时间范围 + 总数
 * - 关联组列表：每个标签关联组展示图标 + 标签 + 数量 + 建议行动 + 样本碎片
 * - 空状态：无关联时展示提示
 */
export function ConnectionsCard({ connections }: { connections: ConnectionsData }) {
  // 空状态
  if (connections.connections.length === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">🔍</div>
          <div className="text-sm text-gray-600">{connections.summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">
            最近 {connections.days} 天 · {connections.totalCount} 条碎片
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：时间范围 + 关联组数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-primary-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🔍</span>
            <span className="text-sm font-medium text-gray-800">跨信息关联</span>
            <span className="text-xs text-gray-400">最近 {connections.days} 天</span>
          </div>
          <span className="text-[10px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
            {connections.connections.length} 组关联
          </span>
        </div>
      </div>

      {/* 关联组列表 */}
      <div className="divide-y divide-gray-50">
        {connections.connections.map((group, i) => (
          <div key={i} className="px-3 py-2.5 hover:bg-gray-50">
            {/* 标签头部 */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm">{group.icon}</span>
              <span className="text-xs font-medium text-gray-800">#{group.tag}</span>
              <span className="text-[10px] text-gray-400">{group.count} 条碎片</span>
            </div>

            {/* 建议行动 */}
            <div className="text-xs text-violet-600 bg-violet-50 px-2 py-1 rounded mb-1.5">
              💡 {group.suggestedAction}
            </div>

            {/* 样本碎片 */}
            <div className="space-y-1">
              {group.samples.map((s) => {
                const meta = fragmentKindMeta[s.kind] || fragmentKindMeta.note
                return (
                  <div key={s.id} className="flex items-start gap-1.5 pl-2">
                    <span className={`text-[10px] px-1 py-0.5 rounded ${meta.color} ${meta.bg} flex-shrink-0`}>
                      {meta.label}
                    </span>
                    <div className="text-xs text-gray-600 leading-snug flex-1 min-w-0">
                      {s.content}
                    </div>
                  </div>
                )
              })}
              {group.count > group.samples.length && (
                <div className="text-[10px] text-gray-400 pl-2">
                  ...还有 {group.count - group.samples.length} 条
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-violet-50 border-t border-violet-100">
        <div className="text-xs text-gray-700 leading-relaxed">{connections.summary}</div>
        <div className="text-[10px] text-gray-400 mt-1">
          共 {connections.totalCount} 条碎片参与分析
        </div>
      </div>
    </div>
  )
}

/**
 * 跨模块洞察卡片（DG-09 进阶）
 * - 展示碎片↔任务/账单的未闭环信号
 * - 4 类信号：待办未转化 / 灵感搁置 / 金额未入账 / 任务有相关思考
 * - 每条信号含 content + suggestion，引导用户行动
 */
export function InsightsCard({ insights }: { insights: InsightsData }) {
  const { signals, summary, days, totalCount, signalCount } = insights

  // 空状态
  if (signalCount === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">✨</div>
          <div className="text-sm text-gray-600">{summary}</div>
          <div className="text-[10px] text-gray-400 mt-1">
            最近 {days} 天 · {totalCount} 条碎片
          </div>
        </div>
      </div>
    )
  }

  const signalMeta = [
    {
      key: 'orphanTodos' as const,
      label: '待办未转化',
      emoji: '📋',
      items: signals.orphanTodos,
      bg: 'bg-amber-50 border-amber-100',
    },
    {
      key: 'unactedIdeas' as const,
      label: '灵感搁置',
      emoji: '💡',
      items: signals.unactedIdeas,
      bg: 'bg-purple-50 border-purple-100',
    },
    {
      key: 'financeMentions' as const,
      label: '金额未入账',
      emoji: '💰',
      items: signals.financeMentions,
      bg: 'bg-rose-50 border-rose-100',
    },
    {
      key: 'taskEchoes' as const,
      label: '任务有相关思考',
      emoji: '🔄',
      items: signals.taskEchoes,
      bg: 'bg-blue-50 border-blue-100',
    },
  ]

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 信号数 */}
      <div className="px-3 py-2 bg-gradient-to-r from-primary-50 to-accent-50 border-b border-primary-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🔎</span>
            <span className="text-sm font-medium text-gray-800">跨模块洞察</span>
            <span className="text-xs text-gray-400">最近 {days} 天</span>
          </div>
          <span className="text-[10px] text-violet-600 bg-violet-100 px-2 py-0.5 rounded-full">
            {signalCount} 个信号
          </span>
        </div>
      </div>

      {/* 信号列表 */}
      <div className="divide-y divide-gray-50">
        {signalMeta.map((meta) => {
          if (meta.items.length === 0) return null
          return (
            <div key={meta.key} className="px-3 py-2.5">
              {/* 信号标题 */}
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-sm">{meta.emoji}</span>
                <span className="text-xs font-medium text-gray-800">{meta.label}</span>
                <span className="text-[10px] text-gray-400">{meta.items.length} 项</span>
              </div>

              {/* 信号样本 */}
              <div className="space-y-1.5">
                {meta.key === 'taskEchoes' ? (
                  (meta.items as InsightTaskEcho[]).map((echo, i) => (
                    <div key={i} className={`rounded-lg border ${meta.bg} px-2 py-1.5`}>
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-xs text-gray-700 font-medium truncate">
                          {echo.taskTitle}
                        </span>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">
                          {echo.echoCount} 条碎片
                        </span>
                      </div>
                      {echo.samples.map((s) => (
                        <div key={s.fragmentId} className="pl-2 border-l border-gray-200 mt-1">
                          <div className="text-xs text-gray-600 leading-snug">{s.content}</div>
                          <div className="text-[10px] text-gray-400 mt-0.5">{s.suggestion}</div>
                        </div>
                      ))}
                    </div>
                  ))
                ) : (
                  (meta.items as InsightSample[]).map((s) => (
                    <div key={s.fragmentId} className={`rounded-lg border ${meta.bg} px-2 py-1.5`}>
                      <div className="text-xs text-gray-700 leading-snug">{s.content}</div>
                      <div className="text-[10px] text-gray-500 mt-1">{s.suggestion}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-violet-50 border-t border-violet-100">
        <div className="text-xs text-gray-700 leading-relaxed">{summary}</div>
      </div>
    </div>
  )
}

/**
 * 智能准备卡片（EV-04）
 * - 为重要事件自动生成准备清单
 * - 顶部：事件数量 + 总准备事项数
 * - 事件列表：每个事件展示标题、倒计时、优先级、准备清单
 * - 紧迫事件高亮（24小时内红色，2天内橙色）
 * - 空状态：无重要事件时展示鼓励信息
 */
export function PreparationCard({ preparation }: { preparation: PreparationData }) {
  // 空状态
  if (preparation.events.length === 0) {
    return (
      <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-3 py-3 bg-gradient-to-r from-gray-50 to-gray-100 text-center">
          <div className="text-2xl mb-1">✨</div>
          <div className="text-sm text-gray-600">{preparation.summary}</div>
        </div>
      </div>
    )
  }

  // 倒计时配色：0-1天=红色，2天=橙色，3天=蓝色
  const getUrgencyClass = (daysLeft: number): string => {
    if (daysLeft <= 1) return 'text-red-600 bg-red-50 border-red-100'
    if (daysLeft <= 2) return 'text-orange-600 bg-orange-50 border-orange-100'
    return 'text-blue-600 bg-blue-50 border-blue-100'
  }

  const getUrgencyLabel = (daysLeft: number): string => {
    if (daysLeft === 0) return '今天'
    if (daysLeft === 1) return '明天'
    return `${daysLeft} 天后`
  }

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* 顶部：标题 + 统计 */}
      <div className="px-3 py-2 bg-gradient-to-r from-rose-50 to-orange-50 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🎯</span>
            <span className="text-sm font-medium text-gray-800">智能准备</span>
          </div>
          <span className="text-[10px] text-rose-600 bg-rose-100 px-2 py-0.5 rounded-full">
            {preparation.events.length} 事件 · {preparation.totalChecklistItems} 事项
          </span>
        </div>
      </div>

      {/* 事件列表 */}
      <div className="divide-y divide-gray-50">
        {preparation.events.map((event) => (
          <div key={event.taskId} className="px-3 py-2.5">
            {/* 事件头部 */}
            <div className="flex items-center gap-2 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  {event.important && <span className="text-xs">⭐</span>}
                  <span className="text-sm font-medium text-gray-800 truncate">{event.title}</span>
                </div>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full border ${getUrgencyClass(event.daysLeft)}`}>
                {getUrgencyLabel(event.daysLeft)}
              </span>
            </div>

            {/* 准备清单 */}
            <div className="space-y-1">
              {event.checklist.map((item, i) => (
                <div key={i} className="flex items-start gap-1.5 pl-2">
                  <span className="text-[10px] text-gray-400 mt-0.5">{i + 1}.</span>
                  <div className={`text-xs leading-snug ${item.optional ? 'text-gray-400' : 'text-gray-700'}`}>
                    {item.text}
                    {item.optional && <span className="text-[10px] text-gray-400 ml-1">(可选)</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* 底部：总结 */}
      <div className="px-3 py-2 bg-rose-50 border-t border-rose-100">
        <div className="text-xs text-gray-700 leading-relaxed">{preparation.summary}</div>
      </div>
    </div>
  )
}

/** P2 办公文档下载：axios blob（带认证）→ 前端触发保存
 * 注意：api 拦截器直接返回 response.data，blob 请求的返回值就是 Blob 本身
 */
export async function downloadOfficeDoc(docId: string, format: 'md' | 'txt' = 'md', title?: string) {
  const blob = (await api.get(`/chat/office-docs/${docId}/download`, {
    params: { format },
    responseType: 'blob',
    timeout: 30000,
  })) as unknown as Blob
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = (title || '文档').replace(/[\\/:*?"<>|\r\n]/g, '_').slice(0, 40)
  a.download = `${safeName}.${format}`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * DG-02 图片压缩：使用 Canvas 将图片缩放至最大边长并输出 JPEG data URL
 * - maxSize：最大边长（px）
 * - quality：JPEG 质量 0-1
 */
export function compressImage(file: File, maxSize: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        if (width > maxSize || height > maxSize) {
          if (width > height) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          } else {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('Canvas 上下文不可用'))
          return
        }
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/jpeg', quality))
      }
      img.onerror = () => reject(new Error('图片加载失败'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(reader.error || new Error('读取失败'))
    reader.readAsDataURL(file)
  })
}

/** 格式化文件大小 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * DG-16 危机干预卡片
 *
 * 设计原则：
 * - 醒目红色边框，立即吸引用户注意
 * - 突出热线号码，支持 tel: 直接拨号
 * - 不分析、不评价用户情绪，只引导到专业资源
 * - 移动端友好：大按钮、清晰的层级
 */
export function CrisisCard({ crisis }: { crisis: CrisisData }) {
  const levelMeta = {
    critical: { label: '紧急干预', bg: 'bg-red-50', border: 'border-red-300', text: 'text-red-700', badge: 'bg-red-500' },
    high: { label: '高度关注', bg: 'bg-orange-50', border: 'border-orange-300', text: 'text-orange-700', badge: 'bg-orange-500' },
    moderate: { label: '关怀提示', bg: 'bg-amber-50', border: 'border-amber-300', text: 'text-amber-700', badge: 'bg-amber-500' },
  }
  const meta = levelMeta[crisis.level]

  return (
    <div className={`mt-2 rounded-xl border-2 ${meta.border} ${meta.bg} overflow-hidden`}>
      {/* 头部：等级标识 */}
      <div className={`px-3 py-2 ${meta.badge} text-white flex items-center gap-2`}>
        <span className="text-base">🆘</span>
        <span className="text-sm font-medium">危机干预 · {meta.label}</span>
      </div>

      <div className="p-3 space-y-3">
        {/* 暖心文案 */}
        <div className={`text-sm ${meta.text} leading-relaxed font-medium`}>
          {crisis.message}
        </div>

        {/* 热线列表 */}
        <div className="space-y-2">
          <div className="text-xs text-gray-500 font-medium">紧急援助热线（24 小时）</div>
          {crisis.hotlines.map((h) => (
            <a
              key={h.phone}
              href={`tel:${h.phone.replace(/[^0-9+-]/g, '')}`}
              className="block bg-white rounded-lg border border-gray-200 p-2.5 hover:border-primary-400 hover:shadow-sm transition-all"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800">{h.name}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{h.desc}</div>
                </div>
                <div className="flex-shrink-0 text-right">
                  <div className="text-base font-mono font-bold text-primary-600">{h.phone}</div>
                  <div className="text-[10px] text-primary-500">点击拨号 →</div>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* 建议行动 */}
        {crisis.suggestions.length > 0 && (
          <div className="bg-white/60 rounded-lg p-2.5">
            <div className="text-xs text-gray-500 font-medium mb-1.5">建议行动</div>
            <ul className="space-y-1">
              {crisis.suggestions.map((s, i) => (
                <li key={i} className="text-xs text-gray-700 leading-relaxed flex items-start gap-1.5">
                  <span className="text-primary-500 mt-0.5">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 底部提示 */}
        <div className="text-[10px] text-gray-400 text-center pt-1 border-t border-gray-100">
          你不是一个人 · 任何时候都可以寻求帮助
        </div>
      </div>
    </div>
  )
}

/**
 * v4: 统一任务交互卡片（UnifiedTaskCard）
 *
 * 合并了「选项卡」和「创建结果卡」两种状态，用户从提到事项到创建完成
 * 全程使用同一个交互组件，体验统一。
 *
 * 两种状态：
 * - 选项状态（options 有值）：用户选择时间/提醒/优先级 → 确认创建
 * - 结果状态（actionResult 有值）：展示已创建的任务详情和提醒信息
 *
 * 支持预选：当用户已提供部分信息（如"明天下午3点开会"），后端会
 * 返回 preSelectedTime，前端自动选中对应时间槽，用户可直接确认。
 */
export function UnifiedTaskCard({
  options,
  actionResult,
  onQuickReply,
}: {
  options?: TaskOptionsData
  actionResult?: {
    task: {
      id: string
      title: string
      priority: string
      category: string
      dueDate: string | null
    }
    reminder: {
      id: string
      remindAt: string
      reminderMinutes: number
    } | null
  }
  onQuickReply?: (text: string) => void
}) {
  // ============ 结果状态：展示已创建任务 ============
  if (actionResult) {
    return <TaskResultView actionResult={actionResult} />
  }

  // ============ 选项状态：交互选择 ============
  if (options) {
    return (
      <TaskSelectionView
        options={options}
        onQuickReply={onQuickReply}
      />
    )
  }

  return null
}

/**
 * 任务创建结果视图（UnifiedTaskCard 子组件）
 * 展示已创建的任务标题、优先级、截止时间和提醒信息。
 */
export function TaskResultView({ actionResult }: {
  actionResult: {
    task: {
      id: string
      title: string
      priority: string
      category: string
      dueDate: string | null
    }
    reminder: {
      id: string
      remindAt: string
      reminderMinutes: number
    } | null
  }
}) {
  const { task, reminder } = actionResult
  const pMeta = priorityMeta[task.priority] || priorityMeta.medium

  const dueDateStr = task.dueDate
    ? new Date(task.dueDate).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '全天'

  const reminderStr = reminder
    ? new Date(reminder.remindAt).toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null

  return (
    <div className="mt-2 bg-white rounded-xl shadow-sm border border-green-200 overflow-hidden">
      <div className="px-3 py-2 bg-green-50 text-green-700 text-xs font-medium flex items-center gap-1.5">
        <Check size={14} />
        <span>已创建待办</span>
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-start gap-2">
          <div className="flex-1">
            <div className="text-sm font-medium text-gray-800">{task.title}</div>
            <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
              <span className={`px-1.5 py-0.5 rounded ${pMeta.bg} ${pMeta.color} font-medium`}>
                {pMeta.label}
              </span>
              <span>{dueDateStr}</span>
            </div>
          </div>
        </div>
        {reminder && (
          <div className="flex items-center gap-1.5 text-xs text-amber-600 bg-amber-50 rounded-lg px-2 py-1.5">
            <span>⏰</span>
            <span>提前 {reminder.reminderMinutes} 分钟提醒（{reminderStr}）</span>
          </div>
        )}
      </div>
    </div>
  )
}

/** 优先级颜色映射 */
const PRIORITY_COLOR_MAP: Record<string, { selected: string; idle: string }> = {
  blue: {
    selected: 'border-primary-400 bg-primary-50 text-primary-700 ring-1 ring-primary-200',
    idle: 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50',
  },
  amber: {
    selected: 'border-amber-400 bg-amber-50 text-amber-700 ring-1 ring-amber-200',
    idle: 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50',
  },
  red: {
    selected: 'border-red-400 bg-red-50 text-red-700 ring-1 ring-red-200',
    idle: 'border-gray-200 text-gray-600 hover:border-red-300 hover:bg-red-50',
  },
}

/**
 * 任务选项选择视图（UnifiedTaskCard 子组件）
 * 用户在此选择时间、提醒和优先级，点击确认后触发后端创建。
 */
export function TaskSelectionView({
  options,
  onQuickReply,
}: {
  options: TaskOptionsData
  onQuickReply?: (text: string) => void
}) {
  // 初始化状态：支持预选值（用户已提供时间/提醒时自动选中）
  const [selectedTime, setSelectedTime] = useState<string | null>(
    options.preSelectedTime || null
  )
  const [selectedReminder, setSelectedReminder] = useState(
    options.preSelectedReminder || '15'
  )
  const [selectedPriority, setSelectedPriority] = useState('medium')
  const [confirmed, setConfirmed] = useState(false)

  const handleConfirm = () => {
    if (!selectedTime || confirmed) return
    setConfirmed(true)

    const reminderLabel = selectedReminder === '0'
      ? '不用提醒'
      : `提前${selectedReminder}分钟`
    const priorityLabel = options.priorityOptions.find(p => p.value === selectedPriority)?.label || '普通'

    onQuickReply?.(`${selectedTime} ${reminderLabel} ${priorityLabel}`)
  }

  return (
    <div className={`mt-2 rounded-xl shadow-sm border overflow-hidden transition-opacity ${confirmed ? 'opacity-50 pointer-events-none' : 'border-primary-100'}`}>
      {/* 头部 */}
      <div className="px-3 py-2 bg-primary-50 text-primary-700 text-xs font-medium flex items-center gap-1.5">
        <Sparkles size={13} />
        <span>{options.title} · {options.dateLabel}</span>
        {options.period && (
          <span className="text-primary-400">· {options.period}</span>
        )}
      </div>

      <div className="p-3 bg-white space-y-3">
        {/* 步骤 1：时间选择（始终显示） */}
        <div>
          <div className="text-xs text-gray-500 mb-1.5 flex items-center gap-1">
            <span>🕐 选择时间</span>
            {selectedTime && <span className="text-primary-600 font-medium">· {selectedTime}</span>}
            {options.preSelectedTime && !confirmed && (
              <span className="text-xs text-primary-400">（已为你预选）</span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {options.timeSlots.map((slot) => (
              <button
                key={slot.value}
                onClick={() => setSelectedTime(slot.value)}
                className={`text-sm py-1.5 rounded-lg border transition-all ${
                  selectedTime === slot.value
                    ? 'border-primary-400 bg-primary-50 text-primary-700 font-medium ring-1 ring-primary-200'
                    : 'border-gray-200 text-gray-600 hover:border-primary-300 hover:bg-primary-50'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>
        </div>

        {/* 步骤 2：提醒设置 + 优先级 + 确认（选好时间后才显示） */}
        {selectedTime && (
          <div className="space-y-3 pt-1 border-t border-gray-100" style={{ animation: 'fadeIn 0.3s ease-in' }}>
            {/* 提醒设置 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">⏰ 提醒设置</div>
              <div className="flex flex-wrap gap-1.5">
                {options.reminderOptions.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setSelectedReminder(opt.value)}
                    className={`text-xs flex items-center gap-1 py-1 px-2.5 rounded-lg border transition-all ${
                      selectedReminder === opt.value
                        ? 'border-amber-400 bg-amber-50 text-amber-700 font-medium ring-1 ring-amber-200'
                        : 'border-gray-200 text-gray-600 hover:border-amber-300 hover:bg-amber-50'
                    }`}
                  >
                    <span>{opt.icon}</span>
                    <span>{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 优先级 */}
            <div>
              <div className="text-xs text-gray-500 mb-1.5">📋 优先级</div>
              <div className="flex gap-1.5">
                {options.priorityOptions.map((opt) => {
                  const colors = PRIORITY_COLOR_MAP[opt.color] || PRIORITY_COLOR_MAP.blue
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setSelectedPriority(opt.value)}
                      className={`text-xs flex items-center gap-1 py-1 px-2.5 rounded-lg border transition-all ${
                        selectedPriority === opt.value ? colors.selected : colors.idle
                      }`}
                    >
                      <span>{opt.icon}</span>
                      <span>{opt.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 确认按钮 */}
            <button
              onClick={handleConfirm}
              disabled={confirmed}
              className={`w-full py-2.5 rounded-lg text-sm font-medium transition-all flex items-center justify-center gap-1.5 ${
                !confirmed
                  ? 'bg-primary-500 text-white hover:bg-primary-600 active:scale-[0.98] shadow-sm'
                  : 'bg-gray-100 text-gray-400'
              }`}
            >
              {confirmed ? (
                <>
                  <Check size={15} />
                  <span>已提交</span>
                </>
              ) : (
                <>
                  <Check size={15} />
                  <span>确认创建</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
