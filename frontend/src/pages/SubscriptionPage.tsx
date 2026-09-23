import { useState, useMemo, useCallback } from 'react'
import {
  CreditCard, Plus, Trash2, X, Check, Pencil, PauseCircle, PlayCircle, BellRing, AlertTriangle,
} from 'lucide-react'
import {
  listSorted, getSubStat, addSub, updateSub, deleteSub, toggleActive, markRenewed,
  CYCLE_META, EMOJI_OPTIONS, daysUntil,
  type Subscription, type BillingCycle,
} from '../lib/subscriptionStore'
import { todayStr } from '../lib/moodStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 订阅管理页
 *
 * 功能：
 * 1. 费用汇总：月均折算 / 年度成本 / 生效数
 * 2. 续费提醒：未来 30 天（含已过期），7 天内高亮
 * 3. 订阅列表：按续费日排序，支持 暂停/恢复、已续费（顺延一周期）、编辑、删除
 * 4. 新增/编辑弹窗：名称 + emoji + 费用 + 周期 + 续费日
 */

/** 续费倒计时展示 */
function renewalBadge(date: string): { text: string; cls: string } {
  const d = daysUntil(date)
  if (d < 0) return { text: `过期${-d}天`, cls: 'bg-rose-50 text-rose-600' }
  if (d === 0) return { text: '今天续费', cls: 'bg-rose-50 text-rose-600 font-semibold' }
  if (d <= 7) return { text: `${d}天后`, cls: 'bg-amber-50 text-amber-600' }
  return { text: `${d}天后`, cls: 'bg-gray-100 text-gray-400' }
}

/** 周期单价展示：每月 25 / 每年 198 */
function costLabel(sub: Subscription): string {
  return `${CYCLE_META[sub.cycle].label} ¥${sub.cost}`
}

