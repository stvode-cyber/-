/**
 * 倒计时推送 Service Worker
 *
 * 职责：
 * - 监听 'push' 事件，显示系统通知
 * - 监听 'notificationclick' 事件，聚焦/打开应用
 * - 与 vite-plugin-pwa 的主 SW 共存（独立 scope: /sw-push）
 *
 * 设计要点：
 * - 不缓存任何资源（避免与主 SW 缓存冲突）
 * - 仅处理 push 与 notification 相关事件
 * - 通知点击后跳转到 /countdowns，便于查看提醒
 */

self.addEventListener('install', (event) => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

/** 监听 push 事件，显示通知 */
self.addEventListener('push', (event) => {
  let data = { title: '倒计时提醒', body: '你有一条新的提醒', url: '/countdowns' }
  try {
    if (event.data) {
      const parsed = event.data.json()
      if (parsed && typeof parsed === 'object') {
        data = { ...data, ...parsed }
      } else if (typeof parsed === 'string') {
        data.body = parsed
      }
    }
  } catch {
    if (event.data) {
      data.body = event.data.text()
    }
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200],
      tag: data.tag || 'countdown',
      renotify: true,
      data: { url: data.url || '/countdowns' },
    }),
  )
})

/** 通知点击：聚焦/打开应用并跳转 */
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/countdowns'

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      // 已有打开的窗口：聚焦并跳转
      for (const client of allClients) {
        if ('focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      // 无打开窗口：打开新窗口
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl)
      }
      return null
    })(),
  )
})

/** 监听消息：从前端页面 postMessage 接收本地通知指令 */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, url } = event.data.payload || {}
    self.registration.showNotification(title || '倒计时提醒', {
      body: body || '',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200],
      tag: 'countdown-local',
      data: { url: url || '/countdowns' },
    })
  }
})
