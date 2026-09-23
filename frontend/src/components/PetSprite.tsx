import { useEffect, useState, useMemo } from 'react'
import shibaHappy from '../assets/pets/shiba_happy.png'
import shibaHungry from '../assets/pets/shiba_hungry.png'
import shibaSleepy from '../assets/pets/shiba_sleepy.png'
import shibaSad from '../assets/pets/shiba_sad.png'
import shibaDirty from '../assets/pets/shiba_dirty.png'
import corgiHappy from '../assets/pets/corgi_happy.png'
import corgiHungry from '../assets/pets/corgi_hungry.png'
import corgiSleepy from '../assets/pets/corgi_sleepy.png'
import corgiSad from '../assets/pets/corgi_sad.png'
import corgiDirty from '../assets/pets/corgi_dirty.png'
import pandaHappy from '../assets/pets/panda_happy.png'
import pandaHungry from '../assets/pets/panda_hungry.png'
import pandaSleepy from '../assets/pets/panda_sleepy.png'
import pandaSad from '../assets/pets/panda_sad.png'
import pandaDirty from '../assets/pets/panda_dirty.png'
import catHappy from '../assets/pets/cat_happy.png'
import catHungry from '../assets/pets/cat_hungry.png'
import catSleepy from '../assets/pets/cat_sleepy.png'
import catSad from '../assets/pets/cat_sad.png'
import catDirty from '../assets/pets/cat_dirty.png'
import snakeHappy from '../assets/pets/snake_happy.png'
import snakeHungry from '../assets/pets/snake_hungry.png'
import snakeSleepy from '../assets/pets/snake_sleepy.png'
import snakeSad from '../assets/pets/snake_sad.png'
import snakeDirty from '../assets/pets/snake_dirty.png'

export type PetSpecies = 'shiba' | 'corgi' | 'panda' | 'cat' | 'snake'
export type PetState = 'happy' | 'hungry' | 'dirty' | 'sleepy' | 'sad'
/** 动作类型：决定播放哪套 3D 动画 */
export type PetAction = 'idle' | 'feed' | 'play' | 'clean' | 'sleep' | 'walk' | 'pet' | null

/** 各物种状态表情图（AI 生成盲盒手办风）*/
const SPECIES_STATE_IMAGES: Record<PetSpecies, Record<PetState, string>> = {
  shiba: { happy: shibaHappy, hungry: shibaHungry, dirty: shibaDirty, sleepy: shibaSleepy, sad: shibaSad },
  corgi: { happy: corgiHappy, hungry: corgiHungry, dirty: corgiDirty, sleepy: corgiSleepy, sad: corgiSad },
  panda: { happy: pandaHappy, hungry: pandaHungry, dirty: pandaDirty, sleepy: pandaSleepy, sad: pandaSad },
  cat: { happy: catHappy, hungry: catHungry, dirty: catDirty, sleepy: catSleepy, sad: catSad },
  snake: { happy: snakeHappy, hungry: snakeHungry, dirty: snakeDirty, sleepy: snakeSleepy, sad: snakeSad },
}

const SPECIES_NAMES: Record<PetSpecies, string> = { shiba: '柴犬', corgi: '柯基', panda: '熊猫', cat: '猫', snake: '蛇' }

/** 2D 精灵的进化阶段视觉参数（尺寸 + 传说金身滤镜）*/
function spriteEvolutionVisual(stage?: string) {
  const scaleMap: Record<string, number> = { baby: 0.82, grow: 0.9, mature: 1.0, full: 1.08, legend: 1.18 }
  const scale = scaleMap[stage ?? 'baby'] ?? 0.82
  const legend = stage === 'legend'
  const filter = legend ? 'sepia(0.45) saturate(1.9) hue-rotate(-8deg) brightness(1.06)' : undefined
  const glow = legend ? 'drop-shadow(0 0 16px rgba(245,179,26,0.85))' : undefined
  return { scale, filter, glow }
}

/** 动作 → 3D 动画类名映射 */
function actionAnimClass(action: PetAction, state: PetState): string {
  switch (action) {
    case 'feed': return 'pet-3d-eat'       // 吃东西：前倾+咀嚼
    case 'play': return 'pet-3d-play'      // 玩耍：跳跃+旋转
    case 'clean': return 'pet-3d-shake'    // 洗澡：抖水
    case 'sleep': return 'pet-3d-sleep'    // 睡觉：躺下+呼吸
    case 'walk': return 'pet-3d-walk'      // 走路：左右移动+摆动
    case 'pet': return 'pet-3d-pet'        // 摸摸：眯眼+晃头
    default:
      // 待机动画：根据状态选择
      if (state === 'sleepy') return 'pet-3d-idle-sleepy'
      if (state === 'hungry') return 'pet-3d-idle-hungry'
      if (state === 'sad') return 'pet-3d-idle-sad'
      return 'pet-3d-idle'                  // 默认待机：呼吸+轻微摇摆
  }
}

