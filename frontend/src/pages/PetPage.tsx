import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import { getPet, petAction, petRename, playGame, getPetShop, buyPetItem, equipPetItem, unequipPetSlot, petCheckin, getPetEvolution, getPetSpecialActions, getPetLeaderboard, getPetList, createPet, switchPet, deletePet, uploadCustomSprite, deleteCustomSprite, type PetDTO, type PetShopDTO, type PetSlot, type PetEvolutionDTO, type PetSpecialAction, type PetLeaderboardEntry, type LeaderboardRange, type PetListItem } from '../lib/api'
import { isDesktop } from '../lib/localCache'
import PetSprite, { type PetState } from '../components/PetSprite'
import {
  Utensils, Smile, Sparkles, BatteryCharging, PawPrint, Pencil, Check, X, Gamepad2, ShoppingBag, Coins, CalendarCheck, Flame, Plus, Trash2, ImagePlus, Clock,
} from 'lucide-react'

type ActionType = 'feed' | 'play' | 'clean' | 'sleep' | 'walk' | 'train'

const STATE_TEXT: Record<PetState, string> = {
  happy: '很开心 😊', hungry: '饿了，想吃东西 🍖', dirty: '有点脏，要洗澡 🫧',
  sleepy: '困了，想睡觉 😴', sad: '有点不开心…',
}

/**
 * 桌面宠物浮窗组件
 *
 * 核心交互：整个宠物区域可拖拽移动窗口（非仅窗口边缘）
 * - pointerdown 记录起点，pointermove 判断是否拖拽
 * - 位移 > 4px 判定为拖拽 → 调用 desktopAPI.movePetWindow(dx, dy) 移动窗口
 * - 位移 ≤ 4px 判定为点击 → 触发摸摸互动
 * - pointerup 清理状态
 *
 * 多元化展示：
 * - 待机浮动 + 呼吸缩放 + 偶尔眨眼/转头动画
 * - 互动时蹦跳 + 爱心粒子
 * - 状态指示（开心/饿/困等表情气泡）
 */
