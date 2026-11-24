# 任务 07：根治死角缺口——三档全买不起时可跳过当客

> 实施任务书。工作区：`~/workspace/game-studio/repo-git/`。基线：`origin/main`（merge commit `badfd0b`，PR #8 已合并）。
> 分支：`fix/skip-customer`（基于 `main`）。
> **红线**：不改 `src/data/balance.json` 数值；不碰 `.github/workflows/`；不改定稿 GDD v1.0 核心（§1～§9）；本地构建、单测、E2E 全绿后再提交推送建 PR；不合并 PR。

## 背景

- 钱规则（PR #8）规定报价高于当前钱数的档位不可选，由此在 GDD §11.3 留下已知缺口：某位当客三档报价全部高于当前钱数时，界面无任何可点档位，且没有跳过/不成交按钮，流程会卡住。

## 根因与精确触发条件

1. **精确触发条件**：三档报价由 `quotePrice(trueValue, tier)` 按 `low=0.5 / fair=1.0 / high=1.5` 单调计算，因此三档全部不可买 **当且仅当** `money < quotePrice(currentItem.trueValue, 'low')`（即当前钱数严格小于该当客最低档报价）。只要 `money >= lowPrice`，至少低价档可点，无论接受或拒绝都会进入 `feedback` 进而推进流程，不会卡住。
2. **界面无其他出口**：`PawnshopScene.renderNegotiating()` 此前仅绘制三档报价按钮，买不起的档位不设 `interactive` 且无点击回调；无键盘快捷键、无返回标题按钮、无跳过按钮。
3. **`settle` 兜底不介入**：首先，界面层禁用且 `handleOffer()` 在 `resolveOffer()` 前即提前 `return`，根本不会调用 `settle()`；其次，即便直接调用 `settle(state, tier, true)`，其兜底逻辑（`price > state.money`）也只是返回原状态（仍停留在 `negotiating`、不推进当客索引），目的是防钱变负而非推进流程。
4. **实测复现（修复前）**：
   - `seed=4` 第 1 天（当客顺序 `watch -> bicycle -> ring`）：高价收旧手表（60）+ 高价收永久自行车（120）后 `money = 20`，第 3 位婚戒三档 `30 / 60 / 90`，`tierAffordability = { low: false, fair: false, high: false }`；点击三档均无反应，停在 `phase: "negotiating", customerIndex: 2`。
   - `seed=4` 第 3 天（`erhu -> ring -> watch`）高价收二胡（75）+ 婚戒（90）后剩 35，第 4 天（`watch -> bicycle -> erhu`）第 2 位自行车低价 40 > 35，三档全不可点。

## 改动点

### 1. 纯逻辑：`src/game/pawnshop.ts`
- 新增 `hasAnyAffordableTier(money, trueValue, balance)`：判断是否至少有一档可买。
- 新增 `skipCustomer(state)`：仅在 `phase === 'negotiating'` 且存在当前当客时生效（其他阶段安全返回克隆原状态）；不成交、钱/口碑/牌组均不变、`lastOutcome` 置 `null`、日志追加 `<物品名>:跳过`、`customerIndex + 1`，若已到最后一位则进入 `'summary'`，否则停留在 `'negotiating'` 展示下一位当客。
- `PawnshopDebugSnapshot` 新增可选字段 `canSkip?: boolean`。

### 2. 界面与字形：`src/scenes/PawnshopScene.ts`、`src/data/pixel-font.json`
- 在 `renderNegotiating()` 当客卡片右下角（`(270, 107)`，尺寸 `64×18`）增加「跳过当客」按钮：8-bit 像素风、1px 墨黑描边、严格 16 色调色板（常态旧纸底 `#D9A066` / hover 灯黄 `#E8B34B`；三档全买不起时灯黄底 `#E8B34B` / hover 纸白 `#FBF6E9` 高亮出口），与底部三档按钮完全无重叠。
- 新增 `handleSkip()` 调用 `skipCustomer(this.state)` 并重新渲染，不消耗 `this.rng`。
- 调试钩子 `window.__PAWNSHOP_DEBUG__.getState()` 补充 `canSkip` 字段。
- 通过既有 `scripts/generate-pixel-font.py` 基于 Fusion Pixel 12px（v2026.11.10，临时下载至 `/tmp` 用完即删，TTF 不入库）补齐新增汉字「跳」（`src/data/pixel-font.json`）。

### 3. 文档
- `docs/GAME_DESIGN.md`：更新 §11.3 补全跳过当客规则（钱/口碑/牌均不变、推进到下一位）；v1.0 核心（§1～§9）不动。
- `docs/PROGRESS.md` 与 `docs/DECISIONS.md` 同步记录。
- 新建本任务书 `proto-tasks/07-skip-customer.md`。

### 4. 测试
- `tests/unit/pawnshop.test.ts`：覆盖 `hasAnyAffordableTier` 与 `skipCustomer`（不可变、钱/口碑/牌不变、日志记录、推进至下一位与最后一位进入 `summary`、非 `negotiating` 阶段兜底、`seed=4` 第 1 天逻辑闭环）。
- `tests/unit/pixelart.test.ts`：字形覆盖校验列表加入 `'跳过当客'`。
- `tests/e2e/skip-customer.spec.ts`：用 `seed=4` 复现第 1 天死角（高价手表 60 + 高价自行车 120 后剩 20，第 3 位婚戒三档全 `false`、点三档无反应、`canSkip === true`、点跳过按钮后钱保持 20、口碑 2、牌组不变、进入 `summary` 并顺利进夜里牌局）与第 4 天中途跳过场景（验证非末位跳过推进到下一位当客且钱/口碑/牌不变）。

## 验收标准

1. `npm run build`（含 `tsc --noEmit`）、`npm run test`、`npm run test:e2e` 本地全部通过。
2. 原有全流程测试断言不受影响。
3. 在 `main` 上新建分支 `fix/skip-customer`，一次提交、一次推送、一次建 PR（标题 `fix: 三档全买不起时可跳过当客`，目标 `main`），不合并、不碰 `.github/workflows/`、不改 `balance.json`。
