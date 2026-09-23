# changelog.md — 改动日记本

> 每次改 skill 或改 agent 铁律，记一笔。倒序排列（最新在上）。

---

## 2026-08-24（第三次：加代码规范 skill）

### 新增
- [skills/代码规范/skill.md](skills/代码规范/skill.md) — 生成型+全局型，触及写代码就加载
  - 含：代码风格/命名规则/文件组织/注释规范/错误处理/安全规范/TS 规范

### 修改
- [skills/index.md](skills/index.md) — 索引加"代码规范"行 + 新增"全局型 skill"专区
- [agents/main.agent.md](agents/main.agent.md) — 路由流程加"第四步：写代码时加载代码规范"
- [agents/main.agent.md](agents/main.agent.md) — 路由表加"写代码 → 代码规范"
- [agents/main.agent.md](agents/main.agent.md) — 优先级加"代码规范（全局型）"

### 原因
- 用户要求增加"只要触及写代码就用到"的 skill

### 影响
- 以后 AI 写代码前会先加载代码规范，保证风格一致
- 代码规范是全局型，不跟具体业务绑定

---

## 2026-08-24（第二次改造：游戏背景化）

### 修改
- [总纲.md](总纲.md) — 改成"绿角犀游戏助手技能系统"，导航指向游戏 skill
- [agents/main.agent.md](agents/main.agent.md) — 路由表改成游戏场景（新手/宠物/副本/商城）
- [agents/rules.global.md](agents/rules.global.md) — 铁律改成游戏场景（防作弊/防沉迷/充值提示）
- [skills/index.md](skills/index.md) — 索引改成游戏 skill 列表

### 新增
- [skills/新手引导/skill.md](skills/新手引导/skill.md) — 流程型：新手任务分阶段推进
- [skills/宠物图鉴/skill.md](skills/宠物图鉴/skill.md) — 知识型：宠物属性/进化/技能搭配
- [skills/副本攻略/skill.md](skills/副本攻略/skill.md) — 知识型：副本机制/BOSS打法/阵容
- [skills/商城交易/skill.md](skills/商城交易/skill.md) — 操作型：购买/充值/退款 API

### 删除
- skills/平台规则/skill.md（业务背景已废弃）
- skills/运营计划/skill.md（业务背景已废弃）

### 原因
- 用户要求改成游戏背景，绿角犀本身有宠物系统，游戏化更贴合

### 影响
- skill 内容全部对齐游戏玩法
- 规矩/铁律对齐游戏场景（防作弊、防沉迷、理性消费）
- 待建 skill 规划更新为：公会社交、装备系统、成就系统

---

## 2026-08-24（首次创建）

### 新增
- 创建 ai-skills/ 独立目录（第一组：AI 系统架构）
- 创建 总纲.md / main.agent.md / rules.global.md / index.md
- 创建 shared/utils.md — 公共工具箱（待补内容）

### 原因
- 用户要求将"AI 怎么干活"（第一组）与"项目文档怎么摆"（第二组）分开管理

### 影响
- ai-skills/ 独立于 APP-AIE/ 下的业务模块
- 后端 chat.routes.ts 未来可读取此处 skill 注入 AI 对话

---

## 维护规则

1. 每次改动都记一笔（新增/修改/删除）
2. 包含：改了啥、为啥改、影响什么
3. 倒序排列，最新在上
4. 不删历史记录（即使 skill 废弃也保留记录）
