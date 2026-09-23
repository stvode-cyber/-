// TODO: [Vite publicDir位置错] 预防：publicDir 必须是 defineConfig 的顶层选项（和 root、build 同级），不能嵌套进 build 对象
// TODO: [base相对路径] 预防：Electron 壳用 file:// 协议加载前端时，base 必须设为 './'，否则 index.html 引用绝对路径 /assets/xxx.js 会指向文件系统根导致灰屏
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  // Electron 通过 file:// 协议加载前端，必须使用相对路径
  // 否则 index.html 会引用 /assets/xxx.js（绝对路径），在 file:// 下指向文件系统根目录导致灰屏
  base: './',
  plugins: [
    react(),
    VitePWA({
      // prompt 模式：新版本在后台静默下载（准备阶段），完成后由用户确认刷新
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '绿角犀',
        short_name: '绿角犀',
        description: '你的全能个人助理 - 任务/日程/账单/对话/提醒',
        theme_color: '#059669',
        background_color: '#F8FAFC',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        lang: 'zh-CN',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 预缓存：应用主壳（HTML/CSS/JS/图标）
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff,woff2}'],
        // 运行时缓存：API 请求走 NetworkFirst（保证数据最新，离线时回退缓存）
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/[^/]+\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
        // 跳过预缓存大文件
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      // 客户端声明周期事件，用于检测新版本并提示用户
      client: {
        install: true,
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // 拆分 vendor：把 react 核心栈从 index 主 chunk 抽出，
        // 使 index chunk 降到 500KB 推荐值以下（原 index ~520KB 触发 chunk size 警告）
        manualChunks: {
          'react-vendor': ['react', 'react-dom', 'react-router-dom', 'scheduler'],
        },
      },
    },
  },
})
