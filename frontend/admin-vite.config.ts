import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ADMIN_HTML = path.resolve(__dirname, 'admin.html')
const ADMIN_HTML_CONTENT = readFileSync(ADMIN_HTML, 'utf-8')

/**
 * Vite 插件：把 /admin/ 的 HTML 入口从 index.html 换成 admin.html
 *
 * 背景：admin 前端是独立入口（admin.html → admin-main.tsx + AdminLayout 绿色侧边栏），
 * 但 admin-vite.config.ts base='/admin/' 后，Vite dev server 访问 /admin/ 仍返回
 * root/index.html（客户端入口 main.tsx + DesktopLayout/Layout），导致用户看到"客户端"。
 *
 * 此插件在 transformIndexHtml 里按 URL 匹配 /admin/，返回 admin.html 原始内容。
 * build 时 rollupOptions.input 已配 admin.html，生产构建不受影响。
 */
function adminHtmlPlugin() {
  return {
    name: 'admin-html-rewrite',
    transformIndexHtml(html: string, ctx: { originalUrl?: string }) {
      const url = ctx.originalUrl || ''
      if (url === '/admin/' || url === '/admin') {
        return ADMIN_HTML_CONTENT
      }
      return html
    },
  }
}

export default defineConfig({
  base: '/admin/',
  plugins: [react(), adminHtmlPlugin()],
  publicDir: false,
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
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
