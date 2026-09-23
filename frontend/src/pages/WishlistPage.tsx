import { useState, useMemo, useCallback } from 'react'
import {
  Gift, Plus, Trash2, X, Check, Pencil, ShoppingCart, PiggyBank, ChevronRight, Link as LinkIcon,
} from 'lucide-react'
import {
  groupByStatus, getWishStat, addWish, updateWish, deleteWish, advanceStatus,
  STATUS_META, PRIORITY_META, CATEGORY_META, EMOJI_OPTIONS, spendingByCategory,
  type WishItem, type WishStatus, type WishPriority, type WishCategory,
} from '../lib/wishlistStore'
import { useToast } from '../components/Toast'
import { isDesktop } from '../lib/localCache'

/**
 * 愿望清单页
 *
 * 布局：
 * 1. 费用汇总：待购总额 / 已购支出 / 本月已购
 * 2. 状态分组列表：种草→决定→攒钱→已买（点击卡片推进状态）
 * 3. 支出分类（已购项按分类汇总）
 */

/** 状态流转向下一步的文案 */
function nextActionText(status: WishStatus): string {
  switch (status) {
    case 'considering': return '决定要买'
    case 'decided': return '开始攒钱'
    case 'saving': return '已购买'
    case 'purchased': return '退回种草'
  }
}

