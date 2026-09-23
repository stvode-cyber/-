/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 电子薄荷主题 (Mint Tech)
        // 所有颜色引用 CSS 变量（RGB 三元组），在 .dark 下自动切换
        // 主色：薄荷绿渐变 emerald → teal
        primary: {
          50: 'rgb(var(--color-primary-50) / <alpha-value>)',
          100: 'rgb(var(--color-primary-100) / <alpha-value>)',
          200: 'rgb(var(--color-primary-200) / <alpha-value>)',
          300: 'rgb(var(--color-primary-300) / <alpha-value>)',
          400: 'rgb(var(--color-primary-400) / <alpha-value>)',
          500: 'rgb(var(--color-primary-500) / <alpha-value>)',
          600: 'rgb(var(--color-primary-600) / <alpha-value>)',
          700: 'rgb(var(--color-primary-700) / <alpha-value>)',
          800: 'rgb(var(--color-primary-800) / <alpha-value>)',
          900: 'rgb(var(--color-primary-900) / <alpha-value>)',
        },
        // 强调色：石板灰 slate（文字 / 边框 / 次要元素）
        accent: {
          50: 'rgb(var(--color-accent-50) / <alpha-value>)',
          100: 'rgb(var(--color-accent-100) / <alpha-value>)',
          200: 'rgb(var(--color-accent-200) / <alpha-value>)',
          300: 'rgb(var(--color-accent-300) / <alpha-value>)',
          400: 'rgb(var(--color-accent-400) / <alpha-value>)',
          500: 'rgb(var(--color-accent-500) / <alpha-value>)',
          600: 'rgb(var(--color-accent-600) / <alpha-value>)',
          700: 'rgb(var(--color-accent-700) / <alpha-value>)',
          800: 'rgb(var(--color-accent-800) / <alpha-value>)',
          900: 'rgb(var(--color-accent-900) / <alpha-value>)',
        },
        // 面板色
        panel: {
          50: 'rgb(var(--color-panel-50) / <alpha-value>)',
          100: 'rgb(var(--color-panel-100) / <alpha-value>)',
          200: 'rgb(var(--color-panel-200) / <alpha-value>)',
          300: 'rgb(var(--color-panel-300) / <alpha-value>)',
          400: 'rgb(var(--color-panel-400) / <alpha-value>)',
          500: 'rgb(var(--color-panel-500) / <alpha-value>)',
          600: 'rgb(var(--color-panel-600) / <alpha-value>)',
          700: 'rgb(var(--color-panel-700) / <alpha-value>)',
          800: 'rgb(var(--color-panel-800) / <alpha-value>)',
          900: 'rgb(var(--color-panel-900) / <alpha-value>)',
        },
        // gray 别名到 accent（项目内 gray 与 slate 语义一致，统一管理）
        gray: {
          50: 'rgb(var(--color-accent-50) / <alpha-value>)',
          100: 'rgb(var(--color-accent-100) / <alpha-value>)',
          200: 'rgb(var(--color-accent-200) / <alpha-value>)',
          300: 'rgb(var(--color-accent-300) / <alpha-value>)',
          400: 'rgb(var(--color-accent-400) / <alpha-value>)',
          500: 'rgb(var(--color-accent-500) / <alpha-value>)',
          600: 'rgb(var(--color-accent-600) / <alpha-value>)',
          700: 'rgb(var(--color-accent-700) / <alpha-value>)',
          800: 'rgb(var(--color-accent-800) / <alpha-value>)',
          900: 'rgb(var(--color-accent-900) / <alpha-value>)',
        },
        // 状态色（保持静态，两种模式下均可读）
        urgent: '#EF4444',
        warning: '#F59E0B',
        success: '#10B981',
        info: '#6366F1',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out',
        'fade-in': 'fadeIn 0.3s ease-out',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'bounce-soft': 'bounceSoft 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
        // 倒计时庆祝动画（CD-XX 倒计时功能）
        'confetti-fall': 'confettiFall 3s linear forwards',
        'firework-burst': 'fireworkBurst 2s ease-out forwards',
        'celebration-pop': 'celebrationPop 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
        // 撒花下落：从顶部下落到底部，带旋转
        confettiFall: {
          '0%': { transform: 'translateY(-20px) rotate(0deg)', opacity: '1' },
          '80%': { opacity: '1' },
          '100%': { transform: 'translateY(100vh) rotate(720deg)', opacity: '0' },
        },
        // 烟花爆发：从中心放大并淡出
        fireworkBurst: {
          '0%': { transform: 'scale(0) rotate(0deg)', opacity: '1' },
          '40%': { transform: 'scale(1.4) rotate(180deg)', opacity: '1' },
          '100%': { transform: 'scale(2.2) rotate(360deg)', opacity: '0' },
        },
        // 庆祝弹出：弹性放大
        celebrationPop: {
          '0%': { transform: 'scale(0) rotate(-10deg)', opacity: '0' },
          '60%': { transform: 'scale(1.1) rotate(2deg)', opacity: '1' },
          '100%': { transform: 'scale(1) rotate(0)', opacity: '1' },
        },
      },
      // 圆角升级：更圆润年轻
      borderRadius: {
        'xl': '14px',
        '2xl': '18px',
        '3xl': '24px',
      },
    },
  },
  plugins: [],
}
