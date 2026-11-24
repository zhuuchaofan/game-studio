# 技术架构（定稿 · 原型 v1.0）

> 状态：定稿（原型 v1.0，2026-11-24）。M0 脚手架已落实（含 CI 与 Pages 部署，PR #1、#2 已合）；玩法相关的架构（牌局状态机、存档）在原型阶段细化。

## 1. 技术栈（已锁定）
| 环节 | 选型 | 版本锁定 |
|------|------|----------|
| 引擎 | Phaser 3 | `3.90.0`（精确版本，npm latest 已是 4.2.1） |
| 语言 | TypeScript | `5.9.x`（不用 7.0.2） |
| 构建 | Vite | `8.3.8` |
| 单元测试 | Vitest | 与 Vite 同源 |
| 端到端测试 | Playwright | Chromium |
| 地图/关卡 | Tiled | 后续关卡用，M0 不用 |
| 部署 | GitHub Pages（主）+ itch.io（试玩） | 静态托管，无服务器 |

## 2. 目录结构（M0 落实）
```text
game-studio/
├── .github/workflows/ci.yml   # CI：安装 → 构建 → 单元测试 → E2E（已在 main 上，PR #1、#2 已合）
├── docs/                      # 设计文档（GDD、美术、架构、进度、决策）
├── src/
│   ├── main.ts                # 入口：创建 Phaser 游戏实例（320×180，pixelArt）
│   ├── scenes/
│   │   └── BootScene.ts       # M0：Hello World 场景
│   ├── utils/
│   │   └── scale.ts           # 纯函数：缩放计算（Vitest 覆盖）
│   └── data/                  # （原型阶段）卡牌定义 JSON、数值配置 JSON
├── tests/e2e/                 # Playwright 冒烟测试
├── index.html
├── vite.config.ts
├── tsconfig.json
├── vitest.config.ts
├── playwright.config.ts
└── package.json
```

## 3. 场景划分（规划，M0 只做 BootScene）
| 场景 | 职责 | 阶段 |
|------|------|------|
| BootScene | 启动、Hello World、分辨率与缩放验证 | M0 |
| TitleScene | 标题、开始、继续 | 原型 |
| PawnshopScene | 白天收当：当客、估价三档、收当结算 | 原型 |
| CardBattleScene | 夜里牌局：抽牌、出牌、人情、心魔 AI | 原型 |
| ResultScene | 结算：得牌、得钱、赎当券 | 原型 |
| CollectionScene | 图鉴 | 垂直切片 |

## 4. 数据驱动卡牌方案（原型阶段实施，M0 只定方向）
- 每张牌是一个 JSON 对象：`{ id, name, item, cost, effect, story }`，效果用声明式字段描述（例如 `{ "type": "damage", "value": 4 }`、`{ "type": "draw", "value": 2 }`、`{ "type": "shield", "value": 5 }`），不用每张牌写一段代码。
- 效果执行器（`EffectRunner`）按 `type` 分发；新机制 = 新 `type` + 新执行分支，旧牌不受影响。
- 牌表、数值、心魔参数全部放 `src/data/*.json`，不用改代码就能调数值（调平衡时只改 JSON + 跑测试）。

## 5. 数值配置方案
- `src/data/balance.json`：人情上限、开局生命、心魔血量与伤害、估价接受率等全部可调数值集中存放。
- 数值改动流程：改 JSON → 跑 `npm run test`（含蒙特卡洛模拟脚本，原型阶段加入）→ 跑 Playwright 冒烟 → 提交 PR。
- 禁止把数值写死在场景代码里（M0 评审项之一）。

## 6. 状态管理
- 回合制游戏，状态机优先：牌局状态（抽牌 → 出牌 → 结算 → 心魔行动）用显式状态枚举，不用散落的布尔标志。
- 场景之间只通过 `registry` / 场景 `data` 传最小必要数据；跨天进度（钱、当铺等级、图鉴）放 `SaveData` 模块，存档格式见第 8 节。

## 7. 测试策略
- 单元测试（Vitest）：纯逻辑 ≥80% 覆盖——缩放、卡牌效果执行、数值计算、存档序列化；不测 Phaser 渲染。
- E2E（Playwright）：主线流程脚本化——打开页面、断言画布、截图；原型阶段加入“打完一局牌局”的脚本化走通。
- CI 任一失败不得合并（红线）。

## 8. 存档与版本兼容（方向，垂直切片阶段落实）
- 存档 3 档 + 1 自动档；存档为 JSON，带 `version` 字段；读档时按版本号迁移，旧版本存档无法迁移时提示而非崩溃。
- M0 不做存档。

## 9. 性能预算（M0 定稿，执行中复核）
- 首屏可交互 ≤ 3 秒；内存 ≤ 200 MB；60 FPS（回合制游戏，掉帧容忍度高于动作游戏，但不得低于 30 FPS）。
- 构建产物（不含 source map）目标 ≤ 2 MB。
