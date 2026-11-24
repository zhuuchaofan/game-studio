# 任务 05：P4 内容扩充（旧物池扩充 + 3 张新牌 + 2 个新心魔 + 4 天轮换 + 像素插画）

> 协调员任务书。工作区：`~/workspace/game-studio/repo-git/`（不提交、不推送、不建 PR，改动留工作区由协调员独立验收）。
> 基线：`origin/main`（`cbf7920`，已含 PR #6 P3 人情 + 1 天流程串联 + 像素修正 + 定稿 GDD v1.0）。
> 分支：`feature/p4-content-expansion`（基于 `origin/main`）。
> 只改本文指定的内容；**红线**：不碰 `.github/workflows/`；不改 `src/data/balance.json`；
> 不改现有旧物/牌/心魔的任何数值与字段；不引入新效果类型、新机制；不改核心玩法、技术架构、
> 美术方向；仓库里不放 `.ttf`；不写任何凭据；现金成本 ¥0。

## 背景

- P3 已打通完整昼夜循环（`TitleScene` → `PawnshopScene` → `TransitionScene` → `CardBattleScene` → `ResultScene` → 下一天 + 自动存档），全场景已替换为 Fusion Pixel 12px 位图字体与 32×32 手绘 16 色像素插画。
- 现有原型内容偏薄：白天当客池仅 3 件旧物（旧手表/婚戒/旧书），每天必见相同 3 件；夜里仅 2 个心魔（第 1 天药费 A、第 2 天起一直是车票 B），多天循环重复感强。
- P4 在**不改动任何核心机制与已有数值**的前提下，扩充当客池、牌池与心魔轮换，提升连续多天游玩的变化度。

## 范围

### 1. 白天旧物池扩充（`src/data/items.json`，3 种 → 6 种）

现有 3 个旧物（`watch` / `ring` / `old_book`）任何字段不改，追加 3 个新旧物（配色均取自 `docs/ART_STYLE.md` 16 色调色板）：

| id | 名称 | 真值 | 故事 | 对应牌名 | 费用 | 主色 |
|----|------|------|------|----------|------|------|
| `bicycle` | 永久自行车 | 80 | 骑了十年的永久牌自行车，儿子考上大学那天骑去送的 | 飞驰 | 2 | `#4E7A5A`（玉绿） |
| `erhu` | 二胡 | 50 | 街头拉琴老人的二胡，琴弦断了也舍不得扔 | 余音 | 1 | `#8A5A33`（铜棕） |
| `stamp_album` | 邮票册 | 30 | 攒了二十年的邮票册，最后一页还空着 | 集邮 | 1 | `#4E739E`（雾蓝） |

### 2. 新增 3 张牌（`src/data/cards.json`，20 张 → 23 张）

现有 20 张原型牌不动；仅复用已有效果类型（`damage` / `renqing` / `draw`），不引入新效果类型：

| id | 牌名 | 旧物 | 费用 | 效果 | 故事 | 主色 |
|----|------|------|------|------|------|------|
| `gallop` | 飞驰 | 永久自行车 | 2 | `damage: 6` | 同自行车故事 | `#4E7A5A` |
| `echo` | 余音 | 二胡 | 1 | `damage: 3`, `renqing: 1` | 同二胡故事 | `#8A5A33` |
| `stamp_collecting` | 集邮 | 邮票册 | 1 | `draw: 1`, `renqing: 1` | 同邮票册故事 | `#4E739E` |

### 3. 新增 2 个心魔（`src/data/demons.json`，2 个 → 4 个）

现有心魔 A「药费」/ B「车票」不动，追加：

- **心魔 C「房租」**（`id: 'c'`）：血量 22，行动：R1 造成 3 伤、R2 造成 4 伤、R3 造成 5 伤（逐回合递增压力）。
- **心魔 D「学费」**（`id: 'd'`）：血量 16，行动：R1 造成 1 伤、R2 造成 2 伤、R3 技能「开学」造成 10 伤（高爆发预警型，复用已有 `upcomingSkill` 意图预警机制）。

### 4. 心魔 4 天轮换循环（`src/game/save.ts`）

- `demonIdForDay(day)` 扩展返回类型为 `DemonId = 'a' | 'b' | 'c' | 'd'`：
  - 第 1 天 → `'a'`（药费）
  - 第 2 天 → `'b'`（车票）
  - 第 3 天 → `'c'`（房租）
  - 第 4 天 → `'d'`（学费）
  - 第 5 天起按 `(day - 1) % 4` 循环 A → B → C → D。
