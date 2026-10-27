import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../components/Toast'
import {
  getPet, petAction, petRename, playGame, getPetShop, buyPetItem, equipPetItem, unequipPetSlot,
  petCheckin, getPetEvolution, getPetSpecialActions, getPetLeaderboard, getPetList, createPet,
  switchPet, deletePet, uploadCustomSprite, deleteCustomSprite,
  type PetDTO, type PetShopDTO, type PetSlot, type PetEvolutionDTO, type PetSpecialAction,
  type PetLeaderboardEntry, type LeaderboardRange, type PetListItem,
} from '../lib/api'
import { isDesktop } from '../lib/localCache'
import PetSprite from '../components/PetSprite'
import { PetFloat, StatBar, CatchGame, PokeGame, MemoryGame, type ActionType, STATE_TEXT, MEM_EMOJIS } from '../components/pet/PetGames'
import {
  Utensils, Smile, Sparkles, BatteryCharging, PawPrint, Pencil, Check, X, Gamepad2,
  ImagePlus, Clock, Coins,
} from 'lucide-react'
import {
  PetListSection, SpecialActionsSection, CheckinSection, PetShopSection,
  LeaderboardSection, AddPetModal, formatRemaining,
} from '../components/pet/PetWidgets'

/**
 * 桌宠主页
 *
 * 拆分记录（2026-10-18，ChatPage 二次拆分 SOP 验证）：
 * - 原 862 行 → 现在 ~400 行
 * - 抽出 PetWidgets.tsx：PetList / 专属互动 / 签到 / 商店 / 排行榜 / 添加弹窗（6 个组件 + 工具函数）
 * - 主文件保留：状态管理 + 所有 load 函数 + 动作函数 + PetSprite JSX + 小游戏 JSX
 */
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
  const [petList, setPetList] = useState<PetListItem[]>([])
  const [maxPets, setMaxPets] = useState(1)
  const [showAddPet, setShowAddPet] = useState(false)
  const [newPetName, setNewPetName] = useState('')
  const [newPetSpecies, setNewPetSpecies] = useState<'shiba' | 'corgi' | 'panda' | 'cat' | 'snake'>('shiba')
  const [spriteUploading, setSpriteUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [game, setGame] = useState<'catch' | 'poke' | 'memory'>('catch')
  const lastPlayRef = useRef(0)
  const [range, setRange] = useState<LeaderboardRange>('all')
  const rangeRef = useRef<LeaderboardRange>('all')
  rangeRef.current = range

  const load = async () => {
    try { const p = await getPet(); setPet(p) }
    catch (e: any) { toast(e?.message || '加载宠物失败', 'error') }
    finally { setLoading(false) }
  }
  const loadShop = async () => { try { setShop(await getPetShop()) } catch { /* noop */ } }
  const loadEvolution = async () => { try { setEvolution(await getPetEvolution()) } catch { /* noop */ } }
  const loadSpecialActions = async () => { try { const r = await getPetSpecialActions(); setSpecialActions(r.specialActions) } catch { /* noop */ } }
  const loadLeaderboard = async () => { try { const r = await getPetLeaderboard(20, rangeRef.current); setLeaderboard(r.list) } catch { /* noop */ } }
  const loadPetList = async () => {
    try { const r = await getPetList(); setPetList(r.list); setMaxPets(r.maxPets) } catch { /* noop */ }
  }
  const switchRange = (r: LeaderboardRange) => { setRange(r); rangeRef.current = r; loadLeaderboard() }

  useEffect(() => {
    load(); loadShop(); loadEvolution(); loadSpecialActions(); loadLeaderboard(); loadPetList()
    const t = setInterval(() => { load(); loadShop(); loadEvolution(); loadSpecialActions(); loadLeaderboard(); loadPetList() }, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doAction = async (type: ActionType) => {
    setAction(type)
    try {
      const p = await petAction(type)
      setPet(p); loadEvolution()
      if (p.evolutionJustUnlocked) toast(`🎉 进化！解锁「${p.evolutionJustUnlocked.title}」${p.evolutionJustUnlocked.aura || ''}`, 'success')
      else if (p.levelUp) toast(`升级到 Lv${p.level}！`, 'success')
      else {
        const msg: Record<ActionType, string> = { feed: '喂食成功 🍖', play: '玩耍开心 🎾', clean: '洗白白 🫧', sleep: '睡个好觉 😴', walk: '遛弯愉快 🌳', train: '特训提升 💪' }
        toast(msg[type], 'success')
      }
    } catch (e: any) { toast(e?.message || '互动失败', 'error') }
    setTimeout(() => setAction(null), 1000)
  }

  const playThrottled = () => {
    const now = Date.now()
    if (now - lastPlayRef.current > 600) { lastPlayRef.current = now; doAction('play') }
  }

  const settleGame = async (game: 'catch' | 'poke' | 'memory', sc: number) => {
    if (sc <= 0) { toast('这局还没得分哦，再来一局～', 'info'); return }
    try {
      const p = await playGame(game, sc)
      setPet(p); loadEvolution()
      if (p.evolutionJustUnlocked) toast(`🎉 进化！解锁「${p.evolutionJustUnlocked.title}」${p.evolutionJustUnlocked.aura || ''}（升级到 Lv${p.level}）`, 'success')
      else if (p.levelUp) toast(`升级到 Lv${p.level}！🪙+${Math.ceil(sc / 2)} EXP+${sc}`, 'success')
      else toast(`🎉 游戏奖励 🪙+${Math.ceil(sc / 2)} EXP+${sc}`, 'success')
    } catch (e: any) { toast(e?.message || '结算失败', 'error') }
    setScore(0)
  }

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
        } catch (e: any) { toast(e?.message || '抠图失败，请稍后重试', 'error'); setSpriteUploading(false) }
      }
      reader.onerror = () => { toast('图片读取失败', 'error'); setSpriteUploading(false) }
      reader.readAsDataURL(file)
    } catch (e: any) { toast(e?.message || '上传失败', 'error'); setSpriteUploading(false) }
  }
  const handleDeleteSprite = async () => {
    try { await deleteCustomSprite(); setPet((prev) => prev ? { ...prev, customSprite: null, customSpriteExpireAt: null, customSpriteRemaining: 0 } : prev); toast('已恢复默认形象', 'info') }
    catch (e: any) { toast(e?.message || '操作失败', 'error') }
  }

  const saveName = async () => {
    const n = nameInput.trim(); if (!n) return
    try { const p = await petRename(n); setPet(p); setEditing(false); toast('改名成功', 'success') }
    catch (e: any) { toast(e?.message || '改名失败', 'error') }
  }

  const handleBuy = async (itemKey: string, cost: number) => {
    try { const r = await buyPetItem(itemKey); setPet((p) => (p ? { ...p, coins: r.coins } : p)); await loadShop(); toast(`购买成功 🪙-${cost}`, 'success') }
    catch (e: any) { toast(e?.message || '购买失败', 'error') }
  }
  const handleEquip = async (itemKey: string) => {
    try { const r = await equipPetItem(itemKey); setPet((p) => (p ? { ...p, equipped: r.equipped } : p)); await loadShop() }
    catch (e: any) { toast(e?.message || '装备失败', 'error') }
  }
  const handleUnequip = async (slot: PetSlot) => {
    try { const r = await unequipPetSlot(slot); setPet((p) => (p ? { ...p, equipped: r.equipped } : p)); await loadShop() }
    catch (e: any) { toast(e?.message || '卸下失败', 'error') }
  }
  const handleCheckin = async () => {
    try {
      const r = await petCheckin()
      setPet((p) => (p ? { ...p, coins: r.coins, checkedInToday: true, checkinStreak: r.streak, checkinTotal: r.total } : p))
      loadEvolution(); toast(`签到成功 🪙+${r.award}（含等级加成 ${r.levelBonus}）· 连续 ${r.streak} 天`, 'success')
    } catch (e: any) { toast(e?.message || '签到失败', 'error') }
  }
  const handleSwitchPet = async (petId: string) => {
    try { const p = await switchPet(petId); setPet(p); await loadPetList(); await loadShop(); await loadEvolution(); await loadSpecialActions(); toast('已切换宠物', 'success') }
    catch (e: any) { toast(e?.message || '切换失败', 'error') }
  }
  const handleCreatePet = async () => {
    const n = newPetName.trim(); if (!n) { toast('请输入宠物名字', 'info'); return }
    try { await createPet(n, newPetSpecies); setShowAddPet(false); setNewPetName(''); setNewPetSpecies('shiba'); await loadPetList(); await load(); toast('宠物创建成功 🎉', 'success') }
    catch (e: any) { toast(e?.message || '创建失败', 'error') }
  }
  const handleDeletePet = async (petId: string, name: string) => {
    if (!confirm(`确定要删除「${name}」吗？此操作不可撤销。`)) return
    try { await deletePet(petId); await loadPetList(); await load(); toast('宠物已删除', 'success') }
    catch (e: any) { toast(e?.message || '删除失败', 'error') }
  }

  if (loading) return <div className="app-shell flex items-center justify-center text-gray-400 py-20">加载中…</div>
  if (!pet) return <div className="app-shell flex items-center justify-center text-gray-400 py-20">宠物加载失败</div>

  const equippedBg = shop?.items.find((x) => x.key === pet.equipped?.background)?.bg ?? null
  const equippedIcons: Record<string, string | undefined> = {}
  for (const s of ['hat', 'glasses', 'collar', 'toy'] as const) {
    const key = pet.equipped?.[s]; if (key) { const it = shop?.items.find((x) => x.key === key); if (it) equippedIcons[s] = it.icon }
  }
  const shopCoins = shop?.coins ?? pet.coins

  if (float) {
    return <PetFloat pet={pet} petList={petList} action={action} playThrottled={playThrottled} doAction={doAction} handleSwitchPet={handleSwitchPet} />
  }

  return (
    <div className="app-shell pb-6">
      {/* 顶部渐变头部：名字 + 等级 + 状态 */}
      <div className="bg-gradient-to-br from-primary-500 to-teal-500 text-white px-4 pt-6 pb-8">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <PawPrint size={20} /><span className="text-lg font-bold">我的宠物</span>
          </div>
          {editing ? (
            <div className="flex items-center gap-1">
              <input value={nameInput} onChange={(e) => setNameInput(e.target.value)} maxLength={12}
                className="w-24 px-2 py-1 rounded text-gray-800 text-sm" placeholder="新名字" autoFocus />
              <button onClick={saveName} className="p-1 bg-white/20 rounded"><Check size={16} /></button>
              <button onClick={() => setEditing(false)} className="p-1 bg-white/20 rounded"><X size={16} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {isDesktop() && (
                <button onClick={() => (window as any).desktopAPI?.togglePetWindow?.()}
                  className="px-2 py-1.5 bg-white/20 rounded-full hover:bg-white/30 text-xs" title="在桌面显示宠物浮窗">桌面显示</button>
              )}
              <button onClick={() => { setNameInput(pet.name); setEditing(true) }}
                className="p-1.5 bg-white/20 rounded-full hover:bg-white/30"><Pencil size={15} /></button>
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
        {petList.length > 0 && (
          <PetListSection petList={petList} maxPets={maxPets} activeId={pet.id}
            onSwitch={handleSwitchPet} onDelete={handleDeletePet} onAdd={() => setShowAddPet(true)} />
        )}

        {/* 3D 宠物 + 状态 */}
        <div className="card p-3">
          <div className="h-56 rounded-2xl flex items-center justify-center relative overflow-hidden"
            style={{ background: equippedBg ? `linear-gradient(160deg, ${equippedBg[0]}, ${equippedBg[1]})` : 'linear-gradient(to bottom, #eef2ff, #ffffff)' }}>
            <PetSprite species={pet.species} state={pet.state} action={action} className="w-full h-full"
              evolutionStage={pet.evolutionStage} customSprite={pet.customSprite} />
            {equippedIcons.hat && <span className="absolute top-2 left-1/2 -translate-x-1/2 text-3xl drop-shadow">{equippedIcons.hat}</span>}
            {equippedIcons.glasses && <span className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-2xl drop-shadow">{equippedIcons.glasses}</span>}
            {equippedIcons.collar && <span className="absolute bottom-3 left-1/2 -translate-x-1/2 text-2xl drop-shadow">{equippedIcons.collar}</span>}
            {equippedIcons.toy && <span className="absolute bottom-3 right-3 text-2xl drop-shadow">{equippedIcons.toy}</span>}
          </div>
          <div className="mt-2 text-center text-sm text-gray-500">{STATE_TEXT[pet.state]}</div>
        </div>

        {/* 照片变桌宠 */}
        <div className="card p-3">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="font-medium text-gray-700 flex items-center gap-1"><ImagePlus size={15} /> 照片变桌宠</span>
            {pet.customSprite && (pet.customSpriteRemaining ?? 0) > 0 && (
              <span className="text-xs text-orange-500 flex items-center gap-1"><Clock size={12} /> 剩余 {formatRemaining(pet.customSpriteRemaining ?? 0)}</span>
            )}
          </div>
          {pet.customSprite ? (
            <div className="flex items-center gap-2">
              <div className="flex-1 text-xs text-gray-500">已启用自定义形象，24小时后自动恢复默认。可在有效期内随时更换照片。</div>
              <button onClick={() => fileInputRef.current?.click()} disabled={spriteUploading}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 flex items-center gap-1">
                <ImagePlus size={13} /> {spriteUploading ? '抠图中...' : '更换'}
              </button>
              <button onClick={handleDeleteSprite} disabled={spriteUploading}
                className="px-3 py-1.5 text-xs rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50">恢复默认</button>
            </div>
          ) : (
            <div onClick={() => !spriteUploading && fileInputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handlePhotoUpload(f) }}
              className={`border-2 border-dashed rounded-xl p-4 text-center cursor-pointer transition-colors ${
                dragOver ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
              } ${spriteUploading ? 'opacity-50 pointer-events-none' : ''}`}>
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
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = '' }} />
        </div>

        {/* 进化阶段 */}
        {evolution && (
          <div className="card p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-gray-700 flex items-center gap-1"><Sparkles size={15} /> 进化阶段</span>
              <span className="text-xs text-gray-500">{evolution.currentStage.aura || '⭐'} {evolution.currentStage.title}</span>
            </div>
            {evolution.nextStage ? (
              <div className="mt-2">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary-500 to-teal-500 transition-all duration-500"
                    style={{ width: `${Math.min(100, ((pet.level - evolution.currentStage.level) / (evolution.nextStage.level - evolution.currentStage.level)) * 100)}%` }} />
                </div>
                <div className="text-[11px] text-gray-400 mt-1">距「{evolution.nextStage.title}」还需 Lv{evolution.nextLevelNeeded}</div>
              </div>
            ) : (
              <div className="text-[11px] text-primary-600 mt-2 font-medium">已达成最高形态 · {evolution.currentStage.title} 👑</div>
            )}
          </div>
        )}

        {/* 成长档案 */}
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
            {evolution?.nextStage ? `距下一形态还需升 ${Math.max(0, (evolution.nextLevelNeeded ?? 0) - pet.level)} 级` : '已抵达最高形态 · 传说 👑'}
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
            <button key={b.t} onClick={() => doAction(b.t)}
              className="flex flex-col items-center gap-1 py-3 rounded-2xl bg-white shadow-sm border border-gray-100 hover:bg-primary-50 active:scale-95 transition">
              <span className="text-primary-600">{b.icon}</span>
              <span className="text-xs text-gray-600">{b.label}</span>
            </button>
          ))}
        </div>

        <SpecialActionsSection pet={pet} specialActions={specialActions} doAction={doAction} />
        <CheckinSection pet={pet} onCheckin={handleCheckin} />

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
              <button key={g.k} onClick={() => setGame(g.k)}
                className={`flex-1 py-1.5 rounded-lg transition ${game === g.k ? 'bg-primary-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{g.label}</button>
            ))}
          </div>
          {game === 'catch' && (
            <>
              <CatchGame disabled={false} onCatch={() => { setScore((s) => s + 1); doAction('feed') }} />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-gray-500">本轮已接 <b className="text-primary-600">{score}</b> 个</span>
                <button onClick={() => settleGame('catch', score)} className="px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium active:scale-95">结算本轮</button>
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

        <PetShopSection pet={pet} shop={shop} shopCoins={shopCoins}
          onBuy={handleBuy} onEquip={handleEquip} onUnequip={handleUnequip} />
        <LeaderboardSection leaderboard={leaderboard} range={range} onSwitchRange={switchRange} />
      </div>

      <AddPetModal show={showAddPet} maxPets={maxPets}
        newPetName={newPetName} newPetSpecies={newPetSpecies}
        onNameChange={setNewPetName} onSpeciesChange={setNewPetSpecies}
        onClose={() => setShowAddPet(false)} onCreate={handleCreatePet} />
    </div>
  )
}
