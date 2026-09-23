import { api, unwrap } from './api'
import { compressAvatarImage } from './imageCompress'
import { useAuthStore } from '../stores/auth'
import { useToast } from '../components/Toast'

/**
 * 头像更换工具：任意位置调用即弹出文件选择器
 *
 * 流程：选图 → 客户端压缩（256px / 0.85，方形居中裁剪）→ POST /auth/avatar → 全局同步 auth store
 * 反馈通过 toast 提示，调用方无需管理状态。
 *
 * 使用场景：
 * - 个人页头像点击（独立实现，逻辑一致）
 * - 桌面顶栏下拉菜单「更换头像」（QQ 式快捷入口）
 */
export function pickAndUploadAvatar(): void {
  const toast = useToast.getState().show

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return

    if (!file.type.startsWith('image/')) {
      toast('请选择图片文件', 'error')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast('图片不能超过 5MB', 'error')
      return
    }

    toast('正在上传头像…', 'info')
    try {
      // 与个人页一致：256px 方图，JPEG 0.85
      const dataUrl = await compressAvatarImage(file, 256, 0.85)
      await unwrap(api.post('/auth/avatar', { avatar: dataUrl }))
      useAuthStore.getState().updateUser({ avatar: dataUrl })
      toast('头像已更新', 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : '头像上传失败', 'error')
    }
  }

  input.click()
}
