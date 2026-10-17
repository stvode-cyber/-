import { useEffect, useRef, useState } from 'react'
import PetSprite, { type PetState } from '../PetSprite'
import { X } from 'lucide-react'
import type { PetDTO, PetListItem } from '../../lib/api'

export type ActionType = 'feed' | 'play' | 'clean' | 'sleep' | 'walk' | 'train'

export const STATE_TEXT: Record<PetState, string> = {
  happy: '很开心 😊', hungry: '饿了，想吃东西 🍖', dirty: '有点脏，要洗澡 🫧',
  sleepy: '困了，想睡觉 😴', sad: '有点不开心…',
}

/** 桌面宠物拖拽浮窗 */
export function PetFloat({ pet, petList, action, playThrottled, doAction, handleSwitchPet }: {
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

  useEffect(() => {
    if (action) {
      setShowHearts(true)
      const t = setTimeout(() => setShowHearts(false), 1500)
      return () => clearTimeout(t)
    }
  }, [action])

  useEffect(() => {
    const texts = STATE_TEXT[pet.state] ? [STATE_TEXT[pet.state]] : ['...']
    let idx = 0
    setBubbleText(texts[0])
    const timer = setInterval(() => { idx = (idx + 1) % texts.length; setBubbleText(texts[idx]) }, 5000)
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
      ;(window as any).desktopAPI?.movePetWindow?.(dx, dy)
      dragState.current.startX = e.clientX
      dragState.current.startY = e.clientY
    }
  }
  const onPointerUp = () => {
    if (dragState.current.isDragging && !dragState.current.moved) playThrottled()
    dragState.current.isDragging = false
  }

  return (
    <div
      className="w-full h-full flex flex-col items-center justify-center bg-transparent select-none relative cursor-grab active:cursor-grabbing"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
    >
      <style>{`@keyframes pet-breath{0%,100%{transform:scale(1)}50%{transform:scale(1.04)}}@keyframes heart-up{0%{opacity:1;transform:translateY(0)scale(0.5)}100%{opacity:0;transform:translateY(-40px)scale(1.2)}}@keyframes bubble-pop{0%{opacity:0;transform:scale(0.8)translateY(4px)}100%{opacity:1;transform:scale(1)translateY(0)}}.pet-breath{animation:pet-breath 2.5s ease-in-out infinite}.heart-particle{animation:heart-up 1.2s ease-out forwards}.pet-bubble{animation:bubble-pop 0.3s ease-out}`}</style>
      <div className="absolute top-0 left-0 right-0 flex justify-end gap-1 p-1 z-10">
        <button onClick={(e) => { e.stopPropagation(); (window as any).desktopAPI?.togglePetWindow?.() }} className="w-6 h-6 flex items-center justify-center rounded-full bg-white/60 hover:bg-white/90 text-gray-500 hover:text-gray-700 shadow-sm" title="隐藏" onPointerDown={(e) => e.stopPropagation()}><span className="text-[10px]">—</span></button>
        <button onClick={(e) => { e.stopPropagation(); (window as any).desktopAPI?.closePetWindow?.() }} className="w-6 h-6 flex items-center justify-center rounded-full bg-white/60 hover:bg-red-100 text-gray-500 hover:text-red-500 shadow-sm" title="关闭" onPointerDown={(e) => e.stopPropagation()}><X size={12} /></button>
      </div>
      {bubbleText && <div className="pet-bubble absolute top-7 left-1/2 -translate-x-1/2 px-2 py-1 rounded-lg bg-white/90 text-[10px] text-gray-600 shadow whitespace-nowrap max-w-[140px] text-center">{bubbleText}</div>}
      <div className="relative w-40 h-40">
        <div className="absolute inset-0 pet-breath"><PetSprite species={pet.species} state={pet.state} action={action} evolutionStage={pet.evolutionStage} customSprite={pet.customSprite} /></div>
        {showHearts && (<><span className="heart-particle absolute left-1/2 top-1/2 text-pink-400 text-sm">❤</span><span className="heart-particle absolute left-1/3 top-1/2 text-pink-300 text-xs" style={{ animationDelay: '0.2s' }}>❤</span><span className="heart-particle absolute right-1/3 top-1/2 text-red-300 text-xs" style={{ animationDelay: '0.4s' }}>❤</span></>)}
      </div>
      <div className="text-sm font-medium text-gray-700 mt-1 px-2 py-0.5 rounded-full bg-white/60 backdrop-blur-sm">{pet.name} · Lv{pet.level}</div>
      <div className="flex gap-1 mt-2">
        {(['feed', 'play', 'clean', 'sleep'] as ActionType[]).map((t) => (
          <button key={t} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); doAction(t) }} className="px-2 py-1 text-xs rounded-lg bg-white/80 shadow text-gray-700 hover:bg-white active:scale-90 transition-transform">
            {t === 'feed' ? '🍖' : t === 'play' ? '🎾' : t === 'clean' ? '🫧' : '😴'}
          </button>
        ))}
      </div>
      {petList.length > 1 && (
        <div className="flex gap-1 mt-2">
          {petList.map((p) => (
            <button key={p.id} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); handleSwitchPet(p.id) }} className={`w-2 h-2 rounded-full transition-all ${p.isActive ? 'bg-primary-500 scale-125' : 'bg-gray-300 hover:bg-gray-400'}`} title={`${p.name} · Lv${p.level}`} />
          ))}
        </div>
      )}
    </div>
  )
}

