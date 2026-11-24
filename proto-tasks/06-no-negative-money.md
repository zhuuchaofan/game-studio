# 任务 06：钱不能变负数规则（收当档位 affordability + 置灰禁用 + 测试改写）

> 实施任务书。工作区：`~/workspace/game-studio/repo-git/`。基线：`origin/main`（merge commit `14e0c86`，P4 已合并）。
> 分支：`fix/no-negative-money`（基于 `origin/main`）。
> 只改本文指定的内容；**红线**：现金成本 ¥0；不改核心玩法、技术架构、美术方向（只加规则逻辑与置灰样式）；不写凭据进仓库；不碰 `.github/workflows/`；不改 `src/data/balance.json` 的数值；不合并——合并等制作人确认。

## 背景

- P4 验收时发现规则缺口：第 1 天 3 位当客全按高价收会让钱变负（seed=4：60 + 120 + 90 = 270，开局 200 → 钱 -70），GDD 没写“钱不够不能买”的规则。
- 制作人 2026-11-24 21:12 定：**钱不能变负数**。

## 规则（制作人定）

白天收当时，某档报价高于当前钱数，该档位不可选——按钮置灰、点不了，不发生成交。钱刚好够（报价 ≤ 钱数）时可选。口碑与接受率等其他规则不动。

边界：报价 = 钱数可买（成交后钱变 0）；报价 = 钱数 + 1 不可买。

## 改动点

### 1. 纯逻辑：`src/game/pawnshop.ts`
- 新增 affordability 判断：`isTierAffordable(money, price)`（价格 ≤ 钱数）、`canAffordTier(money, trueValue, tier)`（经 `quotePrice` 算价）、`getTierAffordability(money, trueValue)`（三档一次返回）。
- `settle` 纯逻辑层兜底：接受成交且报价高于钱数时不成交、不扣钱、不改状态（被拒报价不受影响）。

### 2. 界面：`src/scenes/PawnshopScene.ts`
- `renderNegotiating()` 里每档报价与当前 `state.money` 比较；买不起的档位按钮置灰禁用——只用 16 色调色板里的颜色（银蓝底，与可点的烛光底明显区分）、无 hover 变色、不可点击（不设 interactive）。
- `addActionButton` 加可选 `disabled` 参数，其他调用点不变。
- `handleOffer` 开头先判 affordability，买不起直接 return，**在 `resolveOffer` 之前**（不消耗 RNG，否则固定种子会漂移）。
- 调试钩子 `getState()` 增加当前当客每档的可买状态 `tierAffordability: { low: boolean; fair: boolean; high: boolean }`（仅 negotiating 阶段提供），供 E2E 断言。

### 3. 文档
- `docs/GAME_DESIGN.md` 末尾增补新一节（§11，P4 的 §10 之后），写明规则与生效版本；v1.0 定稿核心一字不动；§11.3 原样记录已知缺口（见下）。
- 更新 `docs/PROGRESS.md` 与 `docs/DECISIONS.md`。

### 4. 测试
- `tests/unit/pawnshop.test.ts`：补 affordability 单测（边界、逐档、settle 兜底、刚好够买到 0）。
- `tests/e2e/dayloop.spec.ts`：全流程里 -70 / -50 负数断言全部改掉，改为非负断言与新流程对应的具体值；主流程与竖屏用例由 seed=4 改 seed=2（第 1 天高价 150 → 钱 50，胜局存档 70，第 2 天低价后 55）；P4 第 3/4/5 天改走低价路线（钱 180 / 155 / 145）；seed=7 负局用例高价全程可买，保持原样。
- `tests/e2e/battle.spec.ts`：任务书死角分析未列出的 3 处同样撞死角——经第 1 天高价进夜里的用例中 seed=4（高价 270）与 seed=1（高价 285）均超开局 200；改走低价进夜里（新增 `navigateThroughDayToBattleLow`），三处夜里均用 `?deck=test`、白天牌组不进牌局，种子与牌局断言不动；seed=2 与 seed=7（真实白天牌组）用例保持高价原样。
- 新增 `tests/e2e/affordability.spec.ts`：localStorage 预置低钱数存档（第 1 天 25 元，seed=7 首位二胡低 25 / 平 50 / 高 75）进第 1 天，断言买不起的档位在调试状态里为 false、点它无反应（phase 仍为 negotiating、钱不变、且不消耗 RNG——随后点低价档按首抽接受），再断言钱为 0 时三档全为 false、点低价档同样无反应。

## 已知缺口（死角，原样记录，需制作人定）

按本规则，某位当客三档报价全部高于当前钱数时，该当客没有任何可点档位，且当前没有“跳过当客 / 不成交”按钮，流程会在此卡住。这是规则本身留下的缺口，不是实现 bug；是否加跳过按钮属于新玩法，需制作人定夺，本次不自行加。

实测复现（固定种子，洗牌与报价均已逐天核算）：
- seed=4 第 1 天：当客顺序 watch → bicycle → ring；高价收下手表 60 + 自行车 120 后剩 20，第 3 位婚戒三档 30 / 60 / 90 全部 > 20，全不可点。
- seed=4 第 3 天（P4 用例）：当客顺序 erhu → ring → watch；高价收下二胡 75 + 婚戒 90 后剩 35，第 3 位手表低价 20 是唯一可点档且确定性 RNG 首抽 0.9236 拒收；到第 4 天（手表/自行车/二胡）第 2 位自行车低价 40 起三档全 > 35，全不可点。
- 本次测试改道绕开这两处死角（主流程改 seed=2，P4 改低价路线），未改游戏流程本身。

## 验收标准

1. `npm run build` 退出码 0；`npx tsc --noEmit` 0 错误；`npx vitest run` 全过；`npm run test:e2e` 全过（只跑 localhost，不测 live URL）。
2. 钱在任何已测流程里永不为负；买不起的档位点之无反应且不消耗 RNG；报价刚好等于钱数时可成交到 0。
3. 一次提交、一次推送（`git push origin fix/no-negative-money`）、一次建 PR（`gh pr create`，base main，标题写清规则与改动，描述里写本地验证结果）；PR 里不含 `.github/workflows/`；不合并。
