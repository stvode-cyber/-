import { useState, useMemo, useCallback } from 'react'
import {
  Heart, Plus, Trash2, X, Check, Pencil, Cake, Sparkles, CalendarHeart,
} from 'lucide-react'
import {
  listWithNext, getAnivStat, addAniv, updateAniv, deleteAniv, groupByType,
  TYPE_META, calcNext, todayStr,
  type Anniversary, type AnniversaryType, type AnniversaryWithNext,
} from '../lib/anniversaryStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 纪念日管理页
 *
 * 布局：
 * 1. 顶部"下一个纪念日"大卡（含倒计时、年数）
 * 2. 30 天内即将到来横滑列表
 * 3. 全部列表（按距今天数升序，今天到来高亮）
 */

const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六']

/** 倒计时文字 */
function countdownText(x: AnniversaryWithNext): string {
  if (x.isToday) return '就是今天'
  if (x.daysLeft === 1) return '明天'
  return `${x.daysLeft} 天后`
}

/** 完整日期展示：8月17日 周一 */
function prettyDate(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  const wd = WEEKDAY_LABELS[new Date(date + 'T00:00:00').getDay()]
  return `${m}月${d}日 周${wd}`
}

/** 年数文案：结婚 10 周年 / 妈妈 60 岁 */
function yearsText(x: AnniversaryWithNext): string {
  const y = x.yearsCount
  if (x.anniversary.type === 'birthday') return `${y} 岁`
  if (y === 0) return '今年刚开始'
  return `${y} 周年`
}

/** 标签 + 距今天数颜色 */
function urgencyColor(daysLeft: number): string {
  if (daysLeft < 0) return '#94A3B8'
  if (daysLeft === 0) return '#EC4899'
  if (daysLeft <= 7) return '#F59E0B'
  return '#94A3B8'
}

