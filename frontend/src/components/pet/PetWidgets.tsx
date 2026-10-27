/**
 * PetPage 共享组件
 * 从 PetPage.tsx 内联 JSX 抽离，ChatPage 二次拆分 SOP 验证有效。
 */
import { useToast } from '../Toast'
import {
  PetDTO, PetShopDTO, PetEvolutionDTO, PetSpecialAction,
  PetLeaderboardEntry, LeaderboardRange, PetListItem, PetSlot,
} from '../../lib/api'
import { type ActionType } from './PetGames'
import {
  Utensils, Smile, Sparkles, BatteryCharging, PawPrint, Check, X,
  ShoppingBag, Coins, CalendarCheck, Flame, Plus, Trash2,
} from 'lucide-react'

export const SPECIES_EMOJI: Record<string, string> = {
  shiba: '🐕', corgi: '🐶', panda: '🐼', cat: '🐱', snake: '🐍',
}

/** 格式化剩余秒数为 "Xh Xm" */
export function formatRemaining(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  return `${h}h ${m}m`
}

/* ─── 多宠物列表 ─── */
export function PetListSection({
  petList, maxPets, activeId,
  onSwitch, onDelete, onAdd,
}: {
  petList: PetListItem[]
  maxPets: number
  activeId?: string
  onSwitch: (id: string) => void
  onDelete: (id: string, name: string) => void
  onAdd: () => void
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><PawPrint size={15} /> 我的宠物 ({petList.length}/{maxPets})</span>
        {petList.length < maxPets && (
          <button onClick={onAdd} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary-50 text-primary-600 text-xs font-medium hover:bg-primary-100 active:scale-95 transition">
            <Plus size={13} /> 添加
          </button>
        )}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {petList.map((p) => (
          <div
            key={p.id}
            className={`relative flex-shrink-0 w-20 rounded-xl border-2 p-2 cursor-pointer transition-all ${
              p.isActive ? 'border-primary-400 bg-primary-50' : 'border-gray-100 bg-white hover:border-gray-300'
            }`}
            onClick={() => !p.isActive && onSwitch(p.id)}
          >
            {p.isActive && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary-500 text-white text-[8px] flex items-center justify-center">✓</span>
            )}
            <div className="text-center">
              <div className="text-2xl">{SPECIES_EMOJI[p.species] || '🐕'}</div>
              <div className="text-xs font-medium text-gray-700 truncate mt-0.5">{p.name}</div>
              <div className="text-[10px] text-gray-400">Lv{p.level}</div>
            </div>
            {!p.isActive && petList.length > 1 && (
              <button onClick={(e) => { e.stopPropagation(); onDelete(p.id, p.name) }}
                className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-red-100 text-red-500 hover:bg-red-200 flex items-center justify-center"
                title="删除">
                <Trash2 size={9} />
              </button>
            )}
          </div>
        ))}
        {petList.length < maxPets && (
          <button onClick={onAdd}
            className="flex-shrink-0 w-20 rounded-xl border-2 border-dashed border-gray-200 p-2 flex items-center justify-center hover:border-primary-300 hover:bg-primary-50/30 transition">
            <Plus size={20} className="text-gray-300" />
          </button>
        )}
      </div>
    </div>
  )
}