- 检查全部调用处与 URL 参数校验（`CardBattleScene` 支持 `?demon=a|b|c|d`），消除类型错误。

### 5. 每天当客仍为 3 位（`src/game/pawnshop.ts` & `src/scenes/PawnshopScene.ts`）

- 保留 `shuffleItems` 原有 Fisher-Yates 洗牌算法与 `deriveDaySeed` 按天种子派生逻辑不动。
- 定义 `DAILY_CUSTOMER_COUNT = 3`：每天从 6 个旧物洗牌后取前 3 个（`shuffleItems(ITEMS, shuffleRng).slice(0, DAILY_CUSTOMER_COUNT)`），保证固定 `?seed=` + 天数 100% 可复现。

### 6. 32×32 手绘像素插画（`src/data/pixelart.ts`）与点阵字形补全（`src/data/pixel-font.json`）

- 为 3 个新旧物（`BICYCLE_ART` / `ERHU_ART` / `STAMP_ALBUM_ART`）与 2 个新心魔（`DEMON_C_ART` / `DEMON_D_ART`）各手绘一张 32×32 像素画：
  - 严格只用 `docs/ART_STYLE.md` 16 色调色板（字符 `0-9A-F` 与 `.` 透明）；
  - 单图用色 ≤ 12 色，统一 1 像素描边（旧物墨黑 `0`、心魔夜黑 `8`）；不用 AI 生图；
  - 分别登记进 `CARD_PIXEL_ART`（`gallop` / `echo` / `stamp_collecting`）、`ITEM_PIXEL_ART`（`bicycle` / `erhu` / `stamp_album`）、`DEMON_PIXEL_ART`（`c` / `d`）；现有插画不动。
- 用 `scripts/generate-pixel-font.py` 基于 Fusion Pixel 12px（v2026.11.10，临时下载至 `/tmp` 生成后即删，不入库 `.ttf`）重新生成 `src/data/pixel-font.json`，补齐 P4 新增文案的 30 个汉字字形，确保 0 缺字。

## 测试

- **单元测试（Vitest）**：
  - `tests/unit/montecarlo.test.ts`：沿用 `runMonteCarlo`、`TEST_DECK` 与贪心策略，对 A/B/C/D 四个心魔各跑 1000 局（种子 1～1000），打印胜率与统计，对 C/D 执行与 A/B 同款断言；仅汇报胜率，不改 `src/data/balance.json`。
  - `tests/unit/save.test.ts`：验证 `demonIdForDay` 在第 1～8 天的 A→B→C→D 循环，及 6 选 3 确定性洗牌。
  - `tests/unit/pixelart.test.ts`：全量校验 23 张牌 + 6 件旧物 + 4 个心魔像素画合规性及位图字体 0 缺字。
  - `tests/unit/pawnshop.test.ts`、`tests/unit/effects.test.ts`、`tests/unit/battle.test.ts`：同步覆盖 6 件旧物估价、23 张牌完整性、3 张新牌效果与心魔 C/D 行动及「开学」预警。
- **E2E（Playwright，仅 localhost）**：
  - 扩展 `tests/e2e/dayloop.spec.ts`：验证（a）新旧物在白天收当 3 位当客中出现（调试状态 `itemsOrder`、日志与牌组可见）；（b）第 3 天夜里心魔为房租（`c`）、第 4 天为学费（`d`）、第 5 天循环回药费（`a`）。
  - 既有 E2E（`pawnshop.spec.ts`、`battle.spec.ts`、`dayloop.spec.ts`、`smoke.spec.ts`、`subpath.spec.ts`）按 6 选 3 确定性洗牌更新断言，全部保持绿灯。

## 文档记录更新

- 新建 `proto-tasks/05-p4-content-expansion.md`（本文件）。
- `docs/GAME_DESIGN.md`：文末新增 P4 增补节，v1.0 定稿核心一字不改。
- `docs/PROGRESS.md` 与 `docs/DECISIONS.md`：记录 P4 实施内容、验证结果、蒙特卡洛四心魔胜率与关键决策。

## 完成自查（做完逐项核对，缺一不可）

1. `npm run build`、`npx tsc --noEmit`、`npx vitest run`、`npm run test:e2e` 全部本地跑绿。
2. 未改 `.github/workflows/`、未改 `src/data/balance.json`、未改现有旧物/牌/心魔与现有插画、未引入新效果类型、仓库无 `.ttf` 与凭据。
3. 未 commit、未 push、未建 PR，改动留工作区交协调员独立验收。