export function StatBar({ label, icon, value, color }: { label: string; icon: React.ReactNode; value: number; color: string }) {
  return (<div><div className="flex items-center justify-between text-xs text-gray-500 mb-1"><span className="flex items-center gap-1">{icon}{label}</span><span className="tabular-nums">{value}</span></div><div className="h-2 bg-gray-100 rounded-full overflow-hidden"><div className="h-full rounded-full transition-all duration-500" style={{ width: `${value}%`, background: color }} /></div></div>)
}

export function CatchGame({ onCatch, disabled }: { onCatch: () => void; disabled: boolean }) {
  const [items, setItems] = useState<{ id: number; x: number; y: number; emoji: string }[]>([])
  const idRef = useRef(0); const lastFeedRef = useRef(0)
  useEffect(() => {
    const spawn = setInterval(() => {
      if (disabled) return
      const id = idRef.current++; const emoji = ['🍖', '🍎', '🍪', '🥕', '🍣'][Math.floor(Math.random() * 5)]
      setItems((prev) => [...prev, { id, x: Math.random() * 80, y: 0, emoji }])
    }, 700)
    const move = setInterval(() => setItems((prev) => prev.map((it) => ({ ...it, y: it.y + 6 })).filter((it) => it.y < 100)), 50)
    return () => { clearInterval(spawn); clearInterval(move) }
  }, [disabled])
  const catchIt = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id))
    const now = Date.now(); if (now - lastFeedRef.current > 350) { lastFeedRef.current = now; onCatch() }
  }
  return (
    <div className="relative w-full h-44 bg-gradient-to-b from-sky-100 to-indigo-100 rounded-2xl overflow-hidden border border-sky-200">
      <div className="absolute top-2 left-3 text-xs text-sky-600 font-medium">点食物喂它！</div>
      {items.map((it) => (<button key={it.id} onClick={() => catchIt(it.id)} className="absolute text-2xl select-none active:scale-90 transition-transform" style={{ left: `${it.x}%`, top: `${it.y}%` }}>{it.emoji}</button>))}
      {items.length === 0 && <div className="absolute inset-0 flex items-center justify-center text-sky-300 text-sm">等待食物落下…</div>}
    </div>
  )
}