/* ─── 专属互动（等级特权） ─── */
export function SpecialActionsSection({
  pet, specialActions, doAction,
}: {
  pet: PetDTO
  specialActions: PetSpecialAction[]
  doAction: (type: ActionType) => void
}) {
  if (specialActions.length === 0) return null
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Sparkles size={15} /> 专属互动</span>
        <span className="text-xs text-gray-400">等级越高解锁越多</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {specialActions.map((sa) => (
          <button key={sa.key} disabled={!sa.unlocked}
            onClick={() => doAction(sa.key as ActionType)}
            className={`flex flex-col items-center gap-1 py-3 rounded-2xl border transition ${
              sa.unlocked ? 'bg-white shadow-sm border-gray-100 hover:bg-primary-50 active:scale-95' : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed'
            }`}>
            <span className="text-2xl">{sa.key === 'walk' ? '🚶' : '💪'}</span>
            <span className="text-xs text-gray-600">{sa.name}</span>
            {!sa.unlocked && <span className="text-[10px] text-gray-400">Lv{sa.unlockLevel} 解锁</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

/* ─── 每日签到 ─── */
export function CheckinSection({
  pet, onCheckin,
}: {
  pet: PetDTO
  onCheckin: () => void
}) {
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><CalendarCheck size={15} /> 每日签到</span>
        <span className="flex items-center gap-1 text-xs text-primary-600">
          <Flame size={13} /> 连续 {pet.checkinStreak ?? 0} 天
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-gray-500">
          {pet.checkedInToday
            ? '今日已签到 🎉'
            : `今日可领 🪙+${5 + Math.min(pet.checkinStreak ?? 0, 6) * 2 + Math.min(pet.level, 10)}（含等级加成）`}
        </span>
        {pet.checkedInToday ? (
          <span className="px-3 py-1.5 rounded-lg bg-gray-100 text-gray-400 text-xs cursor-not-allowed">已签到</span>
        ) : (
          <button onClick={onCheckin} className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium active:scale-95 flex items-center gap-1">
            <CalendarCheck size={13} /> 签到领币
          </button>
        )}
      </div>
      {(pet.checkinTotal ?? 0) > 0 && (
        <div className="text-[11px] text-gray-400 mt-1">累计签到 {pet.checkinTotal} 天</div>
      )}
    </div>
  )
}

/* ─── 装扮商店 ─── */
export function PetShopSection({
  pet, shop, shopCoins,
  onBuy, onEquip, onUnequip,
}: {
  pet: PetDTO
  shop: PetShopDTO | null
  shopCoins: number
  onBuy: (itemKey: string, cost: number) => void
  onEquip: (itemKey: string) => void
  onUnequip: (slot: PetSlot) => void
}) {
  if (!shop) return null
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><ShoppingBag size={15} /> 装扮商店</span>
        <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
          <Coins size={13} /> {shopCoins}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {shop.items.map((it) => {
          const canBuy = !it.owned && !it.locked && shopCoins >= it.cost
          const rarityColor = it.rarity === 'epic' ? 'bg-purple-100 text-purple-700'
            : it.rarity === 'rare' ? 'bg-blue-100 text-blue-700'
            : 'bg-gray-100 text-gray-500'
          const rarityText = it.rarity === 'epic' ? '稀有' : it.rarity === 'rare' ? '珍稀' : '普通'
          return (
            <div key={it.key}
              className={`rounded-xl border p-2.5 flex flex-col ${it.locked ? 'border-gray-100 bg-gray-50 opacity-70' : it.equipped ? 'border-primary-400 bg-primary-50' : 'border-gray-100 bg-white'}`}>
              <div className="flex items-center justify-between">
                <span className="text-2xl">{it.icon}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${rarityColor}`}>{rarityText}</span>
              </div>
              <div className="text-sm font-medium text-gray-700 mt-1">{it.name}</div>
              <div className="text-[11px] text-gray-400 leading-tight mb-2">{it.desc}</div>
              {!it.owned ? (
                <button disabled={!canBuy} onClick={() => onBuy(it.key, it.cost)}
                  className={`mt-auto py-1.5 rounded-lg text-xs font-medium active:scale-95 transition ${canBuy ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
                  {it.locked ? `Lv${it.unlockLevel} 解锁` : shopCoins >= it.cost ? `购买 ${it.cost}🪙` : `差 ${it.cost - shopCoins}🪙`}
                </button>
              ) : it.equipped ? (
                <button onClick={() => onUnequip(it.slot)} className="mt-auto py-1.5 rounded-lg text-xs font-medium bg-primary-100 text-primary-700 active:scale-95">
                  卸下
                </button>
              ) : (
                <button onClick={() => onEquip(it.key)} className="mt-auto py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-white active:scale-95">
                  装备
                </button>
              )}
            </div>
          )
        })}
      </div>
      <p className="text-xs text-gray-400 mt-2">用玩游戏赚来的金币购买装扮，按槽位自由搭配（同一槽位仅可装备一件）。</p>
    </div>
  )
}

/* ─── 排行榜 ─── */
export function LeaderboardSection({
  leaderboard, range, onSwitchRange,
}: {
  leaderboard: PetLeaderboardEntry[]
  range: LeaderboardRange
  onSwitchRange: (r: LeaderboardRange) => void
}) {
  if (leaderboard.length === 0) return null
  return (
    <div className="card p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><PawPrint size={15} /> 宠物排行榜</span>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 text-[11px]">
          {([['all', '总榜'], ['week', '周榜'], ['month', '月榜']] as [LeaderboardRange, string][]).map(([k, label]) => (
            <button key={k} onClick={() => onSwitchRange(k)}
              className={`px-2 py-1 rounded-md transition-colors ${range === k ? 'bg-white text-primary-600 shadow-sm font-medium' : 'text-gray-500'}`}>{label}</button>
          ))}
        </div>
      </div>
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {leaderboard.map((e) => (
          <div key={e.petId}
            className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${e.isMe ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'}`}>
            <span className={`w-6 text-center font-bold ${e.rank === 1 ? 'text-amber-500' : e.rank === 2 ? 'text-gray-400' : e.rank === 3 ? 'text-orange-700' : 'text-gray-400'}`}>
              {e.rank <= 3 ? ['🥇', '🥈', '🥉'][e.rank - 1] : e.rank}
            </span>
            <span className="flex-1 truncate text-gray-700">{e.name}</span>
            <span className="text-[11px] text-gray-400">{e.ownerName}</span>
            <span className="text-xs text-primary-600 font-medium">Lv{e.level}</span>
            <span className="text-[11px] text-gray-400">{e.evolutionAura || '⭐'}{e.evolutionTitle}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─── 添加宠物弹窗 ─── */
export function AddPetModal({
  show, maxPets,
  newPetName, newPetSpecies,
  onNameChange, onSpeciesChange,
  onClose, onCreate,
}: {
  show: boolean
  maxPets: number
  newPetName: string
  newPetSpecies: 'shiba' | 'corgi' | 'panda' | 'cat' | 'snake'
  onNameChange: (v: string) => void
  onSpeciesChange: (s: any) => void
  onClose: () => void
  onCreate: () => void
}) {
  if (!show) return null
  const speciesList: { k: any; emoji: string; label: string }[] = [
    { k: 'shiba', emoji: '🐕', label: '柴犬' },
    { k: 'corgi', emoji: '🐶', label: '柯基' },
    { k: 'panda', emoji: '🐼', label: '熊猫' },
    { k: 'cat', emoji: '🐱', label: '猫' },
    { k: 'snake', emoji: '🐍', label: '蛇' },
  ]
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl p-5 w-full max-w-xs space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <span className="text-base font-bold text-gray-800">添加新宠物</span>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">宠物名字</label>
          <input value={newPetName} onChange={(e) => onNameChange(e.target.value)}
            maxLength={12} placeholder="给新宠物起个名字…"
            className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary-400"
            autoFocus onKeyDown={(e) => e.key === 'Enter' && onCreate()} />
        </div>
        <div>
          <label className="text-xs text-gray-500 mb-1 block">选择物种</label>
          <div className="flex gap-2">
            {speciesList.map((s) => (
              <button key={s.k} onClick={() => onSpeciesChange(s.k)}
                className={`flex-1 py-3 rounded-xl border-2 transition-all ${newPetSpecies === s.k ? 'border-primary-400 bg-primary-50 scale-105' : 'border-gray-100 bg-white hover:border-gray-300'}`}>
                <div className="text-2xl">{s.emoji}</div>
                <div className="text-xs text-gray-600 mt-1">{s.label}</div>
              </button>
            ))}
          </div>
          <p className="text-[11px] text-gray-400 mt-2">
            领养上限随账号等级提升：Lv1-5 可领养 1 只，之后每 6 级 +1（当前上限 {maxPets} 只）
          </p>
        </div>
        <button onClick={onCreate}
          className="w-full py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium active:scale-95 transition">
          创建宠物
        </button>
      </div>
    </div>
  )
}

export type { PetDTO, PetShopDTO, PetEvolutionDTO, PetSpecialAction, PetLeaderboardEntry, PetListItem, PetSlot, LeaderboardRange }