export default function AnniversaryPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [editing, setEditing] = useState<Anniversary | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const all = useMemo(() => listWithNext(), [version])
  const stat = useMemo(() => getAnivStat(), [version])
  const groups = useMemo(() => groupByType(), [version])

  const handleSave = useCallback((data: Omit<Anniversary, 'id' | 'createdAt'>, id?: string) => {
    // 校验：日期必须是今天或过去（纪念日不能是未来）
    if (data.date > todayStr()) {
      toast('纪念日日期必须是今天或过去', 'error')
      return
    }
    if (id) {
      updateAniv(id, data)
      toast('纪念日已更新', 'success')
    } else {
      addAniv(data)
      toast('纪念日已添加 🎉', 'success')
    }
    setShowAdd(false)
    setEditing(null)
    refresh()
  }, [toast, refresh])

  const handleDelete = useCallback((aniv: Anniversary) => {
    deleteAniv(aniv.id)
    toast(`已删除「${aniv.name}」`, 'info')
    refresh()
  }, [toast, refresh])

  const nextOne = stat.nextOne
  const today = todayStr()

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <Heart size={22} className="text-pink-500" /> 纪念日
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">
              共 {stat.total} 个纪念日
              {stat.todayCount > 0 && <span className="text-pink-500 ml-1">· 今天有 {stat.todayCount} 个 🎉</span>}
              {stat.todayCount === 0 && stat.weekCount > 0 && <span className="text-amber-500 ml-1">· 7 天内 {stat.weekCount} 个</span>}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-pink-500 text-white text-sm font-medium hover:bg-pink-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 新增
          </button>
        </div>

        {/* 下一个纪念日（大卡） */}
        {nextOne ? (
          <div
            className="card p-6 mb-4 relative overflow-hidden"
            style={{ background: `linear-gradient(135deg, ${TYPE_META[nextOne.anniversary.type].color}14 0%, transparent 60%)` }}
          >
            {/* 装饰大 emoji */}
            <div className="absolute top-2 right-3 text-7xl opacity-10 select-none pointer-events-none">
              {nextOne.anniversary.emoji}
            </div>
            <div className="relative">
              <div className="text-[11px] text-gray-400 mb-1">下一个纪念日</div>
              <div className="flex items-end gap-3 mb-3">
                <span className="text-3xl">{nextOne.anniversary.emoji}</span>
                <div className="flex-1">
                  <div className="text-lg font-bold text-gray-800">{nextOne.anniversary.name}</div>
                  <div className="text-xs text-gray-500">
                    {prettyDate(nextOne.nextDate)} · {yearsText(nextOne)}
                  </div>
                </div>
              </div>
              <div className="flex items-baseline gap-2">
                <span
                  className="text-4xl font-bold tabular-nums"
                  style={{ color: urgencyColor(nextOne.daysLeft) }}
                >
                  {nextOne.isToday ? '今天' : nextOne.daysLeft}
                </span>
                {!nextOne.isToday && (
                  <span className="text-sm text-gray-400">天后</span>
                )}
              </div>
              {nextOne.anniversary.note && (
                <p className="text-[11px] text-gray-400 mt-2 italic">"{nextOne.anniversary.note}"</p>
              )}
            </div>
          </div>
        ) : (
          <div className="card p-8 mb-4 text-center">
            <CalendarHeart size={32} className="text-pink-300 mx-auto mb-2" />
            <p className="text-sm text-gray-400 mb-3">还没有纪念日记录</p>
            <p className="text-xs text-gray-400 mb-4">把生日、结婚纪念日、相识日加进来，不错过每一个重要日子</p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg bg-pink-50 text-pink-600 text-xs font-medium hover:bg-pink-100 active:scale-95 transition-all"
            >
              + 添加第一个纪念日
            </button>
          </div>
        )}

        {/* 30 天内即将到来 */}
        {stat.upcoming.length > 1 && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <Sparkles size={14} className="text-amber-400" /> 30 天内到来
              </span>
              <span className="text-xs text-gray-400">{stat.upcoming.length} 个</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stat.upcoming.map((x) => (
                <div
                  key={x.anniversary.id}
                  className="flex-shrink-0 w-24 rounded-xl border p-2.5 text-center"
                  style={{
                    borderColor: x.isToday ? '#FBCFE8' : x.daysLeft <= 7 ? '#FDE68A' : 'rgb(var(--color-accent-200))',
                    background: x.isToday ? 'rgba(236,72,153,0.08)' : x.daysLeft <= 7 ? 'rgba(245,158,11,0.06)' : 'transparent',
                  }}
                >
                  <div className="text-base leading-none mb-1">{x.anniversary.emoji}</div>
                  <div className="text-xs font-medium text-gray-700 truncate">{x.anniversary.name}</div>
                  <div className="text-[9px] text-gray-400 tabular-nums">{x.nextDate.slice(5).replace('-', '/')}</div>
                  <span
                    className="inline-block mt-1 text-[9px] rounded-full px-1.5 py-0.5 font-semibold"
                    style={{ background: `${urgencyColor(x.daysLeft)}1A`, color: urgencyColor(x.daysLeft) }}
                  >
                    {countdownText(x)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 全部列表 */}
        {all.length > 0 && (
          <div className="card p-5">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">全部纪念日</span>
              <span className="text-xs text-gray-400">{all.length} 项</span>
            </div>
            <div className="space-y-0.5">
              {all.map((x) => {
                const meta = TYPE_META[x.anniversary.type]
                return (
                  <div
                    key={x.anniversary.id}
                    className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 group"
                    style={x.isToday ? { background: 'rgba(236,72,153,0.04)', borderRadius: '8px', margin: '0 -4px', padding: '10px 12px' } : {}}
                  >
                    <span
                      className="w-9 h-9 rounded-xl flex items-center justify-center text-base flex-shrink-0"
                      style={{ background: `${meta.color}1A` }}
                    >
                      {x.anniversary.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-800 truncate">{x.anniversary.name}</span>
                        <span
                          className="text-[9px] rounded-full px-1.5 py-0.5 flex-shrink-0"
                          style={{ background: `${meta.color}14`, color: meta.color }}
                        >
                          {meta.label}
                        </span>
                        {x.isToday && (
                          <span className="text-[9px] rounded-full px-1.5 py-0.5 bg-pink-500 text-white font-semibold animate-pulse">
                            今天
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {prettyDate(x.nextDate)} · {yearsText(x)}
                        {x.anniversary.note ? ` · ${x.anniversary.note}` : ''}
                      </div>
                    </div>
                    {/* 倒计时 */}
                    <span
                      className="text-xs font-semibold tabular-nums w-14 text-right flex-shrink-0"
                      style={{ color: urgencyColor(x.daysLeft) }}
                    >
                      {countdownText(x)}
                    </span>
                    {/* 操作区 */}
                    <div className="flex items-center gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => setEditing(x.anniversary)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-pink-600 hover:bg-pink-50"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(x.anniversary)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50"
                        title="删除"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 新增/编辑弹窗 */}
      {(showAdd || editing) && (
        <AnivModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ===== 新增/编辑弹窗 =====

const TYPE_LIST = Object.keys(TYPE_META) as AnniversaryType[]
const EMOJI_OPTIONS = ['🎂', '🎁', '💍', '❤️', '🌹', '🤝', '🎉', '✨', '🕊️', '🌸', '🎈', '💐', '🍰', '🎊', '💝', '🌙']

function AnivModal({ initial, onClose, onSave }: {
  initial: Anniversary | null
  onClose: () => void
  onSave: (data: Omit<Anniversary, 'id' | 'createdAt'>, id?: string) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '🎂')
  const [date, setDate] = useState(initial?.date || '')
  const [type, setType] = useState<AnniversaryType>(initial?.type || 'birthday')
  const [note, setNote] = useState(initial?.note || '')

  const valid = name.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayStr()

  const submit = () => {
    if (!valid) return
    onSave(
      {
        name: name.trim().slice(0, 20),
        emoji,
        date,
        type,
        note: note.trim() || undefined,
      },
      initial?.id,
    )
  }

  // 类型切换时同步默认 emoji
  const handleTypeChange = (t: AnniversaryType) => {
    setType(t)
    if (!initial || emoji === TYPE_META[initial.type].defaultEmoji) {
      setEmoji(TYPE_META[t].defaultEmoji)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">{initial ? '编辑纪念日' : '新增纪念日'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 + emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">名称</label>
            <div className="flex items-center gap-2">
              <span className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center text-lg flex-shrink-0">{emoji}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="如：妈妈、我们的婚礼"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-pink-400"
              />
            </div>
          </div>

          {/* 类型 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">类型</label>
            <div className="grid grid-cols-3 gap-1.5">
              {TYPE_LIST.map((t) => (
                <button
                  key={t}
                  onClick={() => handleTypeChange(t)}
                  className={`py-2 rounded-lg text-xs border transition ${
                    type === t ? 'border-pink-400 bg-pink-50 text-pink-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>

          {/* emoji 选择 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">图标</label>
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-8 rounded-lg text-sm flex items-center justify-center border transition ${
                    emoji === e ? 'border-pink-400 bg-pink-50 scale-110' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 日期 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">日期（必须为今天或过去）</label>
            <input
              type="date"
              value={date}
              max={todayStr()}
              onChange={(e) => setDate(e.target.value)}
              className={`w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-pink-400 ${
                date !== '' && date > todayStr() ? 'border-rose-300 text-rose-500' : 'border-gray-200'
              }`}
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={50}
              placeholder="如：家庭聚会、浪漫晚餐"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-pink-400"
            />
          </div>

          {/* 预览：纪念日年数 */}
          {valid && (
            <div className="rounded-lg bg-pink-50 px-3 py-2 text-[11px] text-pink-600">
              {(() => {
                const preview: Anniversary = {
                  id: 'preview', name, emoji, date, type, note: note.trim() || undefined, createdAt: 0,
                }
                const next = calcNext(preview)
                return `${next.yearsCount === 0 ? '今年刚开始' : `第 ${next.yearsCount} 个${type === 'birthday' ? '生日' : '周年'}`}，下次 ${prettyDate(next.nextDate)}，${countdownText(next)}`
              })()}
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-pink-500 text-white hover:bg-pink-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