function PetFloat({ pet, petList, action, playThrottled, doAction, handleSwitchPet }: {
  pet: PetDTO
  petList: PetListItem[]
  action: string | null
  playThrottled: () => void
  doAction: (t: ActionType) => void
  handleSwitchPet: (id: string) => void
}) {
  const dragState = useRef<{ startX: number; startY: number; isDragging: boolean; moved: boolean }>({
    startX: 0, startY: 0, isDragging: false, moved: false,
  })
  const [showHearts, setShowHearts] = useState(false)
  const [bubbleText, setBubbleText] = useState<string | null>(null)

  // 互动时显示爱心粒子
  useEffect(() => {
    if (action) {
      setShowHearts(true)
      const t = setTimeout(() => setShowHearts(false), 1500)
      return () => clearTimeout(t)
    }
  }, [action])

  // 状态气泡轮播（多元化展示宠物当前心情）
  useEffect(() => {
    const texts = STATE_TEXT[pet.state] ? [STATE_TEXT[pet.state]] : ['...']
    let idx = 0
    setBubbleText(texts[0])
    const timer = setInterval(() => {
      idx = (idx + 1) % texts.length
      setBubbleText(texts[idx])
    }, 5000)
    return () => clearInterval(timer)
  }, [pet.state])

  const onPointerDown = (e: React.PointerEvent) => {
    dragState.current = { startX: e.clientX, startY: e.clientY, isDragging: true, moved: false }
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragState.current.isDragging) return
    const dx = e.clientX - dragState.current.startX
    const dy = e.clientY - dragState.current.startY
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      dragState.current.moved = true
      // 移动窗口（每次 move 增量位移）
      ;(window as any).desktopAPI?.movePetWindow?.(dx, dy)
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
    }
  }

  const onPointerUp = () => {
    if (dragState.current.isDragging && !dragState.current.moved) {
      // 未移动 → 点击摸摸
      playThrottled()
    }
    dragState.current.isDragging = false
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-transparent select-none relative cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <style>{`
        @keyframes pet-breath { 0%,100%{transform:scale(1)} 50%{transform:scale(1.04)} }
        @keyframes heart-up { 0%{opacity:1;transform:translateY(0) scale(0.5)} 100%{opacity:0;transform:translateY(-40px) scale(1.2)} }
        @keyframes bubble-pop { 0%{opacity:0;transform:scale(0.8) translateY(4px)} 100%{opacity:1;transform:scale(1) translateY(0)} }
        .pet-breath { animation: pet-breath 2.5s ease-in-out infinite; }
        .heart-particle { animation: heart-up 1.2s ease-out forwards; }
        .pet-bubble { animation: bubble-pop 0.3s ease-out; }
      `}</style>

      {/* 顶部工具栏：隐藏 / 关闭 */}
      <div className="absolute top-0 left-0 right-0 flex justify-end gap-1 p-1 z-10">
        <button
          onClick={(e) => { e.stopPropagation(); (window as any).desktopAPI?.togglePetWindow?.() }}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-white/60 hover:bg-white/90 text-gray-500 hover:text-gray-700 shadow-sm transition-colors"
          title="隐藏"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span className="text-[10px]">—</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); (window as any).desktopAPI?.closePetWindow?.() }}
          className="w-6 h-6 flex items-center justify-center rounded-full bg-white/60 hover:bg-red-100 text-gray-500 hover:text-red-500 shadow-sm transition-colors"
          title="关闭"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <X size={12} />
        </button>
      </div>

      {/* 心情气泡 */}
      {bubbleText && (
        <div className="pet-bubble absolute top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg bg-white/90 text-[10px] text-gray-600 shadow whitespace-nowrap max-w-[140px] text-center">
          {bubbleText}
        </div>
      )}

      {/* 宠物本体 + 呼吸动画 + 爱心粒子 */}
      <div className="relative w-40 h-40">
        <div className="absolute inset-0 pet-breath">
          <PetSprite species={pet.species} state={pet.state} action={action} evolutionStage={pet.evolutionStage} customSprite={pet.customSprite} />
        </div>
        {/* 爱心粒子 */}
        {showHearts && (
          <>
            <span className="heart-particle absolute left-1/2 top-1/2 text-pink-400 text-sm">❤</span>
            <span className="heart-particle absolute left-1/3 top-1/2 text-pink-300 text-xs" style={{ animationDelay: '0.2s' }}>❤</span>
            <span className="heart-particle absolute right-1/3 top-1/2 text-red-300 text-xs" style={{ animationDelay: '0.4s' }}>❤</span>
          </>
        )}
      </div>

      {/* 名字 + 等级 */}
      <div className="text-sm font-medium text-gray-700 mt-1 px-2 py-0.5 rounded-full bg-white/60 backdrop-blur-sm">
        {pet.name} · Lv{pet.level}
      </div>

      {/* 互动按钮 */}
      <div className="flex gap-1 mt-2">
        {(['feed', 'play', 'clean', 'sleep'] as ActionType[]).map((t) => (
          <button
            key={t}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); doAction(t) }}
            className="px-2 py-1 text-xs rounded-lg bg-white/80 shadow text-gray-700 hover:bg-white active:scale-90 transition-transform"
          >
            {t === 'feed' ? '🍖' : t === 'play' ? '🎾' : t === 'clean' ? '🫧' : '😴'}
          </button>
        ))}
      </div>

      {/* 多宠物切换 */}
      {petList.length > 1 && (
        <div className="flex gap-1 mt-2">
          {petList.map((p) => (
            <button
              key={p.id}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); handleSwitchPet(p.id) }}
              className={`w-2 h-2 rounded-full transition-all ${p.isActive ? 'bg-primary-500 scale-125' : 'bg-gray-300 hover:bg-gray-400'}`}
              title={`${p.name} · Lv${p.level}`}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function StatBar({ label, icon, value, color }: { label: string; icon: React.ReactNode; value: number; color: string }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
        <span className="flex items-center gap-1">{icon}{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

// ---- 游戏1：接食物（食物下落，点击喂宠物，涨饥饿+经验）----
function CatchGame({ onCatch, disabled }: { onCatch: () => void; disabled: boolean }) {
  const [items, setItems] = useState<{ id: number; x: number; y: number; emoji: string }[]>([])
  const idRef = useRef(0)
  const lastFeedRef = useRef(0)

  useEffect(() => {
    const spawn = setInterval(() => {
      if (disabled) return
      const id = idRef.current++
      const emoji = ['🍖', '🍎', '🍪', '🥕', '🍣'][Math.floor(Math.random() * 5)]
      setItems((prev) => [...prev, { id, x: Math.random() * 80, y: 0, emoji }])
    }, 700)
    const move = setInterval(() => {
      setItems((prev) => prev.map((it) => ({ ...it, y: it.y + 6 })).filter((it) => it.y < 100))
    }, 50)
    return () => { clearInterval(spawn); clearInterval(move) }
  }, [disabled])

  const catchIt = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    const now = Date.now()
    if (now - lastFeedRef.current > 350) { lastFeedRef.current = now; onCatch() }
  }

  return (
    <div className="relative w-full h-44 bg-gradient-to-b from-sky-100 to-indigo-100 rounded-2xl overflow-hidden border border-sky-200">
      <div className="absolute top-2 left-3 text-xs text-sky-600 font-medium">点食物喂它！</div>
      {items.map((it) => (
        <button
          key={it.id}
          onClick={() => catchIt(it.id)}
          className="absolute text-2xl select-none active:scale-90 transition-transform"
          style={{ left: `${it.x}%`, top: `${it.y}%` }}
        >
          {it.emoji}
        </button>
      ))}
      {items.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sky-300 text-sm">等待食物落下…</div>}
    </div>
  )
}

// ---- 游戏2：逗一逗（限时狂点宠物，涨心情）----
function PokeGame({ onPoke, onSettle, disabled }: { onPoke: () => void; onSettle?: (score: number) => void; disabled: boolean }) {
  const DURATION = 10
  const [time, setTime] = useState(DURATION)
  const [count, setCount] = useState(0)
  const [running, setRunning] = useState(false)
  const [done, setDone] = useState(false)
  const [bounce, setBounce] = useState(false)
  const countRef = useRef(0)
  const settledRef = useRef(false)

  const start = () => {
    if (disabled) return
    setRunning(true); setDone(false); setTime(DURATION); setCount(0); countRef.current = 0
  }

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTime((v) => Math.max(0, +(v - 0.1).toFixed(1))), 100)
    const end = setTimeout(() => {
      setRunning(false); setDone(true)
      if (!settledRef.current) { settledRef.current = true; onSettle?.(countRef.current) }
    }, DURATION * 1000)
    return () => { clearInterval(t); clearTimeout(end) }
  }, [running, onSettle])

  const poke = () => {
    if (!running || disabled) return
    countRef.current += 1
    setCount(countRef.current)
    setBounce(true)
    setTimeout(() => setBounce(false), 120)
    onPoke()
  }

  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div
        onClick={poke}
        className={`text-6xl cursor-pointer select-none transition-transform ${bounce ? 'scale-125' : 'scale-100'} ${running ? 'hover:scale-110' : ''}`}
      >
        🐾
      </div>
      {!running && !done && (
        <button onClick={start} className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium active:scale-95">
          {disabled ? '互动中…' : '开始逗它（10秒）'}
        </button>
      )}
      {running && (
        <div className="text-sm text-gray-600">疯狂戳它！剩余 <span className="font-bold text-primary-600">{time.toFixed(1)}s</span> · 已戳 {count} 下</div>
      )}
      {done && (
        <div className="text-center text-sm text-gray-600">
          你戳了 <span className="font-bold text-primary-600">{count}</span> 下，它超开心！😸<br />
          <span className="text-xs text-gray-400">（戳的过程中已自动陪玩涨心情）</span>
        </div>
      )}
    </div>
  )
}

