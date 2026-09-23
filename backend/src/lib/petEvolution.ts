// 宠物进化阶段（成长里程碑）：等级达到阈值即解锁对应形态 + 专属光环。
// 与等级系统联动，让"升级"从孤立的数字变为可见的进化，提升长期陪伴粘性。
export interface EvolutionStage {
  level: number // 达到该等级解锁
  stage: string // 阶段标识（英文 key，便于前端判断）
  title: string // 形态名称（中文）
  aura: string | null // 光环 emoji（null = 无）
  desc: string // 形态描述
}

// 升序排列：stageList[i].level <= stageList[i+1].level
export const EVOLUTION_STAGES: EvolutionStage[] = [
  { level: 1, stage: 'baby', title: '幼崽', aura: null, desc: '刚来到世界的小家伙，需要你多多陪伴' },
  { level: 3, stage: 'grow', title: '成长体', aura: '✨', desc: '羽翼渐丰，开始活泼好动' },
  { level: 5, stage: 'mature', title: '成熟体', aura: '🌟', desc: '气质沉稳，眼神里有了故事' },
  { level: 8, stage: 'full', title: '完全体', aura: '💫', desc: '耀眼的存在，走到哪里都发光' },
  { level: 12, stage: 'legend', title: '传说体', aura: '👑', desc: '传说级伙伴，荣耀加身' },
]

export interface EvolutionView {
  level: number
  currentStage: EvolutionStage
  currentStageIndex: number
  nextStage: EvolutionStage | null // 下一阶段（null = 已达最高）
  nextLevelNeeded: number | null // 距下一阶段还需等级（null = 已满级）
  unlockedStages: EvolutionStage[] // 已解锁的全部阶段（含当前）
  totalStages: number
}

// 根据等级计算进化视图（当前阶段 / 下一阶段 / 已解锁列表）
export function getEvolution(level: number): EvolutionView {
  let idx = 0
  for (let i = 0; i < EVOLUTION_STAGES.length; i++) {
    if (level >= EVOLUTION_STAGES[i].level) idx = i
    else break
  }
  const currentStage = EVOLUTION_STAGES[idx]
  const nextStage = idx + 1 < EVOLUTION_STAGES.length ? EVOLUTION_STAGES[idx + 1] : null
  const nextLevelNeeded = nextStage ? nextStage.level - level : null
  const unlockedStages = EVOLUTION_STAGES.slice(0, idx + 1)
  return {
    level,
    currentStage,
    currentStageIndex: idx,
    nextStage,
    nextLevelNeeded,
    unlockedStages,
    totalStages: EVOLUTION_STAGES.length,
  }
}

// 判断等级从 fromLevel 升到 toLevel 是否跨越了某个进化阶段阈值。
// 用于升级时返回"刚刚进化"提示；未跨越或降级返回 null。
export function evolutionUnlockedBetween(fromLevel: number, toLevel: number): EvolutionStage | null {
  if (toLevel <= fromLevel) return null
  for (const s of EVOLUTION_STAGES) {
    if (s.level > fromLevel && s.level <= toLevel) return s
  }
  return null
}
