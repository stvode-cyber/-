/**
 * 资产类型推断（按 MIME 优先，回退扩展名）
 * - 抽离自 asset.routes / remoteFetch.routes 的重复实现，统一口径
 */
export function inferType(name: string, mime?: string | null): string {
  const m = (mime || '').toLowerCase()
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('audio/')) return 'audio'
  if (m.startsWith('video/')) return 'video'
  const ext = name.split('.').pop()?.toLowerCase() || ''
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) return 'image'
  if (['mp3', 'wav', 'm4a', 'aac', 'ogg'].includes(ext)) return 'audio'
  if (['mp4', 'mov', 'webm', 'mkv', 'avi'].includes(ext)) return 'video'
  return 'document'
}