/** 动作触发的粒子/表情特效 */
function actionEffect(action: PetAction): { emoji: string; count: number } | null {
  switch (action) {
    case 'feed': return { emoji: '🍖', count: 3 }
    case 'play': return { emoji: '✨', count: 4 }
    case 'clean': return { emoji: '💧', count: 5 }
    case 'sleep': return { emoji: '💤', count: 2 }
    case 'pet': return { emoji: '❤', count: 3 }
    default: return null
  }
}

interface Props {
  species?: PetSpecies
  state?: PetState
  action?: string | null
  className?: string
  evolutionStage?: string
  customSprite?: string | null
}

export default function PetSprite({ species = 'shiba', state = 'happy', action = null, className, evolutionStage, customSprite }: Props) {
  const [animKey, setAnimKey] = useState(0)
  const [blinkKey, setBlinkKey] = useState(0)
  const actionTyped = (action as PetAction) || null

  // action 变化时重置动画 key 触发重播
  useEffect(() => {
    if (action) setAnimKey((k) => k + 1)
  }, [action])

  // 随机眨眼（让宠物有生命力）
  useEffect(() => {
    const timer = setInterval(() => {
      setBlinkKey((k) => k + 1)
    }, 3000 + Math.random() * 2000)
    return () => clearInterval(timer)
  }, [])

  const spriteSrc = customSprite || SPECIES_STATE_IMAGES[species][state]
  const evo = spriteEvolutionVisual(evolutionStage)
  const stateFilter =
    state === 'sad' ? 'brightness(0.88) saturate(0.6)' :
    state === 'sleepy' ? 'brightness(0.92)' :
    state === 'hungry' ? 'saturate(0.8)' : undefined
  const filters = [evo.filter, stateFilter].filter(Boolean).join(' ')
  const animClass = actionAnimClass(actionTyped, state)
  const effect = useMemo(() => actionEffect(actionTyped), [actionTyped])

  return (
    <div className={className} style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative', perspective: '600px' }}>
      <style>{`
        /* === 3D 透视容器 === */
        .pet-3d-stage {
          transform-style: preserve-3d;
          will-change: transform;
        }

        /* === 待机动画：呼吸 + 轻微 3D 摇摆 === */
        @keyframes idle-3d {
          0%, 100% { transform: rotateY(-3deg) rotateX(2deg) translateY(0) scale(1); }
          25% { transform: rotateY(0deg) rotateX(0deg) translateY(-4px) scale(1.01); }
          50% { transform: rotateY(3deg) rotateX(2deg) translateY(-6px) scale(1.02); }
          75% { transform: rotateY(0deg) rotateX(0deg) translateY(-4px) scale(1.01); }
        }
        .pet-3d-idle { animation: idle-3d 3s ease-in-out infinite; }

        /* 困倦待机：缓慢摇晃 + 低头 */
        @keyframes idle-sleepy {
          0%, 100% { transform: rotateZ(-5deg) translateY(0) rotateY(0); }
          50% { transform: rotateZ(5deg) translateY(2px) rotateY(-8deg); }
        }
        .pet-3d-idle-sleepy { animation: idle-sleepy 4s ease-in-out infinite; }

        /* 饿了待机：前倾张望 */
        @keyframes idle-hungry {
          0%, 100% { transform: rotateX(8deg) translateY(0) scale(1); }
          50% { transform: rotateX(12deg) translateY(-2px) scale(1.02); }
        }
        .pet-3d-idle-hungry { animation: idle-hungry 1.5s ease-in-out infinite; }

        /* 难过待机：下垂 + 偶尔颤抖 */
        @keyframes idle-sad {
          0%, 90%, 100% { transform: rotateZ(-3deg) translateY(2px) scale(0.98); }
          95% { transform: rotateZ(-3deg) translateY(0) scale(0.98) rotateY(-5deg); }
        }
        .pet-3d-idle-sad { animation: idle-sad 5s ease-in-out infinite; }

        /* === 吃东西动画：前倾 + 咀嚼缩放 === */
        @keyframes eat-3d {
          0% { transform: rotateX(0) scale(1); }
          20% { transform: rotateX(15deg) translateY(2px) scale(1.03); }
          40% { transform: rotateX(15deg) translateY(2px) scale(0.97); }
          60% { transform: rotateX(15deg) translateY(2px) scale(1.03); }
          80% { transform: rotateX(15deg) translateY(2px) scale(0.97); }
          100% { transform: rotateX(0) scale(1); }
        }
        .pet-3d-eat { animation: eat-3d 0.8s ease-in-out; }

        /* === 玩耍动画：跳跃 + 360 旋转 === */
        @keyframes play-3d {
          0% { transform: translateY(0) rotateY(0) scale(1); }
          25% { transform: translateY(-40px) rotateY(180deg) scale(1.1); }
          50% { transform: translateY(-50px) rotateY(360deg) scale(1.15); }
          75% { transform: translateY(-30px) rotateY(540deg) scale(1.1); }
          100% { transform: translateY(0) rotateY(720deg) scale(1); }
        }
        .pet-3d-play { animation: play-3d 1.2s ease-out; }

        /* === 洗澡/抖水动画：快速左右抖动 === */
        @keyframes shake-3d {
          0%, 100% { transform: rotateZ(0) translateX(0); }
          10% { transform: rotateZ(-8deg) translateX(-3px); }
          20% { transform: rotateZ(8deg) translateX(3px); }
          30% { transform: rotateZ(-8deg) translateX(-3px); }
          40% { transform: rotateZ(8deg) translateX(3px); }
          50% { transform: rotateZ(-6deg) translateX(-2px); }
          60% { transform: rotateZ(6deg) translateX(2px); }
          70% { transform: rotateZ(-4deg) translateX(-1px); }
          80% { transform: rotateZ(4deg) translateX(1px); }
          90% { transform: rotateZ(-2deg) translateX(0); }
        }
        .pet-3d-shake { animation: shake-3d 1s ease-in-out; }

        /* === 睡觉动画：躺下 + 慢呼吸 === */
        @keyframes sleep-3d {
          0% { transform: rotateZ(0) scale(1); }
          30% { transform: rotateZ(-85deg) scale(0.95); }
          50% { transform: rotateZ(-85deg) scale(0.98); }
          70% { transform: rotateZ(-85deg) scale(0.95); }
          100% { transform: rotateZ(0) scale(1); }
        }
        .pet-3d-sleep { animation: sleep-3d 2.5s ease-in-out; }

        /* === 走路动画：左右移动 + 摆动 === */
        @keyframes walk-3d {
          0% { transform: translateX(-20px) rotateY(-15deg) rotateZ(-3deg); }
          25% { transform: translateX(-10px) rotateY(-15deg) rotateZ(3deg); }
          50% { transform: translateX(0) rotateY(15deg) rotateZ(-3deg); }
          75% { transform: translateX(10px) rotateY(15deg) rotateZ(3deg); }
          100% { transform: translateX(20px) rotateY(15deg) rotateZ(-3deg); }
        }
        .pet-3d-walk { animation: walk-3d 1.5s ease-in-out infinite; }

        /* === 摸摸动画：眯眼 + 晃头 === */
        @keyframes pet-3d {
          0%, 100% { transform: rotateY(0) scale(1); }
          25% { transform: rotateY(-12deg) scale(1.03) translateY(-3px); }
          50% { transform: rotateY(0) scale(1.05) translateY(-5px); }
          75% { transform: rotateY(12deg) scale(1.03) translateY(-3px); }
        }
        .pet-3d-pet { animation: pet-3d 0.9s ease-out; }

        /* === 眨眼叠加层 === */
        @keyframes blink {
          0%, 90%, 100% { transform: scaleY(1); opacity: 0; }
          93%, 97% { transform: scaleY(0.1); opacity: 0.6; }
        }
        .pet-blink-overlay {
          position: absolute;
          top: 28%;
          left: 50%;
          transform: translateX(-50%);
          width: 50%;
          height: 8%;
          background: rgba(0,0,0,0.5);
          border-radius: 50%;
          filter: blur(2px);
          opacity: 0;
          animation: blink 4s infinite;
          pointer-events: none;
        }

        /* === 粒子特效 === */
        @keyframes particle-float {
          0% { opacity: 0; transform: translate(0, 0) scale(0.3) rotate(0); }
          20% { opacity: 1; transform: translate(var(--dx, 10px), -10px) scale(1) rotate(10deg); }
          100% { opacity: 0; transform: translate(var(--dx, 10px), -50px) scale(0.6) rotate(var(--rot, 20deg)); }
        }
        .pet-particle {
          position: absolute;
          top: 30%;
          left: 50%;
          font-size: 14px;
          pointer-events: none;
          animation: particle-float 1.5s ease-out forwards;
        }

        /* 淡入 */
        @keyframes pet-fade-in { from{opacity:0; transform:scale(0.94)} to{opacity:1; transform:scale(1)} }
      `}</style>

      <div
        key={`${animKey}-${blinkKey}`}
        className={`pet-3d-stage ${animClass}`}
        style={{
          width: `${evo.scale * 100}%`,
          height: `${evo.scale * 100}%`,
          maxWidth: '100%',
          maxHeight: '100%',
          position: 'relative',
          filter: [filters, evo.glow].filter(Boolean).join(' ') || undefined,
        }}
      >
        <img
          src={spriteSrc}
          alt={customSprite ? '自定义桌宠' : `${SPECIES_NAMES[species]} ${state}`}
          draggable={false}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            display: 'block',
          }}
        />
        {/* 眨眼叠加层（仅非 sleep 状态显示）*/}
        {state !== 'sleepy' && !customSprite && (
          <div className="pet-blink-overlay" />
        )}
        {/* 动作粒子特效 */}
        {effect && (
          <>
            {Array.from({ length: effect.count }).map((_, i) => (
              <span
                key={i}
                className="pet-particle"
                style={{
                  '--dx': `${(i - effect.count / 2) * 20}px`,
                  '--rot': `${i * 30}deg`,
                  animationDelay: `${i * 0.15}s`,
                  left: `${40 + i * 8}%`,
                } as React.CSSProperties}
              >
                {effect.emoji}
              </span>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
