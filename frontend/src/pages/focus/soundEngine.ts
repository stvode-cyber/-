/**
 * Web Audio API 合成引擎
 *
 * 所有函数：AudioContext + 输入节点 → 停止函数
 * 无 UI 依赖，可独立测试。
 */
import type { SoundSceneId } from '../../lib/focusSoundStore'

export type NoiseType = 'white' | 'pink' | 'brown'

/** 生成色噪声 buffer（white/pink/brown） */
export function createNoiseBuffer(ctx: AudioContext, type: NoiseType, durationSec = 2): AudioBuffer {
  const sampleRate = ctx.sampleRate
  const length = sampleRate * durationSec
  const buffer = ctx.createBuffer(1, length, sampleRate)
  const data = buffer.getChannelData(0)

  if (type === 'white') {
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1
  } else if (type === 'pink') {
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      b0 = 0.99886 * b0 + w * 0.0555179
      b1 = 0.99332 * b1 + w * 0.0750759
      b2 = 0.969 * b2 + w * 0.153852
      b3 = 0.95000 * b3 + w * 0.3104856
      b4 = 0.85000 * b4 + w * 0.5329522
      b5 = 0.62000 * b5 + w * 0.6913060
      b6 = 0.25000 * b6 + w * 1.0267751
      data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.2) * 0.11
    }
  } else {
    // brown
    let last = 0
    for (let i = 0; i < length; i++) {
      const w = Math.random() * 2 - 1
      last = (last + 0.02 * w) / 1.02
      data[i] = last * 3.5
    }
  }
  return buffer
}

/** 色噪声源（带 GainNode 控制音量） */
export function createNoiseSource(ctx: AudioContext, type: NoiseType, dest: AudioNode, gain: number): () => void {
  const buffer = createNoiseBuffer(ctx, type, 2)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.loop = true
  const g = ctx.createGain()
  g.gain.value = gain
  src.connect(g).connect(dest)
  src.start()
  return () => { try { src.stop() } catch {} g.disconnect() }
}

