// TODO: [Vite publicDir位置错] 预防：publicDir 必须是 defineConfig 的顶层选项（和 root、build 同级），不能嵌套进 build 对象
// TODO: [管理后台独立] 预防：admin-vite.config.ts 和主 vite.config.ts 必须完全独立，产物输出到 admin-dist/，Electron 只复制 frontend/dist 不混
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// 独立管理后台网页构建配置
// - 与 vite.config.ts（主 APP）分开，互不影响
// - 不引入 VitePWA：管理网页不注册 SW/manifest
// - 产物输出到 admin-dist/（dist 的兄弟目录），Electron 复制 frontend/dist 不受影响
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  // publicDir 是 Vite 顶层选项（不是 build.*）：置 false 避免复制项目 public/
  //（主 APP 的 PWA/贴纸/天气图/ui 样张等静态资源不便混入管理后台）
  publicDir: false,
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'admin-dist',
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(__dirname, 'admin.html'),
    },
  },
})