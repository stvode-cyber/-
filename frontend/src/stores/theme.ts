import { create } from 'zustand'

/**
 * 全局主题 Store
 *
 * - mode: 用户选择（light / dark / system）
 * - effectiveMode: 实际生效的模式（system 时根据 prefers-color-scheme 解析）
 * - 通过在 <html> 上切换 .dark class 驱动 CSS 变量覆盖
 * - localStorage 键：aie_theme（与 aie_token / aie_user 同前缀，clearCache 时需保留）
 *
 * 使用方式：
 *   const { mode, setMode } = useThemeStore()
 *   useThemeStore.getState().init()  // 在 main.tsx 中调用
 */

export type ThemeMode = 'light' | 'dark' | 'system'
type EffectiveMode = 'light' | 'dark'

const THEME_KEY = 'aie_theme'

interface ThemeState {
  mode: ThemeMode
  effectiveMode: EffectiveMode
  setMode: (mode: ThemeMode) => void
  toggle: () => void
  init: () => void
}

/** 读取系统偏好 */
function systemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** 将有效模式应用到 <html> */
function applyDarkClass(effective: EffectiveMode) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (effective === 'dark') root.classList.add('dark')
  else root.classList.remove('dark')
}

/** 从 localStorage 恢复模式 */
function loadMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY)
    if (v === 'light' || v === 'dark' || v === 'system') return v
  } catch {
    /* ignore */
  }
  return 'system'
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: 'system',
  effectiveMode: 'light',

  setMode: (mode) => {
    const effective: EffectiveMode = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
    try {
      localStorage.setItem(THEME_KEY, mode)
    } catch {
      /* ignore */
    }
    applyDarkClass(effective)
    set({ mode, effectiveMode: effective })
  },

  toggle: () => {
    const current = get().effectiveMode
    get().setMode(current === 'dark' ? 'light' : 'dark')
  },

  init: () => {
    const mode = loadMode()
    const effective: EffectiveMode = mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
    applyDarkClass(effective)
    set({ mode, effectiveMode: effective })

    // 监听系统主题变化（仅 mode === 'system' 时生效）
    if (typeof window !== 'undefined' && window.matchMedia) {
      const mql = window.matchMedia('(prefers-color-scheme: dark)')
      mql.addEventListener('change', (e) => {
        if (get().mode === 'system') {
          const eff: EffectiveMode = e.matches ? 'dark' : 'light'
          applyDarkClass(eff)
          set({ effectiveMode: eff })
        }
      })
    }
  },
}))
