# SKILL: Frontend Component Spec

> 前端工程师的组件规范。确保新增组件和现有设计系统一致。

## 设计 Tokens（全局约定）

| Token | 值 | 用途 |
|---|---|---|
| Primary | `#64748B` (slate-500) | 主色：按钮、激活态、选中 |
| BG-dark | `#0F172A` (slate-950) | 深色主底 |
| BG-dark-card | `#1E293B` (slate-900) | 深色卡片 |
| BG-light | `#FFFFFF` | 浅色主底 |
| BG-light-card | `#F8FAFC` (slate-50) | 浅色卡片 |
| Radius-LG | 12px (rounded-xl) | 大卡片、弹窗 |
| Radius-MD | 8px (rounded-lg) | 按钮、输入框 |
| Radius-SM | 4px (rounded) | 标签、徽章 |
| Spacing | Tailwind 默认 | 4/8/12/16/24/32px |

## 组件结构模板

```tsx
import { useState } from 'react'
import { SomeIcon } from 'lucide-react'
import type { User } from '../../stores/auth'

interface Props {
  user: User
  onAction: (id: string) => Promise<void>
}

export default function MyComponent({ user, onAction }: Props) {
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setLoading(true)
    try {
      await onAction(user.id)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="rounded-xl bg-white dark:bg-slate-900 p-6 shadow-sm">
      {/* 深色/浅色双类名模式 */}
    </div>
  )
}
```

## 必守规则

### 1. 双主题支持（强制）

```html
<!-- ❌ 错误 -->
<div style="background: white;">

<!-- ✅ 正确 -->
<div className="bg-white dark:bg-slate-900">
```

Tailwind 的 `dark:` 前缀覆盖，不要自己写 CSS 变量。

### 2. 图标统一 Lucide

```tsx
// ✅
import { Send, Trash2, Settings } from 'lucide-react'

// ❌ 不要混用其他图标库
// import SendIcon from '@mui/icons-material/Send'
```

### 3. 异步按钮 loading 态

```tsx
const [saving, setSaving] = useState(false)

<Button disabled={saving || !formValid} onClick={handle}>
  {saving ? <Loader2 className="animate-spin" /> : '保存'}
</Button>
```

### 4. Toast 统一用项目封装

```tsx
const toast = useToast(s => s.show)
toast({ type: 'success', message: '保存成功' })
toast({ type: 'error', message: e.message })
```

**不要自己弹 alert()**。

### 5. API 调用统一走 api.ts

```tsx
import { api, unwrap } from '../../lib/api'

const data = await unwrap<Xxx>(api.get('/xxx'))
// ✅ 自动带 JWT + 401 自动清登录态

// ❌ 不要直接 fetch
// fetch('http://localhost:3001/api/v1/xxx', { headers: { Authorization: ... } })
```

### 6. 不要在组件里硬编码版本号 / API 地址

版本号从 store 读：`useAuthStore(s => s.user?.preferredTone)`。

## 路由注册模板

新页面必须注册三套（App.tsx 里搜现有模式照着加）：

```tsx
<Routes>
  {/* 未登录可访问 */}
  <Route path="/terms" element={<TermsPage />} />
  <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />

  {/* 桌面端 */}
  <Route element={<RequireAuth />}>
    <Route path="/settings/xxx" element={<XxxSettingsPage />} />
  </Route>

  {/* 移动端（独立 Routes 分支，mobile build 用） */}
  <Route element={<RequireAuth />}>
    <Route path="/settings/xxx" element={<XxxSettingsPage />} />
  </Route>
</Routes>
```

## 禁止清单

- ❌ 不要写 `any` 类型
- ❌ 不要用 `as` 强转掩盖类型错误
- ❌ 不要在 useEffect 里直接调 API 没有 cleanup
- ❌ 不要用 `dangerouslySetInnerHTML` 渲染用户输入
- ❌ 不要创建新的全局 CSS 文件（Tailwind 内联解决）
- ❌ 不要手动写 JWT 解码逻辑（统一用 jose）