export default function WishlistPage() {
  const toast = useToast((s) => s.show)
  const [version, setVersion] = useState(0)
  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  const [editing, setEditing] = useState<WishItem | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [purchasingId, setPurchasingId] = useState<string | null>(null)

  const groups = useMemo(() => groupByStatus(), [version])
  const stat = useMemo(() => getWishStat(), [version])
  const categorySpending = useMemo(() => spendingByCategory(), [version])

  const handleAdvance = useCallback((item: WishItem) => {
    if (item.status === 'saving') {
      // 攒钱 → 已买，需要填写实付价格
      setPurchasingId(item.id)
      return
    }
    const next = advanceStatus(item.id)
    if (next) {
      toast(`${item.name} → ${STATUS_META[next].label} ${STATUS_META[next].emoji}`, 'info')
      refresh()
    }
  }, [toast, refresh])

  const handlePurchase = useCallback((item: WishItem, actualPrice: number) => {
    updateWish(item.id, { status: 'purchased', actualPrice, purchasedAt: Date.now() })
    toast(`${item.name} 已标记为购买 🎉`, 'success')
    setPurchasingId(null)
    refresh()
  }, [toast, refresh])

  const handleDelete = useCallback((item: WishItem) => {
    deleteWish(item.id)
    toast(`已删除「${item.name}」`, 'info')
    refresh()
  }, [toast, refresh])

  const handleSave = useCallback((data: Omit<WishItem, 'id' | 'createdAt'>, id?: string) => {
    if (id) {
      updateWish(id, data)
      toast('愿望已更新', 'success')
    } else {
      addWish(data)
      toast('愿望已添加 🌱', 'success')
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
              <Gift size={22} className="text-violet-500" /> 愿望清单
            </h1>
            <p className="text-xs text-gray-400 mt-0.5">种草 → 决定 → 攒钱 → 已买</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 rounded-lg bg-violet-500 text-white text-sm font-medium hover:bg-violet-600 active:scale-95 transition-all flex items-center gap-1"
          >
            <Plus size={15} /> 新增
          </button>
        </div>

        {/* 费用汇总 */}
        <div className="card p-5 mb-4">
          <div className="grid grid-cols-3 divide-x divide-gray-100 text-center">
            <div>
              <div className="text-2xl font-bold text-violet-500 tabular-nums">¥{stat.pendingCost}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">待购预算</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-500 tabular-nums">¥{stat.spentCost}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">已购支出</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-gray-800 tabular-nums">{stat.purchasedThisMonth}</div>
              <div className="text-[11px] text-gray-400 mt-0.5">本月已购</div>
            </div>
          </div>
          {stat.savingCount > 0 && (
            <div className="mt-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-600">
              <PiggyBank size={13} /> 有 {stat.savingCount} 项正在攒钱，合计 ¥{stat.pendingCost}
            </div>
          )}
        </div>

        {/* 状态分组列表 */}
        {groups.length === 0 ? (
          <div className="card p-8 text-center">
            <div className="text-2xl mb-1.5">🎁</div>
            <p className="text-xs text-gray-400 mb-3">还没有愿望，把想买的东西加进来吧</p>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 rounded-lg bg-violet-50 text-violet-600 text-xs font-medium hover:bg-violet-100 active:scale-95 transition-all"
            >
              + 添加第一个愿望
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {groups.map((group) => {
              const meta = STATUS_META[group.status]
              return (
                <div key={group.status} className="card p-5">
                  {/* 组标题 */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span
                        className="w-7 h-7 rounded-lg flex items-center justify-center text-sm"
                        style={{ background: `${meta.color}1A` }}
                      >
                        {meta.emoji}
                      </span>
                      <span className="text-sm font-semibold" style={{ color: meta.color }}>{meta.label}</span>
                      <span className="text-xs text-gray-400">({group.items.length})</span>
                    </div>
                    {group.status !== 'purchased' && (
                      <span className="text-[10px] text-gray-400">点击卡片推进状态 →</span>
                    )}
                  </div>

                  {/* 组内项目 */}
                  <div className="space-y-1.5">
                    {group.items.map((item) => {
                      const pmeta = PRIORITY_META[item.priority]
                      const cmeta = CATEGORY_META[item.category]
                      const price = item.status === 'purchased' ? (item.actualPrice ?? item.estimatedPrice) : item.estimatedPrice
                      return (
                        <div
                          key={item.id}
                          className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 group hover:border-gray-200 transition-colors"
                          style={item.status === 'purchased' ? { opacity: 0.7 } : {}}
                        >
                          {/* emoji */}
                          <span className="w-9 h-9 rounded-xl bg-violet-50 flex items-center justify-center text-base flex-shrink-0">
                            {item.emoji}
                          </span>
                          {/* 信息 */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm font-medium text-gray-800 truncate">{item.name}</span>
                              <span
                                className="text-[9px] rounded-full px-1.5 py-0.5 flex-shrink-0"
                                style={{ background: `${pmeta.color}1A`, color: pmeta.color }}
                              >
                                {pmeta.label}
                              </span>
                            </div>
                            <div className="text-[10px] text-gray-400 flex items-center gap-1.5">
                              <span>{cmeta.emoji} {cmeta.label}</span>
                              <span>·</span>
                              <span className="tabular-nums">{item.status === 'purchased' ? '实付' : '预算'} ¥{price}</span>
                              {item.note && <><span>·</span><span className="truncate">{item.note}</span></>}
                            </div>
                          </div>
                          {/* 链接 */}
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1.5 rounded-lg text-gray-300 hover:text-violet-500 hover:bg-violet-50 flex-shrink-0"
                              title="打开链接"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <LinkIcon size={13} />
                            </a>
                          )}
                          {/* 推进按钮 */}
                          {item.status !== 'purchased' && (
                            <button
                              onClick={() => handleAdvance(item)}
                              className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium flex items-center gap-0.5 flex-shrink-0 transition-colors"
                              style={{ background: `${meta.color}14`, color: meta.color }}
                              title={nextActionText(item.status)}
                            >
                              <ChevronRight size={12} /> {nextActionText(item.status).slice(0, 2)}
                            </button>
                          )}
                          {/* 已买标记 */}
                          {item.status === 'purchased' && (
                            <span className="flex items-center gap-0.5 text-[11px] text-emerald-500 flex-shrink-0">
                              <ShoppingCart size={12} /> 已买
                            </span>
                          )}
                          {/* 操作区 */}
                          <div className="flex items-center gap-0.5 flex-shrink-0 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => setEditing(item)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-violet-600 hover:bg-violet-50"
                              title="编辑"
                            >
                              <Pencil size={13} />
                            </button>
                            <button
                              onClick={() => handleDelete(item)}
                              className="p-1.5 rounded-lg text-gray-300 hover:text-rose-500 hover:bg-rose-50"
                              title="删除"
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* 支出分类 */}
        {categorySpending.length > 0 && (
          <div className="card p-5 mt-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-medium text-gray-700">支出分类</span>
              <span className="text-xs text-gray-400">按已购实付</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {categorySpending.map((c) => {
                const meta = CATEGORY_META[c.category]
                return (
                  <div key={c.category} className="flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1.5">
                    <span className="text-sm">{meta.emoji}</span>
                    <span className="text-xs text-gray-600">{meta.label}</span>
                    <span className="text-xs font-semibold text-emerald-600 tabular-nums">¥{c.spent}</span>
                    <span className="text-[10px] text-gray-400">{c.count}件</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 购买确认弹窗（填写实付价） */}
      {purchasingId && (
        <PurchaseModal
          item={groups.flatMap((g) => g.items).find((x) => x.id === purchasingId)!}
          onClose={() => setPurchasingId(null)}
          onConfirm={handlePurchase}
        />
      )}

      {/* 新增/编辑弹窗 */}
      {(showAdd || editing) && (
        <WishModal
          initial={editing}
          onClose={() => { setShowAdd(false); setEditing(null) }}
          onSave={handleSave}
        />
      )}
    </div>
  )
}

// ===== 购买确认弹窗 =====

function PurchaseModal({ item, onClose, onConfirm }: {
  item: WishItem
  onClose: () => void
  onConfirm: (item: WishItem, actualPrice: number) => void
}) {
  const [price, setPrice] = useState(String(item.estimatedPrice))
  const val = parseFloat(price)
  const valid = Number.isFinite(val) && val > 0 && val <= 1000000

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-xs rounded-t-2xl sm:rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">确认购买</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>
        <div className="p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">{item.emoji}</span>
            <div>
              <div className="text-sm font-medium text-gray-800">{item.name}</div>
              <div className="text-[10px] text-gray-400">预算 ¥{item.estimatedPrice}</div>
            </div>
          </div>
          <label className="text-xs text-gray-500 mb-2 block">实付价格（元）</label>
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            autoFocus
            className={`w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-violet-400 ${
              price !== '' && !valid ? 'border-rose-300 text-rose-500' : 'border-gray-200'
            }`}
          />
          {valid && val !== item.estimatedPrice && (
            <p className="text-[10px] text-gray-400 mt-1.5">
              {val < item.estimatedPrice
                ? `比预算省了 ¥${(item.estimatedPrice - val).toFixed(0)} 👍`
                : `比预算超了 ¥${(val - item.estimatedPrice).toFixed(0)}`}
            </p>
          )}
        </div>
        <div className="border-t border-gray-100 px-5 py-3 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50">
            取消
          </button>
          <button
            onClick={() => valid && onConfirm(item, Math.round(val * 100) / 100)}
            disabled={!valid}
            className="flex-1 py-2.5 text-sm rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-40 flex items-center justify-center gap-1"
          >
            <Check size={14} /> 确认购买
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 新增/编辑弹窗 =====

const PRIORITY_LIST = Object.keys(PRIORITY_META) as WishPriority[]
const CATEGORY_LIST = Object.keys(CATEGORY_META) as WishCategory[]

function WishModal({ initial, onClose, onSave }: {
  initial: WishItem | null
  onClose: () => void
  onSave: (data: Omit<WishItem, 'id' | 'createdAt'>, id?: string) => void
}) {
  const [name, setName] = useState(initial?.name || '')
  const [emoji, setEmoji] = useState(initial?.emoji || '📱')
  const [price, setPrice] = useState(initial ? String(initial.estimatedPrice) : '')
  const [status, setStatus] = useState<WishStatus>(initial?.status || 'considering')
  const [priority, setPriority] = useState<WishPriority>(initial?.priority || 'want')
  const [category, setCategory] = useState<WishCategory>(initial?.category || 'digital')
  const [url, setUrl] = useState(initial?.url || '')
  const [note, setNote] = useState(initial?.note || '')

  const priceVal = parseFloat(price)
  const valid = name.trim().length > 0 && Number.isFinite(priceVal) && priceVal > 0 && priceVal <= 1000000

  const submit = () => {
    if (!valid) return
    onSave(
      {
        name: name.trim().slice(0, 30),
        emoji,
        estimatedPrice: Math.round(priceVal * 100) / 100,
        status,
        priority,
        category,
        url: url.trim() || undefined,
        note: note.trim() || undefined,
      },
      initial?.id,
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div
        className="relative w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-100 px-5 py-3 flex items-center justify-between">
          <span className="font-semibold text-sm">{initial ? '编辑愿望' : '新增愿望'}</span>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100"><X size={16} /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 名称 + emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">名称</label>
            <div className="flex items-center gap-2">
              <span className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center text-lg flex-shrink-0">{emoji}</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={30}
                placeholder="如：无线降噪耳机"
                className="flex-1 px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-violet-400"
              />
            </div>
          </div>

          {/* emoji */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">图标</label>
            <div className="grid grid-cols-8 gap-1">
              {EMOJI_OPTIONS.map((e) => (
                <button
                  key={e}
                  onClick={() => setEmoji(e)}
                  className={`h-8 rounded-lg text-sm flex items-center justify-center border transition ${
                    emoji === e ? 'border-violet-400 bg-violet-50 scale-110' : 'border-transparent hover:bg-gray-50'
                  }`}
                >
                  {e}
                </button>
              ))}
            </div>
          </div>

          {/* 价格 + 状态 */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-2 block">预算（元）</label>
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                inputMode="decimal"
                placeholder="999"
                className={`w-full px-3 py-2.5 rounded-lg text-sm border outline-none focus:border-violet-400 ${
                  price !== '' && !valid ? 'border-rose-300 text-rose-500' : 'border-gray-200'
                }`}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-2 block">当前状态</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as WishStatus)}
                className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-violet-400 bg-white"
              >
                {(Object.keys(STATUS_META) as WishStatus[]).map((s) => (
                  <option key={s} value={s}>{STATUS_META[s].label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* 优先级 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">优先级</label>
            <div className="grid grid-cols-3 gap-1.5">
              {PRIORITY_LIST.map((p) => (
                <button
                  key={p}
                  onClick={() => setPriority(p)}
                  className={`py-2 rounded-lg text-xs border transition ${
                    priority === p ? 'border-violet-400 bg-violet-50 text-violet-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {PRIORITY_META[p].label}
                </button>
              ))}
            </div>
          </div>

          {/* 分类 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">分类</label>
            <div className="grid grid-cols-4 gap-1.5">
              {CATEGORY_LIST.map((c) => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className={`py-1.5 rounded-lg text-[11px] border transition flex items-center justify-center gap-0.5 ${
                    category === c ? 'border-violet-400 bg-violet-50 text-violet-600 font-semibold' : 'border-gray-200 text-gray-500'
                  }`}
                >
                  <span>{CATEGORY_META[c].emoji}</span>
                  {CATEGORY_META[c].label}
                </button>
              ))}
            </div>
          </div>

          {/* 链接 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">链接（可选）</label>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://..."
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-violet-400"
            />
          </div>

          {/* 备注 */}
          <div>
            <label className="text-xs text-gray-500 mb-2 block">备注（可选）</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={50}
              placeholder="如：等双 11 降价"
              className="w-full px-3 py-2.5 rounded-lg text-sm border border-gray-200 outline-none focus:border-violet-400"
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
            className="flex-1 py-2.5 text-sm rounded-lg bg-violet-500 text-white hover:bg-violet-600 disabled:opacity-40"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  )
}