export default function SubscriptionPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [editing, setEditing] = useState<Subscription | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const subs = useMemo(() => listSorted(), [version])
  const stat = useMemo(() => getSubStat(), [version])

  const handleRenewed = useCallback((id: string, name: string) => {
    const next = markRenewed(id)
    toast(next ? `${name} 已续费至 ${next.slice(5).replace('-', '/')}` : '操作失败', next ? 'success' : 'error')
    refresh()
  }, [toast, refresh])

  const handleToggle = useCallback((sub: Subscription) => {
    toggleActive(sub.id)
    toast(sub.active ? `${sub.name} 已暂停（不再计入统计）` : `${sub.name} 已恢复`, 'info')
    refresh()
  }, [toast, refresh])

  const handleDelete = useCallback((sub: Subscription) => {
    deleteSub(sub.id)
    toast(`已删除「${sub.name}」`, 'info')
    refresh()
  }, [toast, refresh])

  const handleSave = useCallback((data: Omit<Subscription, 'id' | 'createdAt'>, id?: string) => {
    if (id) {
      updateSub(id, data)
      toast('订阅已更新', 'success')
    } else {
      addSub(data)
      toast('订阅已添加', 'success')
    }
    setShowAdd(false)
    setEditing(null)
    refresh()
  }, [toast, refresh])

  return (
    <div className={isDesktop() ? 'desktop-content p-6' : 'app-shell'}>
      <div className={isDesktop() ? 'max-w-4xl mx-auto' : 'px-3 py-4'}>
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
              <CreditCard size={22} className="text-indigo-500" /> 订阅管理
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">管住自动续费 · 看清周期性支出</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 新增订阅
          </button>
        </div>

        {/* 费用汇总 */}
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-3 divide-x divide-gray-100 text-center">
            <div>
              <div className="text-2xl font-bold text-indigo-500 tabular-nums">
                ¥{stat.monthlyCost}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">月均支出</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800 tabular-nums">
                ¥{stat.yearlyCost}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">年度折算</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800 tabular-nums">
                {stat.activeCount}
                {stat.pausedCount > 0 && <span className="text-sm text-gray-400"> +{stat.pausedCount}停</span>}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">生效订阅</div>
            </div>
          </div>
          {stat.overdueCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600">
              <AlertTriangle size={13} /> 有 {stat.overdueCount} 项已过期，确认后点"已续费"顺延周期
            </div>
          )}
        </div>

        {/* 续费提醒（未来 30 天） */}
        {stat.upcoming.length > 0 && (
          <div className="card p-5 mb-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1.5">
                <BellRing size={14} className={stat.urgentCount > 0 ? 'text-amber-500' : 'text-gray-400'} /> 30 天内续费
              </span>
              <span className="text-xs text-gray-400">{stat.urgentCount > 0 ? `${stat.urgentCount} 项一周内` : '近期无紧急'}</span>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {stat.upcoming.map(({ sub, daysLeft }) => {
                const badge = renewalBadge(sub.nextRenewal)
                return (
                  <button
                    key={sub.id}
                    onClick={() => handleRenewed(sub.id, sub.name)}
                    className="flex-shrink-0 w-28 rounded-xl border p-3 text-left active:scale-95 transition-all"
                    style={{
                      borderColor: daysLeft < 0 ? '#FDA4AF' : daysLeft <= 7 ? '#FCD34D' : 'rgb(var(--color-accent-200))',
                      background: daysLeft < 0 ? 'rgba(244,63,94,0.06)' : daysLeft <= 7 ? 'rgba(245,158,11,0.06)' : 'transparent',
                    }}
                    title="点击标记已续费"
                  >
                    <div className="text-lg leading-none mb-1.5">{sub.emoji}</div>
                    <div className="text-xs font-medium text-gray-700 truncate">{sub.name}</div>
                    <div className="text-[10px] text-gray-400 tabular-nums">{sub.nextRenewal.slice(5).replace('-', '/')} · ¥{sub.cost}</div>
                    <span className={`inline-block mt-1.5 text-[9px] rounded-full px-1.5 py-0.5 ${badge.cls}`}>{badge.text}</span>
                  </button>
                )
              })}
            </div>
            <p className="text-[10px] text-gray-400 mt-2">点击卡片 = 已续费（自动顺延一周期）</p>
          </div>
        )}

        {/* 订阅列表 */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-medium text-gray-700">全部订阅</span>
            <span className="text-xs text-gray-400">{subs.length} 项</span>
          </div>
          {subs.length === 0 ? (
            <div className="text-center py-6">
              <div className="text-2xl mb-1.5">💳</div>
              <p className="text-xs text-gray-400 mb-3">还没有订阅记录，把视频/音乐/云盘会员加进来吧</p>
              <button
                onClick={() => setShowAdd(true)}
                className="px-4 py-2 rounded-lg bg-indigo-50 text-indigo-600 text-xs font-medium hover:bg-indigo-100 active:scale-95 transition-all"
              >
                + 添加第一个订阅
              </button>
            </div>
          ) : (
            <div className="space-y-0.5">
              {subs.map((sub) => {
                const badge = renewalBadge(sub.nextRenewal)
                return (
                  <div
                    key={sub.id}
                    className={`flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0 group ${sub.active ? '' : 'opacity-50'}`}
                  >
                    <span className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-base flex-shrink-0">
                      {sub.emoji}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-gray-800 truncate">{sub.name}</span>
                        <span className={`text-[9px] rounded-full px-1.5 py-0.5 flex-shrink-0 ${sub.active ? badge.cls : 'bg-gray-100 text-gray-400'}`}>
                          {sub.active ? badge.text : '已暂停'}
                        </span>
                      </div>
                      <div className="text-[10px] text-gray-400">
                        {costLabel(sub)} · 续费 {sub.nextRenewal.slice(5).replace('-', '/')}
                        {sub.note ? ` · ${sub.note}` : ''}
                      </div>
                    </div>
                    {/* 月均小字 */}
                    <span className="text-[11px] text-gray-400 tabular-nums w-16 text-right flex-shrink-0">
                      ¥{(sub.cost / CYCLE_META[sub.cycle].days * 30.44).toFixed(1)}/月
                    </span>
                    {/* 操作区：hover 显示 */}
                    <div className="flex items-center gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRenewed(sub.id, sub.name)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-emerald-600 hover:bg-emerald-50"
                        title="已续费（顺延一周期）"
                      >
                        <Check size={14} />
                      </button>
                      <button
                        onClick={() => handleToggle(sub)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-amber-600 hover:bg-amber-50"
                        title={sub.active ? '暂停' : '恢复'}
                      >
                        {sub.active ? <PauseCircle size={14} /> : <PlayCircle size={14} />}
                      </button>
                      <button
                        onClick={() => setEditing(sub)}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50"
                        title="编辑"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(sub)}
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
          )}
        </div>
      </div>

      {/* 新增/编辑弹窗 */}
      {(showAdd || editing) && (
        <SubModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ===== 新增/编辑弹窗 =====

const CYCLE_LIST = Object.keys(CYCLE_META) as BillingCycle[]

function SubModal({ initial, onClose, onSave }: {
  initial: Subscription | null
  onClose: () => void
  onSave: (data: Omit<Subscription, 'id' | 'createdAt'>, id?: string) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '📺')
  const [cost, setCost] = useState(initial ? String(initial.cost) : '')
  const [cycle, setCycle] = useState<BillingCycle>(initial?.cycle || 'monthly')
  const [renewal, setRenewal] = useState(initial?.nextRenewal || '')
  const [note, setNote] = useState(initial?.note || '')

  const costVal = parseFloat(cost)
  const valid = name.trim().length > 0 && Number.isFinite(costVal) && costVal > 0 && costVal <= 1000000

  const submit = () => {
    if (!valid) return
    onSave(
      {
        name: name.trim().slice(0, 20),
        emoji,
        cost: Math.round(costVal * 100) / 100,
        cycle,
        // 未填续费日 = 今天起一个周期（store 兜底）
        nextRenewal: renewal || todayStr(),
        active: initial?.active ?? true,
        note: note.trim() || undefined,
      },
      initial?.id,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[88vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">{initial ? '编辑订阅' : '新增订阅'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 + emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">名称</label>
            <div className="flex items-center gap-2">
              <span className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-lg flex-shrink-0">{emoji}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={20}
                placeholder="如：某站大会员"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400"
              />
            </div>
          </div>

          {/* emoji 选择 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">图标</label>
            <div className="grid grid-cols-10 gap-1">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-8 rounded-lg text-sm flex items-center justify-center border transition ${
                    emoji === e ? 'border-indigo-400 bg-indigo-50 scale-110' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 费用 + 周期 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-2 block">费用（元/周期）</label>
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                inputMode="decimal"
                placeholder="25"
                className={`w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-indigo-400 ${
                  cost !== '' && !(Number.isFinite(costVal) && costVal > 0) ? 'border-rose-300 text-rose-500' : 'border-gray-200'
                }`}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">周期</label>
              <div className="grid grid-cols-2 gap-1">
                {CYCLE_LIST.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCycle(c)}
                    className={`py-2 rounded-lg text-xs border transition ${
                      cycle === c ? 'border-indigo-400 bg-indigo-50 text-indigo-600 font-semibold' : 'border-gray-200 text-gray-500'
                    }`}
                  >
                    {CYCLE_META[c].label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 续费日 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">下次续费日（留空 = 今天起算一个周期）</label>
            <input
              type="date"
              value={renewal}
              onChange={(e) => setRenewal(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400"
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={50}
              placeholder="如：家庭共享 5 人"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-indigo-400"
            />
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={submit}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-indigo-500 text-white hover:bg-indigo-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