export function PokeGame({ onPoke, onSettle, disabled }: { onPoke: () => void; onSettle?: (score: number) => void; disabled: boolean }) {
  const DURATION = 10
  const [time, setTime] = useState(DURATION); const [count, setCount] = useState(0); const [running, setRunning] = useState(false); const [done, setDone] = useState(false); const [bounce, setBounce] = useState(false)
  const countRef = useRef(0); const settledRef = useRef(false)
  const start = () => { if (disabled) return; setRunning(true); setDone(false); setTime(DURATION); setCount(0); countRef.current = 0 }
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTime((v) => Math.max(0, +(v - 0.1).toFixed(1))), 100)
    const end = setTimeout(() => { setRunning(false); setDone(true); if (!settledRef.current) { settledRef.current = true; onSettle?.(countRef.current) } }, DURATION * 1000)
    return () => { clearInterval(t); clearTimeout(end) }
  }, [running, onSettle])
  const poke = () => { if (!running || disabled) return; countRef.current += 1; setCount(countRef.current); setBounce(true); setTimeout(() => setBounce(false), 120); onPoke() }
  return (
    <div className="flex flex-col items-center gap-3 py-2">
      <div onClick={poke} className={`text-6xl cursor-pointer select-none transition-transform ${bounce ? 'scale-125' : 'scale-100'} ${running ? 'hover:scale-110' : ''}`}>🐾</div>
      {!running && !done && <button onClick={start} className="px-4 py-2 rounded-xl bg-primary-500 text-white text-sm font-medium active:scale-95">{disabled ? '互动中…' : '开始逗它（10秒）'}</button>}
      {running && <div className="text-sm text-gray-600">疯狂戳它！剩余 <span className="font-bold text-primary-600">{time.toFixed(1)}s</span> · 已戳 {count} 下</div>}
      {done && <div className="text-center text-sm text-gray-600">你戳了 <span className="font-bold text-primary-600">{count}</span> 下，它超开心！😸<br /><span className="text-xs text-gray-400">（戳的过程中已自动陪玩涨心情）</span></div>}
    </div>
  )
}

export const MEM_EMOJIS = ['🍎', '⚽', '🌟', '🐟', '🎵', '🌸']
export function MemoryGame({ onWin, disabled }: { onWin: () => void; disabled: boolean }) {
  const [cards, setCards] = useState<{ id: number; emoji: string; flipped: boolean; matched: boolean }[]>([])
  const [flipped, setFlipped] = useState<number[]>([]); const [lock, setLock] = useState(false); const [pairs, setPairs] = useState(0); const [won, setWon] = useState(false)
  const shuffle = () => {
    const deck = [...MEM_EMOJIS, ...MEM_EMOJIS].map((e, i) => ({ id: i, emoji: e, flipped: false, matched: false })).sort(() => Math.random() - 0.5)
    setCards(deck); setFlipped([]); setLock(false); setPairs(0); setWon(false)
  }
  useEffect(() => { shuffle() }, [])
  const click = (idx: number) => {
    if (disabled || lock || won) return
    const c = cards[idx]; if (c.flipped || c.matched) return
    const next = [...flipped, idx]; const nextCards = cards.map((x, i) => (i === idx ? { ...x, flipped: true } : x))
    setFlipped(next); setCards(nextCards)
    if (next.length === 2) {
      setLock(true); const [a, b] = next
      if (nextCards[a].emoji === nextCards[b].emoji) {
        setTimeout(() => { setCards((prev) => prev.map((x, i) => (i === a || i === b ? { ...x, matched: true } : x))); setPairs((p) => p + 1); setFlipped([]); setLock(false) }, 350)
      } else {
        setTimeout(() => { setCards((prev) => prev.map((x, i) => (i === a || i === b ? { ...x, flipped: false } : x))); setFlipped([]); setLock(false) }, 700)
      }
    }
  }
  useEffect(() => { if (pairs === MEM_EMOJIS.length && !won) { setWon(true); onWin() } }, [pairs, won, onWin])
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="grid grid-cols-4 gap-1.5 w-full max-w-[280px]">
        {cards.map((c, i) => (<button key={c.id} onClick={() => click(i)} disabled={disabled || c.matched} className={`aspect-square rounded-lg text-xl flex items-center justify-center transition-all ${c.flipped || c.matched ? 'bg-white shadow-inner' : 'bg-primary-100 hover:bg-primary-200'} ${c.matched ? 'opacity-50' : ''}`}>{c.flipped || c.matched ? c.emoji : '❓'}</button>))}
      </div>
      <div className="flex items-center gap-3 text-xs text-gray-500"><span>已配对 {pairs}/{MEM_EMOJIS.length}</span><button onClick={shuffle} className="px-2 py-1 rounded-lg bg-gray-100 hover:bg-gray-200">重开</button></div>
      {won && <div className="text-sm text-primary-600 font-medium">全部配对！宠物获得奖励 🎁</div>}
    </div>
  )
}
