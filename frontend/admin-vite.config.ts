import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

/**
 * configureServer middleware：把 /admin/ rewrite 到 /admin/admin.html
 *
 * 背景：admin 前端是独立入口（admin.html → admin-main.tsx + AdminLayout），
 * base='/admin/' 后 Vite dev server 默认用 root/index.html → 渲染客户端 main.tsx。
 *
 * middleware 在 Vite HTML middleware 之前执行，正确 rewrite 后 Vite 会完整处理 admin.html
 * （注入 @vite/client HMR、transform script src 加 /admin/ 前缀）。
 *
 * 之前的 transformIndexHtml 插件方案不行——返回 admin.html 原始内容后 Vite 不再处理，
 * 导致没有 HMR 注入、script src 也没加 base 前缀。
 */
function adminHtmlRewrite() {
  return {
    name: 'admin-html-rewrite',
    configureServer(server) {
      // 在 Vite 所有内置 middleware 之前拦截，rewrite 到 admin.html
      server.middlewares.use((req, _res, next) => {
        const url = req.url || ''
        // 精确匹配 /admin/ 或 /admin（不带尾部斜杠）
        if (url === '/admin/' || url === '/admin') {
          req.url = '/admin/admin.html'
        }
        next()
      })
    },
  }
}

export default defineConfig({
  base: '/admin/',
  plugins: [react(), adminHtmlRewrite()],
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
