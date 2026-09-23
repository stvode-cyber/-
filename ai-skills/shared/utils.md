# shared/ — 公共工具箱

> 不属于任何单个 skill，属于整体。多个 skill 都能调用的工具/常量/模板放这里。

---

## 设计原则

- **单一来源**：同一逻辑只写一份，避免重复维护
- **无状态**：纯函数/纯常量，不存对话状态
- **文档化**：每个工具写清楚入参、返回、用途

---

## 工具清单（待补）

| 工具名 | 用途 | 入参 | 返回 | 状态 |
|---|---|---|---|---|
| formatDate | 统一日期格式化 | Date | "YYYY-MM-DD HH:mm" | 待写 |
| checkPermission | 权限校验 | userId, action | boolean | 待写 |
| constants | 全局常量 | - | { TIMEOUT, MAX_AMOUNT... } | 待写 |

---

## 使用方式

skill 里需要用到公共工具时，引用这里：

```markdown
> 调用 shared/formatDate 处理时间显示
> 调用 shared/checkPermission 校验用户权限
```

agent 执行 skill 时，先加载 shared/ 里的工具，再执行 skill 逻辑。
