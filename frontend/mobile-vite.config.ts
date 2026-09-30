import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 手机端独立构建配置（Capacitor APK 用）
// - 端口 5174，strictPort（被占就报错不跳）
// - 编译时常量 __BUILD_MODE__ = 'mobile' → App.tsx 只渲染 Layout 底部 TabBar 路由
// - 产物输出到 mobile-dist/（Capacitor webDir 指向这）
// - 不引入 VitePWA：Android APK 不走 PWA 注册
export default defineConfig({
  base: './',
  define: {
    __BUILD_MODE__: JSON.stringify('mobile'),
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'mobile-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'index.html'),
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom', 'scheduler'],
        },
      },
    },
  },
})