/** 雨声：棕色噪声 + LPF + 高频沙沙声叠加 */
export function createRain(ctx: AudioContext, dest: AudioNode): () => void {
  const stopFns: (() => void)[] = []
  // 主噪声
  const buffer = createNoiseBuffer(ctx, 'brown', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200
  const g = ctx.createGain(); g.gain.value = 0.35
  src.connect(lp).connect(g).connect(dest)
  src.start()
  stopFns.push(() => { try { src.stop() } catch {} })

  // 高频沙沙（pink noise + HPF）
  const src2 = ctx.createBufferSource()
  src2.buffer = createNoiseBuffer(ctx, 'pink', 3); src2.loop = true
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500
  const g2 = ctx.createGain(); g2.gain.value = 0.08
  src2.connect(hp).connect(g2).connect(dest)
  src2.start()
  stopFns.push(() => { try { src2.stop() } catch {} })

  return () => { stopFns.forEach((f) => f()); g.disconnect(); g2.disconnect() }
}

/** 海浪：白噪声 + LFO 调制音量 */
export function createOcean(ctx: AudioContext, dest: AudioNode): () => void {
  const buffer = createNoiseBuffer(ctx, 'white', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 600
  const g = ctx.createGain(); g.gain.value = 0
  src.connect(lp).connect(g).connect(dest)

  // LFO：0.1Hz 模拟潮汐
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.1
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.35
  lfo.connect(lfoGain).connect(g.gain)
  g.gain.value = 0.35 // 基线（防止部分浏览器 LFO 未起时无声）

  src.start(); lfo.start()
  return () => { try { src.stop(); lfo.stop() } catch {} g.disconnect(); lfoGain.disconnect() }
}

/** 森林：白噪声 + 多个 Chirp（鸟鸣）随机脉冲 */
export function createForest(ctx: AudioContext, dest: AudioNode): () => void {
  const buffer = createNoiseBuffer(ctx, 'pink', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2000
  const g = ctx.createGain(); g.gain.value = 0.08
  src.connect(lp).connect(g).connect(dest)
  src.start()

  // 鸟鸣：每隔 2-5 秒来一次 2kHz→4kHz chirp
  let timers: number[] = []
  const chirp = () => {
    const osc = ctx.createOscillator()
    const cg = ctx.createGain()
    const t = ctx.currentTime
    osc.frequency.setValueAtTime(2000 + Math.random() * 2000, t)
    osc.frequency.exponentialRampToValueAtTime(4000, t + 0.08)
    cg.gain.setValueAtTime(0, t)
    cg.gain.linearRampToValueAtTime(0.06, t + 0.02)
    cg.gain.linearRampToValueAtTime(0, t + 0.15)
    osc.connect(cg).connect(dest)
    osc.start(t); osc.stop(t + 0.2)
    timers.push(window.setTimeout(chirp, 2000 + Math.random() * 3000))
  }
  timers.push(window.setTimeout(chirp, 1500))

  return () => {
    try { src.stop() } catch {}
    timers.forEach((id) => clearTimeout(id))
    g.disconnect()
  }
}

/** 壁炉：棕色噪声 + 随机 crackle（高频脉冲） */
export function createFire(ctx: AudioContext, dest: AudioNode): () => void {
  const stopFns: (() => void)[] = []
  const buffer = createNoiseBuffer(ctx, 'brown', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 800
  const g = ctx.createGain(); g.gain.value = 0.4
  src.connect(lp).connect(g).connect(dest)
  src.start()
  stopFns.push(() => { try { src.stop() } catch {} })

  // crackle
  let id: number
  const crackle = () => {
    const t = ctx.currentTime
    const src2 = ctx.createBufferSource()
    src2.buffer = createNoiseBuffer(ctx, 'white', 0.02)
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.3, t)
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.03)
    src2.connect(hp).connect(cg).connect(dest)
    src2.start(t); src2.stop(t + 0.05)
    id = window.setTimeout(crackle, 200 + Math.random() * 600)
  }
  id = window.setTimeout(crackle, 300)
  stopFns.push(() => clearTimeout(id))

  return () => { stopFns.forEach((f) => f()); g.disconnect() }
}

/** 风声：粉色噪声 + 缓慢起伏 */
export function createWind(ctx: AudioContext, dest: AudioNode): () => void {
  const buffer = createNoiseBuffer(ctx, 'pink', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.8
  const g = ctx.createGain(); g.gain.value = 0
  src.connect(bp).connect(g).connect(dest)

  // LFO 调制
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.15
  const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.2
  lfo.connect(lfoGain).connect(g.gain)
  g.gain.value = 0.2

  src.start(); lfo.start()
  return () => { try { src.stop(); lfo.stop() } catch {} g.disconnect(); lfoGain.disconnect() }
}

/** 咖啡馆：棕噪声底 + 低频 murmur + 随机 clink */
export function createCafe(ctx: AudioContext, dest: AudioNode): () => void {
  const stopFns: (() => void)[] = []

  // 底噪声
  const buffer = createNoiseBuffer(ctx, 'brown', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500
  const g = ctx.createGain(); g.gain.value = 0.25
  src.connect(lp).connect(g).connect(dest)
  src.start()
  stopFns.push(() => { try { src.stop() } catch {} })

  // clink 偶尔高频小珠
  let id: number
  const clink = () => {
    const t = ctx.currentTime
    const src2 = ctx.createBufferSource()
    src2.buffer = createNoiseBuffer(ctx, 'white', 0.01)
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 5000
    const cg = ctx.createGain()
    cg.gain.setValueAtTime(0.15, t)
    cg.gain.exponentialRampToValueAtTime(0.001, t + 0.02)
    src2.connect(hp).connect(cg).connect(dest)
    src2.start(t); src2.stop(t + 0.03)
    id = window.setTimeout(clink, 3000 + Math.random() * 7000)
  }
  id = window.setTimeout(clink, 2000)
  stopFns.push(() => clearTimeout(id))

  return () => { stopFns.forEach((f) => f()); g.disconnect() }
}

/** 深夜：粉色噪声极低音量 + 偶尔昆虫 chirp */
export function createNight(ctx: AudioContext, dest: AudioNode): () => void {
  const buffer = createNoiseBuffer(ctx, 'pink', 3)
  const src = ctx.createBufferSource()
  src.buffer = buffer; src.loop = true
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 400
  const g = ctx.createGain(); g.gain.value = 0.05
  src.connect(lp).connect(g).connect(dest)
  src.start()

  let id: number
  const cricket = () => {
    const t = ctx.currentTime
    for (let k = 0; k < 6; k++) {
      const osc = ctx.createOscillator()
      const cg = ctx.createGain()
      const tt = t + k * 0.06
      osc.frequency.value = 4000
      cg.gain.setValueAtTime(0, tt)
      cg.gain.linearRampToValueAtTime(0.03, tt + 0.01)
      cg.gain.linearRampToValueAtTime(0, tt + 0.04)
      osc.connect(cg).connect(dest)
      osc.start(tt); osc.stop(tt + 0.05)
    }
    id = window.setTimeout(cricket, 3000 + Math.random() * 4000)
  }
  id = window.setTimeout(cricket, 2000)

  return () => { try { src.stop() } catch {} clearTimeout(id); g.disconnect() }
}

/** 为指定场景生成持续音频（统一入口） */
export function createSceneAudio(ctx: AudioContext, scene: SoundSceneId, dest: AudioNode): () => void {
  switch (scene) {
    case 'white':
      return createNoiseSource(ctx, 'white', dest, 0.15)
    case 'rain':
      return createRain(ctx, dest)
    case 'ocean':
      return createOcean(ctx, dest)
    case 'forest':
      return createForest(ctx, dest)
    case 'fire':
      return createFire(ctx, dest)
    case 'wind':
      return createWind(ctx, dest)
    case 'cafe':
      return createCafe(ctx, dest)
    case 'night':
      return createNight(ctx, dest)
    default:
      return createNoiseSource(ctx, 'white', dest, 0.1)
  }
}