// ---- 游戏3：记忆翻牌（配对完成奖励）----
const MEM_EMOJIS = ['🍎', '⚽', '🌟', '🐟', '🎵', '🌸']
function MemoryGame({ onWin, disabled }: { onWin: () => void; disabled: boolean }) {
  const [cards, setCards] = useState<{ id: number; emoji: string; flipped: boolean; matched: boolean }[]>([])
  const [flipped, setFlipped] = useState<number[]>([])
  const [lock, setLock] = useState(false)
  const [pairs, setPairs] = useState(0)
  const [won, setWon] = useState(false)

  const shuffle = () => {
    const deck = [...MEM_EMOJIS, ...MEM_EMOJIS]
      .map((e, i) => ({ id: i, emoji: e, flipped: false, matched: false }))
      .sort(() => Math.random() - 0.5)
    setCards(deck); setFlipped([]); setLock(false); setPairs(0); setWon(false)
  }

  useEffect(() => { shuffle() }, [])

  const click = (idx: number) => {
    if (disabled || lock || won) return
    const c = cards[idx]
    if (c.flipped || c.matched) return
    const next = [...flipped, idx]
    const nextCards = cards.map((x, i) => (i === idx ? { ...x, flipped: true } : x))
    setFlipped(next); setCards(nextCards)
    if (next.length === 2) {
      setLock(true)
      const [a, b] = next
      if (nextCards[a].emoji === nextCards[b].emoji) {
        setTimeout(() => {
          setCards((prev) => prev.map((x, i) => (i === a || i === b ? { ...x, matched: true } : x)))
          setPairs((p) => p + 1); setFlipped([]); setLock(false)
        }, 350)
      } else {
        setTimeout(() => {
          setCards((prev) => prev.map((x, i) => (i === a || i === b ? { ...x, flipped: false } : x)))
          setFlipped([]); setLock(false)
        }, 700)
      }
    }
  }

  useEffect(() => {
    if (pairs === MEM_EMOJIS.length && !won) {
      setWon(true)
      onWin()
    }
  }, [pairs, won, onWin])

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid grid-cols-4 gap-1.5 w-full max-w-[280px]">
        {cards.map((c, i) => (
          <button
            key={c.id}
            onClick={() => click(i)}
            disabled={disabled || c.matched}
            className={`aspect-square rounded-lg text-xl flex items-center justify-center transition-all ${
              c.flipped || c.matched ? 'bg-white shadow-inner' : 'bg-primary-100 hover:bg-primary-200'
            } ${c.matched ? 'opacity-50' : ''}`}
          >
            {c.flipped || c.matched ? c.emoji : '❓'}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>已配对 {pairs}/{MEM_EMOJIS.length}</span>
        <button onClick={shuffle} className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200">重开</button>
      </div>
      {won && <div className="text-sm text-primary-600 font-medium">全部配对！宠物获得奖励 🎁</div>}
    </div>
  )
}

export default function PetPage() {
  const [params] = useSearchParams()
  const float = params.get('float') === '1'
  const toast = useToast((s) => s.show)
  const [pet, setPet] = useState<PetDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [score, setScore] = useState(0)
  const [shop, setShop] = useState<PetShopDTO | null>(null)
  const [evolution, setEvolution] = useState<PetEvolutionDTO | null>(null)
  const [specialActions, setSpecialActions] = useState<PetSpecialAction[]>([])
  const [leaderboard, setLeaderboard] = useState<PetLeaderboardEntry[]>([])

  // 多宠物管理
  const [petList, setPetList] = useState<PetListItem[]>([])
  const [maxPets, setMaxPets] = useState(1)
  const [showAddPet, setShowAddPet] = useState(false)
  const [newPetName, setNewPetName] = useState('')
  const [newPetSpecies, setNewPetSpecies] = useState<'shiba' | 'corgi' | 'panda' | 'cat' | 'snake'>('shiba')

  // 自定义桌宠形象（照片抠图，24小时有效）
  const [spriteUploading, setSpriteUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 小游戏结算：把本轮得分兑换为宠物金币 + 经验（含升级）
  const settleGame = async (game: 'catch' | 'poke' | 'memory', sc: number) => {
    if (sc <= 0) { toast('这局还没得分哦，再来一局～', 'info'); return }
    try {
    const p = await playGame(game, sc)
    setPet(p)
    loadEvolution()
    if (p.evolutionJustUnlocked) {
      toast(`🎉 进化！解锁「${p.evolutionJustUnlocked.title}」${p.evolutionJustUnlocked.aura || ''}（升级到 Lv${p.level}）`, 'success')
    } else if (p.levelUp) {
      toast(`升级到 Lv${p.level}！🪙+${Math.ceil(sc / 2)} EXP+${sc}`, 'success')
    } else {
      toast(`🎉 游戏奖励 🪙+${Math.ceil(sc / 2)} EXP+${sc}`, 'success')
    }
    } catch (e: any) {
      toast(e?.message || '结算失败', 'error')
    }
    setScore(0)
  }
  const [game, setGame] = useState<'catch' | 'poke' | 'memory'>('catch')
  // 限流：避免小游戏狂点把后端 play 打爆
  const lastPlayRef = useRef(0)

  const load = async () => {
    try {
      const p = await getPet()
      setPet(p)
    } catch (e: any) {
      toast(e?.message || '加载宠物失败', 'error')
    } finally {
      setLoading(false)
    }
  }

  // 照片 → 抠图 → 自定义桌宠形象（24小时有效）
  const handlePhotoUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) { toast('请选择图片文件', 'error'); return }
    if (file.size > 10 * 1024 * 1024) { toast('图片大小不能超过 10MB', 'error'); return }
    setSpriteUploading(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        try {
          const result = await uploadCustomSprite(reader.result as string)
          setPet((prev) => prev ? { ...prev, customSprite: result.customSprite, customSpriteExpireAt: result.customSpriteExpireAt, customSpriteRemaining: result.customSpriteRemaining } : prev)
          toast('照片变桌宠成功！有效期 24 小时', 'success')
        } catch (e: any) {
          toast(e?.message || '抠图失败，请稍后重试', 'error')
        } finally {
          setSpriteUploading(false)
        }
      }
      reader.onerror = () => { toast('图片读取失败', 'error'); setSpriteUploading(false) }
      reader.readAsDataURL(file)
    } catch (e: any) {
      toast(e?.message || '上传失败', 'error')
      setSpriteUploading(false)
    }
  }

  const handleDeleteSprite = async () => {
    try {
      await deleteCustomSprite()
      setPet((prev) => prev ? { ...prev, customSprite: null, customSpriteExpireAt: null, customSpriteRemaining: 0 } : prev)
      toast('已恢复默认形象', 'info')
    } catch (e: any) {
      toast(e?.message || '操作失败', 'error')
    }
  }

  const formatRemaining = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    return `${h}h ${m}m`
  }

  // 商店数据（金币 / 持有 / 装备）
  const loadShop = async () => {
    try {
      const s = await getPetShop()
      setShop(s)
    } catch {
      /* 商店加载失败不影响宠物主体 */
    }
  }

  // 进化阶段数据（成长体系）
  const loadEvolution = async () => {
    try {
      const e = await getPetEvolution()
      setEvolution(e)
    } catch {
      /* 进化数据加载失败不影响主体 */
    }
  }

  // 专属互动动作（等级特权）
  const loadSpecialActions = async () => {
    try {
      const r = await getPetSpecialActions()
      setSpecialActions(r.specialActions)
    } catch {
      /* 不影响主体 */
    }
  }
  // 跨会话宠物排行榜（range: all | week | month）
  const [range, setRange] = useState<LeaderboardRange>('all')
  const rangeRef = useRef<LeaderboardRange>('all')
  rangeRef.current = range
  const loadLeaderboard = async () => {
    try {
      const r = await getPetLeaderboard(20, rangeRef.current)
      setLeaderboard(r.list)
    } catch {
      /* 不影响主体 */
    }
  }
  // 多宠物列表
  const loadPetList = async () => {
    try {
      const r = await getPetList()
      setPetList(r.list)
      setMaxPets(r.maxPets)
    } catch {
      /* 不影响主体 */
    }
  }
  const switchRange = (r: LeaderboardRange) => {
    setRange(r)
    rangeRef.current = r
    loadLeaderboard()
  }

  useEffect(() => {
    load()
    loadShop()
    loadEvolution()
    loadSpecialActions()
    loadLeaderboard()
    loadPetList()
    const t = setInterval(() => { load(); loadShop(); loadEvolution(); loadSpecialActions(); loadLeaderboard(); loadPetList() }, 15000) // 软衰减：定期拉取最新状态
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doAction = async (type: ActionType) => {
    setAction(type)
    try {
      const p = await petAction(type)
      setPet(p)
      loadEvolution()
      if (p.evolutionJustUnlocked) {
        toast(`🎉 进化！解锁「${p.evolutionJustUnlocked.title}」${p.evolutionJustUnlocked.aura || ''}`, 'success')
      } else if (p.levelUp) {
        toast(`升级到 Lv${p.level}！`, 'success')
      } else {
        const msg: Record<ActionType, string> = { feed: '喂食成功 🍖', play: '玩耍开心 🎾', clean: '洗白白 🫧', sleep: '睡个好觉 😴', walk: '遛弯愉快 🌳', train: '特训提升 💪' }
        toast(msg[type], 'success')
      }
    } catch (e: any) {
      toast(e?.message || '互动失败', 'error')
    }
    setTimeout(() => setAction(null), 1000)
  }

  // 限流后的"玩耍"（小游戏内部调用）
  const playThrottled = () => {
    const now = Date.now()
    if (now - lastPlayRef.current > 600) {
      lastPlayRef.current = now
      doAction('play')
    }
  }

  const saveName = async () => {
    const n = nameInput.trim()
    if (!n) return
    try {
      const p = await petRename(n)
      setPet(p)
      setEditing(false)
      toast('改名成功', 'success')
    } catch (e: any) {
      toast(e?.message || '改名失败', 'error')
    }
  }

  // ---- 装扮商店：购买 / 装备 / 卸下 ----
  const handleBuy = async (itemKey: string, cost: number) => {
    try {
      const r = await buyPetItem(itemKey)
      setPet((p) => (p ? { ...p, coins: r.coins } : p))
      await loadShop()
      toast(`购买成功 🪙-${cost}`, 'success')
    } catch (e: any) {
      toast(e?.message || '购买失败', 'error')
    }
  }
  const handleEquip = async (itemKey: string) => {
    try {
      const r = await equipPetItem(itemKey)
      setPet((p) => (p ? { ...p, equipped: r.equipped } : p))
      await loadShop()
    } catch (e: any) {
      toast(e?.message || '装备失败', 'error')
    }
  }
  const handleUnequip = async (slot: PetSlot) => {
    try {
      const r = await unequipPetSlot(slot)
      setPet((p) => (p ? { ...p, equipped: r.equipped } : p))
      await loadShop()
    } catch (e: any) {
      toast(e?.message || '卸下失败', 'error')
    }
  }

  // ---- 每日签到 ----
  const handleCheckin = async () => {
    try {
      const r = await petCheckin()
      setPet((p) => (p ? { ...p, coins: r.coins, checkedInToday: true, checkinStreak: r.streak, checkinTotal: r.total } : p))
      loadEvolution()
      toast(`签到成功 🪙+${r.award}（含等级加成 ${r.levelBonus}）· 连续 ${r.streak} 天`, 'success')
    } catch (e: any) {
      toast(e?.message || '签到失败', 'error')
    }
  }

  // ---- 多宠物管理：切换 / 创建 / 删除 ----
  const handleSwitchPet = async (petId: string) => {
    try {
      const p = await switchPet(petId)
      setPet(p)
      await loadPetList()
      await loadShop()
      await loadEvolution()
      await loadSpecialActions()
      toast('已切换宠物', 'success')
    } catch (e: any) {
      toast(e?.message || '切换失败', 'error')
    }
  }

  const handleCreatePet = async () => {
    const n = newPetName.trim()
    if (!n) { toast('请输入宠物名字', 'info'); return }
    try {
      await createPet(n, newPetSpecies)
      setShowAddPet(false)
      setNewPetName('')
      setNewPetSpecies('shiba')
      await loadPetList()
      await load()
      toast('宠物创建成功 🎉', 'success')
    } catch (e: any) {
      toast(e?.message || '创建失败', 'error')
    }
  }

  const handleDeletePet = async (petId: string, name: string) => {
    if (!confirm(`确定要删除「${name}」吗？此操作不可撤销。`)) return
    try {
      await deletePet(petId)
      await loadPetList()
      await load()
      toast('宠物已删除', 'success')
    } catch (e: any) {
      toast(e?.message || '删除失败', 'error')
    }
  }

  if (loading) {
    return <div className="app-shell flex items-center justify-center text-gray-400 py-20">加载中…</div>
  }
  if (!pet) {
    return <div className="app-shell flex items-center justify-center text-gray-400 py-20">宠物加载失败</div>
  }

  // 已装备装扮 → 背景着色 + 图标叠层
  const equippedBg = shop?.items.find((x) => x.key === pet.equipped?.background)?.bg ?? null
  const equippedIcons: Record<string, string | undefined> = {}
  for (const s of ['hat', 'glasses', 'collar', 'toy'] as const) {
    const key = pet.equipped?.[s]
    if (key) {
      const it = shop?.items.find((x) => x.key === key)
      if (it) equippedIcons[s] = it.icon
    }
  }
  const shopCoins = shop?.coins ?? pet.coins

  // ---- 浮窗精简模式（桌面专属：整个宠物区域可拖拽移动，短按=摸摸）----
  if (float) {
    return (
      <PetFloat
        pet={pet}
        petList={petList}
        action={action}
        playThrottled={playThrottled}
        doAction={doAction}
        handleSwitchPet={handleSwitchPet}
      />
    )
  }

  // ---- 完整页面 ----
  return (
    <div className="app-shell pb-6">
      <div className="bg-gradient-to-br from-primary-500 to-teal-500 text-white px-4 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PawPrint size={20} />
            <span className="text-lg font-bold">我的宠物</span>
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                maxLength={12}
                className="w-24 px-2 py-1 rounded text-gray-800 text-sm"
                placeholder="新名字"
                autoFocus
              />
              <button onClick={saveName} className="p-1 bg-white/20 rounded"><Check size={16} /></button>
              <button onClick={() => setEditing(false)} className="p-1 bg-white/20 rounded"><X size={16} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {isDesktop() && (
                <button
                  onClick={() => (window as any).desktopAPI?.togglePetWindow?.()}
                  className="px-2 py-1.5 bg-white/20 rounded-full hover:bg-white/30 text-xs"
                  title="在桌面显示宠物浮窗"
                >
                  桌面显示
                </button>
              )}
              <button onClick={() => { setNameInput(pet.name); setEditing(true) }} className="p-1.5 bg-white/20 rounded-full hover:bg-white/30">
                <Pencil size={15} />
              </button>
            </div>
          )}
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm opacity-90 flex-wrap">
          <span className="font-medium">{pet.name}</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full">Lv{pet.level}</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full">{pet.evolutionAura || '⭐'} {pet.evolutionTitle}</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full">🪙 {pet.coins}</span>
          <span className="bg-white/20 px-2 py-0.5 rounded-full">EXP {pet.exp}/{pet.level * 100}</span>
        </div>
      </div>

      <div className="px-4 -mt-4 space-y-3 relative z-10">
        {/* 多宠物管理：列表 / 切换 / 新增 / 删除 */}
        {petList.length > 0 && (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><PawPrint size={15} /> 我的宠物 ({petList.length}/{maxPets})</span>
              {petList.length < maxPets && (
                <button
                  onClick={() => setShowAddPet(true)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-primary-50 text-primary-600 text-xs font-medium hover:bg-primary-100 active:scale-95 transition"
                >
                  <Plus size={13} /> 添加
                </button>
              )}
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {petList.map((p) => {
                const speciesEmoji = p.species === 'shiba' ? '🐕' : p.species === 'corgi' ? '🐶' : p.species === 'cat' ? '🐱' : p.species === 'snake' ? '🐍' : '🐼'
                return (
                  <div
                    key={p.id}
                    className={`relative flex-shrink-0 w-20 rounded-xl border-2 p-2 cursor-pointer transition-all ${
                      p.isActive ? 'border-primary-400 bg-primary-50' : 'border-gray-100 bg-white hover:border-gray-300'
                    }`}
                    onClick={() => !p.isActive && handleSwitchPet(p.id)}
                  >
                    {p.isActive && (
                      <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-primary-500 text-white text-[8px] flex items-center justify-center">✓</span>
                    )}
                    <div className="text-center">
                      <div className="text-2xl">{speciesEmoji}</div>
                      <div className="text-xs font-medium text-gray-700 truncate mt-0.5">{p.name}</div>
                      <div className="text-[10px] text-gray-400">Lv{p.level}</div>
                    </div>
                    {!p.isActive && petList.length > 1 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePet(p.id, p.name) }}
                        className="absolute -bottom-1 -left-1 w-4 h-4 rounded-full bg-red-100 text-red-500 hover:bg-red-200 flex items-center justify-center"
                        title="删除"
                      >
                        <Trash2 size={9} />
                      </button>
                    )}
                  </div>
                )
              })}
              {petList.length < maxPets && (
                <button
                  onClick={() => setShowAddPet(true)}
                  className="flex-shrink-0 w-20 rounded-xl border-2 border-dashed border-gray-200 p-2 flex items-center justify-center hover:border-primary-300 hover:bg-primary-50/30 transition"
                >
                  <Plus size={20} className="text-gray-300" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3D 宠物 + 状态 */}
        <div className="card p-3">
          <div
            className="h-56 rounded-2xl flex items-center justify-center relative overflow-hidden"
            style={{ background: equippedBg
              ? `linear-gradient(160deg, ${equippedBg[0]}, ${equippedBg[1]})`
              : 'linear-gradient(to bottom, #eef2ff, #ffffff)' }}
          >
            <PetSprite species={pet.species} state={pet.state} action={action} className="w-full h-full" evolutionStage={pet.evolutionStage} customSprite={pet.customSprite} />
            {/* 已装备装扮叠层（图标化呈现，精灵本体之外） */}
            {equippedIcons.hat && <span className="absolute top-2 left-1/2 -translate-x-1/2 text-3xl drop-shadow">{(equippedIcons as any).hat}</span>}
            {equippedIcons.glasses && <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl drop-shadow">{(equippedIcons as any).glasses}</span>}
            {equippedIcons.collar && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-2xl drop-shadow">{(equippedIcons as any).collar}</span>}
            {equippedIcons.toy && <span className="absolute bottom-3 right-3 text-2xl drop-shadow">{(equippedIcons as any).toy}</span>}
          </div>
          <div className="mt-2 text-center text-sm text-gray-500">{STATE_TEXT[pet.state]}</div>
        </div>

        {/* 照片变桌宠（rembg 抠图，24小时有效） */}
        <div className="card p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700 flex items-center gap-1">
              <ImagePlus size={15} /> 照片变桌宠
            </span>
            {pet.customSprite && (pet.customSpriteRemaining ?? 0) > 0 && (
              <span className="text-xs text-orange-500 flex items-center gap-1">
                <Clock size={12} /> 剩余 {formatRemaining(pet.customSpriteRemaining ?? 0)}
              </span>
            )}
          </div>
          {pet.customSprite ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-xs text-gray-500">
                已启用自定义形象，24小时后自动恢复默认。可在有效期内随时更换照片。
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={spriteUploading}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1"
              >
                <ImagePlus size={13} /> {spriteUploading ? '抠图中...' : '更换'}
              </button>
              <button
                onClick={handleDeleteSprite}
                disabled={spriteUploading}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50 flex items-center gap-1"
              >
                <Trash2 size={13} /> 恢复默认
              </button>
            </div>
          ) : (
            <div
              onClick={() => !spriteUploading && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handlePhotoUpload(file)
              }}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
              } ${spriteUploading ? 'opacity-50 pointer-events-none' : ''}`}
            >
              {spriteUploading ? (
                <div className="text-sm text-primary-500 animate-pulse">正在抠图，请稍候...</div>
              ) : (
                <>
                  <ImagePlus size={24} className="mx-auto text-gray-300 mb-1" />
                  <div className="text-sm text-gray-500">拖拽照片到这里，或点击选择</div>
                  <div className="text-xs text-gray-400 mt-1">支持 JPEG/PNG/WebP，抠图后透明背景显示 · 24小时有效</div>
                </>
              )}
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) handlePhotoUpload(file)
              e.target.value = ''
            }}
          />
        </div>

        {/* 进化阶段（成长体系） */}
        {evolution && (
          <div className="card p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700 flex items-center gap-1">
                <Sparkles size={15} /> 进化阶段
              </span>
              <span className="text-xs text-gray-500">{evolution.currentStage.aura || '⭐'} {evolution.currentStage.title}</span>
            </div>
            {evolution.nextStage ? (
              <div className="mt-2">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary-500 to-teal-500 transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ((pet.level - evolution.currentStage.level) / (evolution.nextStage.level - evolution.currentStage.level)) * 100)}%`,
                    }}
                  />
                </div>
                <div className="text-[11px] text-gray-400 mt-1">
                  距「{evolution.nextStage.title}」还需 Lv{evolution.nextLevelNeeded}
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-primary-600 mt-2 font-medium">已达成最高形态 · {evolution.currentStage.title} 👑</div>
            )}
          </div>
        )}

        {/* 成长档案（等级 / 经验加成） */}
        <div className="card p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Coins size={15} /> 成长档案</span>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary-50 text-primary-600 font-medium">Lv{pet.level}</span>
          </div>
          <div className="mt-2 flex items-end gap-2">
            <span className="text-2xl font-bold text-gray-800">Lv{pet.level}</span>
            <span className="text-xs text-gray-400 mb-1">EXP {pet.exp}</span>
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className="px-2 py-1 rounded-lg bg-amber-50 text-amber-600 text-xs font-medium">经验加成 +{Math.round((Math.min(1 + pet.level * 0.02, 1.5) - 1) * 100)}%</span>
            <span className="text-[11px] text-gray-400">等级越高互动/小游戏经验越多（上限 +50%）</span>
          </div>
          <div className="mt-2 text-[11px] text-gray-400">
            {evolution?.nextStage
              ? `距下一形态还需升 ${Math.max(0, (evolution.nextLevelNeeded ?? 0) - pet.level)} 级`
              : '已抵达最高形态 · 传说 👑'}
            {' · '}专属互动已解锁 {specialActions.filter((s) => s.unlocked).length}/{specialActions.length}
          </div>
        </div>

        {/* 四维状态 */}
        <div className="card p-4 space-y-3">
          <StatBar label="饱食" icon={<Utensils size={13} />} value={pet.hunger} color="#f59e0b" />
          <StatBar label="心情" icon={<Smile size={13} />} value={pet.mood} color="#ec4899" />
          <StatBar label="清洁" icon={<Sparkles size={13} />} value={pet.clean} color="#06b6d4" />
          <StatBar label="精力" icon={<BatteryCharging size={13} />} value={pet.energy} color="#22c55e" />
        </div>

        {/* 互动按钮 */}
        <div className="grid grid-cols-4 gap-2">
          {([
            { t: 'feed', label: '喂食', icon: <Utensils size={18} /> },
            { t: 'play', label: '玩耍', icon: <Gamepad2 size={18} /> },
            { t: 'clean', label: '洗澡', icon: <Sparkles size={18} /> },
            { t: 'sleep', label: '睡觉', icon: <BatteryCharging size={18} /> },
          ] as { t: ActionType; label: string; icon: React.ReactNode }[]).map((b) => (
            <button
              key={b.t}
              onClick={() => doAction(b.t)}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white shadow-sm border border-gray-100 hover:bg-primary-50 active:scale-95 transition"
            >
              <span className="text-primary-600">{b.icon}</span>
              <span className="text-xs text-gray-600">{b.label}</span>
            </button>
          ))}
        </div>

        {/* 专属互动（等级特权） */}
        {specialActions.length > 0 && (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Sparkles size={15} /> 专属互动</span>
              <span className="text-xs text-gray-400">等级越高解锁越多</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {specialActions.map((sa) => (
                <button
                  key={sa.key}
                  disabled={!sa.unlocked}
                  onClick={() => doAction(sa.key as ActionType)}
                  className={`flex flex-col items-center gap-1 py-3 rounded-2xl border transition ${
                    sa.unlocked
                      ? 'bg-white shadow-sm border-gray-100 hover:bg-primary-50 active:scale-95'
                      : 'bg-gray-50 border-gray-100 opacity-60 cursor-not-allowed'
                  }`}
                >
                  <span className="text-2xl">{sa.key === 'walk' ? '🚶' : '💪'}</span>
                  <span className="text-xs text-gray-600">{sa.name}</span>
                  {!sa.unlocked && <span className="text-[10px] text-gray-400">Lv{sa.unlockLevel} 解锁</span>}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 每日签到 */}
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
              <button onClick={handleCheckin} className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium active:scale-95 flex items-center gap-1">
                <CalendarCheck size={13} /> 签到领币
              </button>
            )}
          </div>
          {(pet.checkinTotal ?? 0) > 0 && (
            <div className="text-[11px] text-gray-400 mt-1">累计签到 {pet.checkinTotal} 天</div>
          )}
        </div>

        {/* 小游戏合集 */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><Gamepad2 size={15} /> 桌面小游戏</span>
          </div>
          <div className="flex gap-1 mb-3 text-xs">
            {([
              { k: 'catch', label: '接食物' },
              { k: 'poke', label: '逗一逗' },
              { k: 'memory', label: '记忆翻牌' },
            ] as { k: typeof game; label: string }[]).map((g) => (
              <button
                key={g.k}
                onClick={() => setGame(g.k)}
                className={`flex-1 py-1.5 rounded-lg transition ${
                  game === g.k ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          {game === 'catch' && (
            <>
              <CatchGame disabled={false} onCatch={() => { setScore((s) => s + 1); doAction('feed') }} />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">本轮已接 <b className="text-primary-600">{score}</b> 个</span>
                <button
                  onClick={() => settleGame('catch', score)}
                  className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium active:scale-95"
                >
                  结算本轮
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-2">点击下落的食物喂它并得分；结算后得分兑换金币与经验。</p>
            </>
          )}
          {game === 'poke' && (
            <>
              <PokeGame disabled={false} onPoke={playThrottled} onSettle={(s) => settleGame('poke', s)} />
              <p className="text-xs text-gray-400 mt-2">10 秒内拼命戳它，戳得越多心情涨得越多（已限流，不会刷爆后端）。</p>
            </>
          )}
          {game === 'memory' && (
            <>
              <MemoryGame disabled={false} onWin={() => { doAction('play'); settleGame('memory', MEM_EMOJIS.length) }} />
              <p className="text-xs text-gray-400 mt-2">翻开卡片找出成对图案，全部配对完成宠物获得奖励。</p>
            </>
          )}
        </div>

        {/* 装扮商店 */}
        <div className="card p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><ShoppingBag size={15} /> 装扮商店</span>
            <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
              <Coins size={13} /> {shopCoins}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {shop?.items.map((it) => {
              const canBuy = !it.owned && !it.locked && shopCoins >= it.cost
              const rarityColor = it.rarity === 'epic'
                ? 'bg-purple-100 text-purple-700'
                : it.rarity === 'rare'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-gray-100 text-gray-500'
              const rarityText = it.rarity === 'epic' ? '稀有' : it.rarity === 'rare' ? '珍稀' : '普通'
              return (
                <div key={it.key} className={`rounded-xl border p-2.5 flex flex-col ${it.locked ? 'border-gray-100 bg-gray-50 opacity-70' : it.equipped ? 'border-primary-400 bg-primary-50' : 'border-gray-100 bg-white'}`}>
                  <div className="flex items-center justify-between">
                    <span className="text-2xl">{it.icon}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${rarityColor}`}>{rarityText}</span>
                  </div>
                  <div className="text-sm font-medium text-gray-700 mt-1">{it.name}</div>
                  <div className="text-[11px] text-gray-400 leading-tight mb-2">{it.desc}</div>
                  {!it.owned ? (
                    <button
                      disabled={!canBuy}
                      onClick={() => handleBuy(it.key, it.cost)}
                      className={`mt-auto py-1.5 rounded-lg text-xs font-medium active:scale-95 transition ${canBuy ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
                    >
                      {it.locked ? `Lv${it.unlockLevel} 解锁` : shopCoins >= it.cost ? `购买 ${it.cost}🪙` : `差 ${it.cost - shopCoins}🪙`}
                    </button>
                  ) : it.equipped ? (
                    <button onClick={() => handleUnequip(it.slot)} className="mt-auto py-1.5 rounded-lg text-xs font-medium bg-primary-100 text-primary-700 active:scale-95">
                      卸下
                    </button>
                  ) : (
                    <button onClick={() => handleEquip(it.key)} className="mt-auto py-1.5 rounded-lg text-xs font-medium bg-gray-800 text-white active:scale-95">
                      装备
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">用玩游戏赚来的金币购买装扮，按槽位自由搭配（同一槽位仅可装备一件）。</p>
        </div>

        {/* 宠物排行榜（跨会话） */}
        {leaderboard.length > 0 && (
          <div className="card p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 flex items-center gap-1"><PawPrint size={15} /> 宠物排行榜</span>
              <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5 text-[11px]">
                {([['all', '总榜'], ['week', '周榜'], ['month', '月榜']] as [LeaderboardRange, string][]).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => switchRange(k)}
                    className={`px-2 py-1 rounded-md transition-colors ${range === k ? 'bg-white text-primary-600 shadow-sm font-medium' : 'text-gray-500'}`}
                  >{label}</button>
                ))}
              </div>
            </div>
            <div className="space-y-1 max-h-64 overflow-y-auto">
              {leaderboard.map((e) => (
                <div
                  key={e.petId}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm ${e.isMe ? 'bg-primary-50 border border-primary-200' : 'bg-gray-50'}`}
                >
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
        )}
      </div>

      {/* 添加宠物弹窗 */}
      {showAddPet && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setShowAddPet(false)}>
          <div className="bg-white rounded-2xl p-5 w-full max-w-xs space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="text-base font-bold text-gray-800">添加新宠物</span>
              <button onClick={() => setShowAddPet(false)} className="p-1 text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">宠物名字</label>
              <input
                value={newPetName}
                onChange={(e) => setNewPetName(e.target.value)}
                maxLength={12}
                placeholder="给新宠物起个名字…"
                className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm focus:outline-none focus:border-primary-400"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleCreatePet()}
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">选择物种</label>
              <div className="flex gap-2">
                {([
                  { k: 'shiba' as const, emoji: '🐕', label: '柴犬' },
                  { k: 'corgi' as const, emoji: '🐶', label: '柯基' },
                  { k: 'panda' as const, emoji: '🐼', label: '熊猫' },
                  { k: 'cat' as const, emoji: '🐱', label: '猫' },
                  { k: 'snake' as const, emoji: '🐍', label: '蛇' },
                ]).map((s) => (
                  <button
                    key={s.k}
                    onClick={() => setNewPetSpecies(s.k)}
                    className={`flex-1 py-3 rounded-xl border-2 transition-all ${newPetSpecies === s.k ? 'border-primary-400 bg-primary-50 scale-105' : 'border-gray-100 bg-white hover:border-gray-300'}`}
                  >
                    <div className="text-2xl">{s.emoji}</div>
                    <div className="text-xs text-gray-600 mt-1">{s.label}</div>
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                领养上限随账号等级提升：Lv1-5 可领养 1 只，之后每 6 级 +1（当前上限 {maxPets} 只）
              </p>
            </div>
            <button
              onClick={handleCreatePet}
              className="w-full py-2.5 rounded-xl bg-primary-500 text-white text-sm font-medium active:scale-95 transition"
            >
              创建宠物
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
