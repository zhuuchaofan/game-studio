# 任务书 16：试玩反馈修整轮

> 轮次：修整轮（P11 + 画布之后、P12 之前，单独立项）
> 基线：`main` @ `fd7860a`（PR #20，画布合并点）
> 分支：`feature/playtest-fix-round`
> 状态：已实施，待合并
> 依据：核查报告 `~/workspace/game-studio/playtest-20261126-investigation.md`、试玩截图 `~/workspace/game-studio/playtest-20261126-screenshots/`（7 张）、任务书 15 范本

## 0. 背景与已定事项（不可改）

- **直接动因**：制作人 2026-11-26 两局实机试玩（P11 构建，320×180 旧画布），第 1 局第 1 夜死亡，第 2 局打到第 7 天 Boss（42 血、阈值 14、4 回合，42→22 后回合耗尽，章节失败）。反馈全文与核查结论见核查报告；截图 7 张：01 失败屏、02 Boss 战（打断 11/14）、03 第 3 天结算牌组列表、04 车票战飘字、05 教程气泡、06 新娘赎当、07 手机竖屏旧版。
- **制作人 2026-11-26 07:31 定**：Boss 改法选 C——**让 AGY 用 sim 扫参数，目标典型牌组胜率 60%+**。不直接写死 6 回合或 32 血。扫参目标与护栏口径见 §2 与 §9。
- **本轮的性质**：修整轮。修试玩暴露的 bug 与信息缺失，不加新内容、不扩内容量、不重构数值系统。**不碰 P12 内容扩容（6→12 件、传家宝），不碰心魔伤害方向重构（B+C 等，另轮）**，见 §8。
- **已定口径（核查报告的错误已由三路核查纠正，以 §1 为准）**：核查报告本身有 8 处以上行号/归因错误（§1.1 汇总表），任务书所有文件:行号均以三路核查复核后的为准，不得直接抄核查报告的行号。
- **两处前提纠正**（C 路核查，影响子项范围）：
  1. **标题版本号 v0.4.1-P11 从来没有存在过**：`git grep "v0." / "0.4.1"` 在 `f84a983` 全树零命中；`git log --all -S "v0.4.1"` / `-S "0.4.1"` 零命中；画布轮 `TitleScene.ts` diff 只改坐标/字号/按钮常量，未删除任何版本行；`package.json` version 是 `"0.1.0"`。制作人记混了别处看到的版本号（可能是 `docs/PROGRESS.md` 里的 P11 标记）。因此 §7.2 是**新增**版本号，不是"加回"。
  2. **牌组列表裁字不成立**：截图 03 经像素实测，牌名字顶与色条之间有 1px 纸白间隙（JPEG 压缩糊住 + 12×12 字形顶行笔画密造成的视觉错觉）；`addPixelText` 是 BitmapText，无裁剪逻辑。§7.4 只加字库护栏与截图回归，不改结算屏布局、不改字库本身。
- **制作人玩的是旧版**：几何类问题（手牌移位、气泡、飘字）核查时同时对了 `f84a983` 旧版坐标与当前 640 版坐标；任务书给出的坐标均为 **640 版**，旧版数字只在注明处出现。

## 1. 基线核实（2026-11-26 三路核查，全部以合入后 main 的代码为准）

三路核查员 A（Boss/战斗数值与 sim）、B（白天/赎当/存档）、C（UI/文案/字库/坐标）各自独立核对，均确认：工作区 `feature/canvas-640x360 @ 349b759` 的 src/ 树与 `origin/main @ fd7860a` 的 `git diff --stat` 为空；A 路重跑 `npm run sim:check` **PASSED，约 8.8 秒**。

### 1.1 核查报告纠正汇总（任务书以下内容均按纠正后的为准）

| # | 核查报告原说法 | 纠正后（核查员） |
|---|---|---|
| B1 | 拒绝分支 `pawnshop.ts:922-935`；接受分支加钱约 940-943 | 拒绝分支 **901-912**；接受分支钱+934、口碑+1 在 935、券-1 在 940，返回块 931-942 |
| B2 | 念旧优先 `pawnshop.ts:685-688` | **690-691**（函数起 660，门控 668） |
| B3 | 迁移逻辑 `save.ts:240-312` | `MIGRATIONS` 在 **78-约130**，`migrateSaveData` 在 **276-314**；240 行是版本检查 |
| B4 | 每天 offer 确定性生成靠"确定性种子" | 正常游玩种子是 `Date.now()`（`rng.ts:33-36`）；真正决定性的是**念旧池长为 1** |
| B5 | 余音是唯一念旧牌 | 念旧牌两张（婚戒/二胡）；仅当守诺不在库时二胡才恒定出现 |
| B6 | 快照过期只因赎当移牌 | 还漏了：父亲结算后补抽可再移一张；**白天成交加牌可让 Boss 变强** |
| B7 | `bossComponentItemIds` 只记开战快照，动 `save.ts` | 字段定义在 **`chapters.ts:97`**，写点在 **`CardBattleScene.ts:249`**，`save.ts` 只校验/克隆 |
| A1 | R1 盾 5（`bossComposition.ts:150-156`） | 盾定义在 `demons.json:113`；累加 `bossComposition.ts:127-129`；写进 R1 在 **148-150** |
| A2 | R2 蓄力 +4 盾是基础动作（`battle.ts:160-175`） | 数值来源 `demons.json:171`；`battle.ts:161-180` 只是执行方，赋值在 `:168` |
| A3 | （未提） | `demons.json:79` 的 Boss 顶层 `"hp": 38` 是前合成时代残留值，`composeBoss` 从不读它（`bossComposition.ts:180-186` 以 `finalHp` 覆盖） |
| A4 | "缺约 4 点/回合" | 按有效血量 51 计缺 **约 5.5 点/回合**（51−29=22，摊 4 回合）；按裸血量 42 计约 3.3 点/回合 |
| A5 | （未提） | 本局 R3 实际伤害是 **14**（11+旧书+1+二胡+2），R2 实际是 **1**；打断成功时 R3 改写为 3（`effects.ts:397-407`，整体替换） |
| A6 | （未提） | 还有第二个实时预告点 `CalendarMapScene.ts:154` 与 `:433`；`PawnshopScene.ts:352` 的 `formatBossPreviewHpLine` 只是调试快照，不在修法范围 |
| C1 | 动画结束调 `renderBattle` → `renderHand`，剩牌跳位 | 只对**连锁的最后一张**成立：飞行期间 `renderHand` 不被调用，`refreshHandSlotsInPlace` 只改 y/填充/描边/tint、不动 x；有排队连锁时跳位推迟到整条连锁打完 |
| C2 | 截图 04 里红字 `-3` 与"人情+1"重叠 | 两者**并不重叠**（横向相隔 30px 以上）。真正重叠的是"人情+1"飘字与 HUD 常驻"人情3/3"；同病：`+N盾`飘进 HUD"命"字区、`DEMON_ACT` 的 `-hpDamage` 飘进 HUD 带 |
| C3 | 小字对比度不够，要调亮 | **银蓝字在深色底上对比度是够的**（夜黑底 7.24:1），不用调亮。真正低于 4.5 的是**禁用态结束回合字**（雾蓝，3.60:1） |
| C4 | 标题版本号 v0.4.1-P11，画布轮丢了 | 仓库里从来没有过 v0.4.1-P11（见 §0）；§7.2 是新增 |
| C5 | 牌组列表文字被裁 | 不成立（见 §0）；截图 03 像素实测字顶与色条有 1px 间隙 |
| C6 | 旧版竖屏提示是"按钮" | 旧提示是 `pointer-events: none` 的纯提示条，无点击行为、无关闭功能 |
| C7 | （未深究） | 旧版 P11 `main.ts` 确无 `refresh()`，但各场景有 `syncInputBounds`；代码里**找不到一条必然复现 1920/1024 偏移的路径**，最可能是旧构建缓存（画布部署 11-25 晚三次失败、11-26 07:1x 才成功；截图 07 拍于 11-25 22:16，当时线上仍是 P11 旧构建） |

### 1.2 P11 sim 基线（A 路 2026-11-26 实测，与 P11 一致）

- 组合 Boss：素体 n=0 **68.8%**（[50%,90%]）；典型档 n=2–5 **60.1%/56.0%/51.6%/41.4%**（[40%,85%]）；满配 n=6 **32.5%**；满配+赊账 48 血 **27.7%**（≥25%）；7 天通关率 **46.2%**（[35%,75%]）；单调性严单调不增；赎当削弱路径每赎一件不降；邮票册打断率 **25.3%**（≥10%）。
- 回归：A/B/C/D **91.3/82.1/55.9/91.3**；常赢玩家第 7 天中位现金 **57.0**（≥30）；新玩家首夜 **28.5%**（[20%,45%]）、单攻击牌 **8.8%**（[5%,25%]）、双攻击牌 100%。
- 单场 Boss 测试胜率 **48.5%**（[45%,85%]，TEST_DECK + 未合成 38 血 Boss，1000 局）。
- **第 1 章通关率 = Boss 胜率**（通关当且仅当 Boss 胜，非两个独立数字）。
- `TEST_DECK` 固定弱牌组对照仅 **15.4%**，只作对照，不是典型牌组，不得当作目标口径。

### 1.3 制作人本局的伤害账（A 路复核，§2 扫参的校准锚点）

- 本局 Boss 42 血 = n=5 档；有效血量 **42+9=51**（R1 盾 5 + R2 蓄力盾 4）。4 回合需约 12.75 点/回合原始伤害；制作人 4 回合共约 29 点（每回合 6–10 点），缺口 22，摊下来**缺约 5.5 点/回合**。
- **51 是上限而非定值**：须 R1 打满 ≥5 点、R2 打满 ≥4 点才吃满 9 点盾；任一回合打不够，未消耗的盾在回合结束时直接清零（`battle.ts:612-613`），有效血量随之降低。
- 9 点盾仅当婚戒在场；否则为 4 点（有效血量 46）。本局婚戒在场，成立。
- 打断口径：阈值累计按**扣盾前的原始伤害**（`effects.ts:392-398`；盾吸收在 `:372-374` 另算）；达阈值后人情 +1（`demons.json:175`），下一回合伤害改写为 `interruptedNextDamage`（=3，`demons.json:176`，整体替换，不是 14−3）。
- 本局子集可推定为 `[ring, old_book, bicycle, erhu, stamp_album]`（手表被父亲赎回，余下 5 件，含邮票册故阈值 14、含婚戒故开局盾 5）。该**单子集胜率在现有报告里没有印出**；最接近的已印数字是赎当路径 step 1（去掉邮票册的 n=5，阈值 10）：37.1%。见 §2.3。

## 2. 子项 1：Boss sim 扫参（C 方案，制作人已定）

### 2.1 目标（写死口径，不得换）

- **主指标**：`simulateBossCompositionScan` 的 `tiersNoCredit[n].avgWinRate`（`montecarlo.ts:1275` 起，`buildTiers` 约 1360-1395 行）。**n=5 档 ≥60%**（现 41.4%）。
- **样本量**：每子集 1000 局；n=2..5 每档只取 **2 个实测最常见子集**（`selectObservedSubsetsForCount`，`montecarlo.ts:1164-1200`，`maxSubsets=2`），即每档 2000 局平均；n=0/1/6 为单子集或全单件。
- **校准锚点**：n=5 档现 41.4%（打断率 27.2%、均回合 3.79）是**两个子集的平均**，不是制作人本局精确子集的胜率。扫参输出**必须打印各子集明细**，并把制作人本局精确子集 `[ring, old_book, bicycle, erhu, stamp_album]` 加入扫描（若它不在两个实测最常见子集里）；否则"41.4%→60%"的锚点本身含子集平均误差。候补子集见 `FALLBACK_SUBSETS_BY_COUNT`（`montecarlo.ts:1138-1162`，其中 n=5 两项均含邮票册、阈值 14）。
- **不得混用的口径**：完整 7 天模拟的 Boss 胜率（`simulateChapterOne`，`montecarlo.ts:871` 起，Boss 合成在 `:1056`，当前 46.2%）；`TEST_DECK` 固定弱牌组对照（15.4%）。
- **扫参表交付物**：每组参数 → n=0..6 各档胜率、打断率、第 1 章通关率、单场 Boss 测试胜率；最终选定参数 + 对应 sim 数字写进 PR 描述与 §7.6 的 GDD 增补。

### 2.2 扫参维度表

| 维度 | 现值 | 扫参范围（建议） | 所在文件 | 备注 |
|---|---|---|---|---|
| 回合数 | 4（Boss `actions` 长度） | 4–6（增 R5/R6 动作，各写 damage/skill） | `src/data/demons.json:165-180`；引擎 `src/game/battle.ts:211`（`maxRounds = demon.actions.length`，无需改） | 无 `SIM_TUNE` 键；改后单场 Boss 测试同步变化 |
| 基础血量 baseHp | 32 | 28–32 | `src/data/demons.json:86` | 无 `SIM_TUNE` 键；`bossCh1Hp` 对合成 Boss **无效**（见 2.3） |
| 每块 +血 hpBonus | 2（6 件统一） | 0–2（可逐件） | `src/data/demons.json` 各 component 的 `hpBonus`（如 `:100` 附近） | 与 baseHp 联动决定各档血量 |
| 合成上限 maxCompositionHp | 44 | 38–44（或随 baseHp 联动） | `src/data/demons.json:87` | 绝对上限 48（`:88`）与赊账 +6（`chapters.json:34`）另计 |
| R1 开局盾（婚戒碎片 shield） | 5 | 0–5 | `src/data/demons.json:113` | 仅婚戒在场时生效；执行 `battle.ts:213-215` |
| R2 蓄力盾 | 4 | 0–4 | `src/data/demons.json:171`（R2 动作 `shield`） | 执行 `battle.ts:161-180`，赋值 `:168` |
| 封门阈值 | 10（基础）+4（邮票册）= 14 | 基础 8–10；邮票册增量 2–4 | `src/data/demons.json:174`；增量 `:162`；叠加 `bossComposition.ts:152-153` | 打断返 +1 人情（`:175`）、打断后 R3 改 3（`:176`）**不建议同轮扫** |

**不动的 Boss 数值**：各回合伤害值（R1 3 / R3 11 / R4 6）、打断返 +1 人情、打断后 R3 改 3。改回合数只动一处数据：`demons.json` 里 Boss 的 `actions` 数组增删条目，零代码改动；但 R5/R6 不能只加空壳——每个新增动作必须写明 `round` / `damage` / 有无 `skill` / `shield` / `charge`，否则只会多给空回合（`endTurn` 在 `battle.ts:603-607` 按 `maxRounds` 判超时，`activateRoundChargeIfAny` 按 `round` 找动作，找不到即无动作）。`validate.ts:222` 只要求 actions 至少覆盖 1/2/3 回合，无上限约束。sim 自动跟随（`simulateChapterBattle` 调同一 `createBattle`）。

### 2.3 扫参方式（默认 i，见 §12 Q3）

- **扫参维度无一可直接参数化**。`SIM_TUNE` 白名单只有 14 个键（`montecarlo.ts:1612-1627`）：`demonAHp/B/C/DHp、bossCh1Hp、startingHp、startingRenqing、maxRenqing、drawFirst、drawPerRound、winRewardMoney、startingMoney、runs、days`。其中：
  - 回合数 4–6：无键，只能改 `demons.json` 的 Boss `actions`。
  - 基础血量 32：无键。**`bossCh1Hp` 是陷阱**：它只覆盖 `demons.json:79` 的顶层 `hp`（`montecarlo.ts:1665-1679`），而 `composeBoss` 完全不读顶层 `hp`——对合成 Boss 扫描、`simulateChapterOne` 均无效，只影响单场 Boss 测试（该测试用未合成的 38 血 Boss）。任务书若写"用 `SIM_TUNE bossCh1Hp` 扫血量"是错的，**禁用**。
  - 每块 +血、R1 开局盾、R2 蓄力盾、封门阈值：全部只在 `demons.json` 里，无 `SIM_TUNE` 键。
- **方式 (i)（默认）**：直接改 `demons.json` + 重跑 `sim:check`（单次约 9 秒，逐格扫完全可行）。每格扫完记录，不得为省事只扫对角线。
- **方式 (ii)（备选）**：新增 `SIM_TUNE` 键 + 在 `runBalanceSimulation`（`montecarlo.ts:1657`）里透传进 `baseBoss`。这是代码改动，须 §12 Q3 另行批准；默认不走。
- **sim 耗时红线**：单次 `sim:check` 约 9 秒；整轮扫参如超过 10 分钟未完成，立即停下来查原因（先看真正干活的 node 子进程 CPU 时间，不得只看 npm/sh 包装进程），不得放任烧 CPU，不得为赶时间跳过 sim。

### 2.4 目标 60% 与护栏的张力（扫参时同步盯，口径见 §9）

- 典型档上限 85% 无冲突；但 Boss 变易会同步抬升通关率（现 46.2%）与素体胜率（现 68.8%），须分别守住 75% 与 90% 上限。
- 若只降血量不降阈值，打断率护栏（≥10%）仍有余量（现满配打断率 25.3%）。
- 选定参数须同时满足：n=5 ≥60%、n=2..4 在 [40%,85%] 内、n=0 在 [50%,90%] 内、通关率在 [35%,75%] 内、满配+赊账 ≥25%、单调性与赎当削弱容差 3% 以内、打断率 ≥10%、单场 Boss 测试在 [45%,85%] 内。

## 3. 子项 2：Boss 血量快照

**问题**：第 7 天预告屏的 Boss 血量是过期快照。预告点 `PawnshopScene.ts:683` 调 `formatBossPreviewHpLine(composeBoss(deck))`（`bossComposition.ts:222-232`），44 = 32 + 6 件×2；进战斗 `CardBattleScene.ts:246` 重新 `composeBoss(resolvedDeck, pactChoice)`，42 = 32 + 5 件×2。差的一件是预告后父亲事件破例赎回手表（倒转离库）。预告屏自己写着"今日白天收当/赎当仍可改变今夜 Boss 构成"，但改完再也没把更新后的数字展示给玩家。

**预告→战斗之间能改牌库的全部路径**（B 路核查，修法必须全覆盖，只修赎当路径不够）：

| # | 路径 | 位置 | 对 Boss 的影响 |
|---|---|---|---|
| 1 | 父亲接受：移出倒转 | `pawnshop.ts:755-786`（触发条件 763 行：`dayInChapter !== 7 \|\| alreadyTriggered` → null；无倒转 → null，765-768） | −1 块 |
| 2 | 随机赎当接受：移出 1 张旧物牌 | `resolveRedemption`（`pawnshop.ts:837` 起） | −1 块；拒绝不移 |
| 3 | 父亲结算后补抽随机赎当再接受 | `PawnshopScene.ts:1538-1566` | 同一天可再移一张，累计 −2 块 |
| 4 | 白天正常当客成交会加牌 | `settle` 接受时 `nextDeck = [...state.deck, currentItem.cardName]`（`pawnshop.ts:985`）；第 7 天 3 位当客（`DAILY_CUSTOMER_COUNT = 3`，`pawnshop.ts:228`） | 可能 **+1 块**（只有新种类旧物才加块，`composeBoss` 对同名重复牌去重，`bossComposition.ts:116-123`）；预告可能变大，不只变小 |

第 7 天不存在的其他事件（已排除）：新娘事件被抑制（`PawnshopScene.ts:223-233`，`needsDay7BossPreview` 时 `brideOffer = null`）；第 4 天契约/剪牌、第 6 天支线（支线只影响夜里心魔血量加成，`chapters.ts:282-287`，且第 7 天 `demonHpBonus = 0`，`PawnshopScene.ts:1987`）；第 3 天流言是纯文案。跳过当客不改牌库（`skipCustomer`，`pawnshop.ts:1024` 起）。

**执行顺序**（第 7 天事件顺序表）：

| 顺序 | 事件 | 位置 | 说明 |
|---|---|---|---|
| 1 | 场景 `create()`：生成当日当客，`phase = boss_preview` | `PawnshopScene.ts:211-265` | 预告快照取此时牌库 |
| 2 | 封门预告屏（HP 行 44/42 即此处快照） | `renderBossPreview` 663 起，HP 行 683 | 只读 |
| 3 | 点"知道了·开门" → `enterPostBossPreviewEvents` | 752-758 → 629-660 | 父亲优先（632-638），否则随机赎当（641-652），phase 置 `redemption`/`negotiating`（655-659） |
| 4 | 父亲事件（手表在库且未触发过；不耗券） | `pawnshop.ts:755-786` | 接受：移出倒转，Boss −1 块；拒绝：口碑−1，牌保留 |
| 5 | 随机赎当（父亲不存在时；或父亲结算后补抽） | 641-652；补抽 1538-1566 | 接受：移出 1 张旧物牌；拒绝：券保留、不移牌 |
| 6 | 3 位当客：买 / 拒 / 跳过 | `settle`（`pawnshop.ts:960-1010`，加牌在 985） | 成交：牌库 +1 张，Boss 可能 +1 块（新种类才计，重复去重） |
| 7 | 结算屏 → "迎战大心魔" | `PawnshopScene.ts:1989-2000` | 经 `TransitionScene` 进战斗，传当时牌库 |
| 8 | 开战重算 Boss 并写开战快照 | `CardBattleScene.ts:246`（`composeBoss`）、`:249`（写 `bossComponentItemIds`） | 此处为准，与预告不一致即本 bug |

**两种修法（二选一，见 §12 Q2；推荐 B）**：

- **A. 快照带进战斗**：`PawnshopScene.ts:626` `getComposedBossPreview()`（预告时把 `composed.activeComponents` 的 itemId 列表或当时牌库存入章状态，可复用 `chapters.ts:97` 的 `bossComponentItemIds` 字段，但须注意它目前语义是「开战快照」，改写时点会改变 `buildEndingLedger`（`bossComposition.ts:270-281`）的输入来源——若战斗改用快照，账本点名与实战一致，无冲突）；`CardBattleScene.ts:246-249`（有快照时不再 `composeBoss(resolvedDeck)`，改为按快照 itemId→牌名合成，可复用 `montecarlo.ts:1216-1218` 的 `itemId→cardName` 映射写法；`composeBoss` 本身不用改）；若新增字段，需同步 `save.ts:226-229` 的校验与 `chapters.ts:219-236` 的克隆。
- **B. 赎当后重算并提示**（推荐）：`pawnshop.ts:837` `resolveRedemption` 接受分支之后（或 `PawnshopScene.ts:629-660` `enterPostBossPreviewEvents` 内赎当成交回调处）重调 `PawnshopScene.ts:626` `getComposedBossPreview()`，把新旧 `finalHp` 差值用 `PawnshopScene.ts:683` 的血量行或 `~766` 的 `showToast` 提示（如「Boss 已变弱 44→42」；变强时同理提示，如「Boss 已变强 42→44」）；`CardBattleScene.ts:246` 与 `save.ts` 不动。

**注意**：字段归属——`bossComponentItemIds` 定义在 `chapters.ts:97`（注释写明「第 7 夜开战时实际构成 Boss 的旧物 ID 快照」），`save.ts:226-229` 只是校验，克隆在 `chapters.ts:230-231`，写点在 `CardBattleScene.ts:249`。另：`CardBattleScene` 全文件无 `saveGame` 调用，快照只在内存里，直到 `ResultScene.ts:168-174` 的 `applyDayResult` + `saveGame` 才落盘——中途退出战斗会丢快照，正常打完则无影响。另有第二个实时预告点 `CalendarMapScene.ts:154` 与 `:433`（日历页预告文案），同样按当时牌库实时计算；日历页出现在预告之前，赎当尚未发生，实际无 44/42 错位——**不在本子项修法范围**，任务书注明即可。`PawnshopScene.ts:352` 的 `formatBossPreviewHpLine` 只是调试快照（`__BATTLE_DEBUG__` 用），不是玩家可见预告，不得列入修法范围。

**回归**：父亲事件破例赎回后 Boss 变弱可验证（E2E：预告 44 → 接受父亲 → 战斗 42；修法 B 则提示「Boss 已变弱 44→42」可见；修法 A 则战斗直接用快照 44——注意两种修法回归断言相反，以 §12 定稿为准）。

## 4. 子项 3：赎当拒绝留痕

**问题**：第 5 天二胡赎当拒绝后，第 6 天早上又弹出来（另：中途重进场景/读档也会原样再弹一次）。三者叠加：(a) 拒绝不留记录；(b) 念旧池长为 1 时抽取结果恒定；(c) 念旧优先。

**根因（B 路核查，纠正核查报告）**：

- 拒绝分支（`pawnshop.ts:901-912`）只清掉当前 offer，不往存档写任何「今天已看过」的标记。接受分支钱+在 934、口碑+1 在 935、券−1 在 940，返回块 931-942。
- **"确定性种子"归因是错的**：`deriveRedemptionSeed(seed, day)` 确实只依赖 baseSeed + 绝对天数（`pawnshop.ts:498-500`，`hashSeed(`${baseSeed}:redeem:${day}`)`），但 baseSeed 本身在正常游玩下**不确定**：`createRngFromUrl` 无 `?seed=` 时回落到 `Date.now()`（`src/utils/rng.ts:33-36`、`45-52`），每次加载页面种子都不同。种子确定只在测试/固定 `?seed=` 时成立。
- 真正让二胡"每天早上永远出现"的是**念旧池只有 1 个候选**：`createRedemptionOffer` 先取念旧牌做池（`pawnshop.ts:690-691`，不是核查报告说的 685-688），再 `rng()` 抽下标（693-694）。池长为 1 时下标恒为 0，种子无关。
- 念旧牌有两张，不是只有二胡——`src/data/items.json` 里 `ring`（婚戒/守诺）和 `erhu`（二胡/余音）都是 `sentimental`。仅当守诺不在库时二胡才恒定出现（例如第 2 天新娘事件已赎走婚戒）。若守诺也在库，池长为 2，抽取结果随种子变化。
- offer 还依赖典当价账本（`pawnPrices` 决定 basePrice→payout，`pawnshop.ts:695-697`）和契约倍率；选件只依赖牌库+种子，payout 还依赖这两者。"同一牌库、同一券数"须补"同一账本、同一契约"才保证同一 payout。门控在 `pawnshop.ts:668`（券<1 或空牌库返回 null），候选为空亦返回 null。
- offer 不进存档：`SaveData`（`src/game/save.ts:21-40`）无 `redemptionOffer` 字段；场景每次 `create()` 都重新生成（`src/scenes/PawnshopScene.ts:173` 取种子、`239-256` 生成 offer）。读档（标题继续）、刷新、返回标题再进都会重生成；每天进入新一天也是全新 `create()`，所以重复弹**不需要重进**——每天早上都会重新生成一次，这是 bug 的主路径。
- 同一会话内拒绝后无其他入口（`resolveRedemption` 拒绝分支只清 offer、进 `negotiating`）。但当天另有入口可再弹：(1) 剧本后补抽（`PawnshopScene.ts:1538-1566`）：第 2 天拒新娘 / 第 7 天拒/接受父亲后，都会再生成一次随机赎当；被拒的剧本牌会被 blank 掉（1544-1547，`candidateDeck` 把该牌名映射为空串），所以不会再弹同一件剧本牌，但可能弹出二胡；(2) 第 4 天：早上生成被抑制（`PawnshopScene.ts:224`、`242`），但契约选定后 `handlePactChoice:925→959`、剪牌后 `handleTrimCard:1074→1091`、跳过剪牌 `handleSkipTrim:1094→1108` 都调 `enterPostDay4Events`（805-824）再生成一次随机赎当；(3) 任何重进都会在 `create()` 重生成。
- **"日限 1 次"是伪规则**：代码里没有任何日限字段/计数器，"一天一次"只是生成点单次调用的 emergent 性质。生成点共 4 处：`create()` 早晨（`PawnshopScene.ts:239-256`）、第 7 天预告后（629-660）、第 4 天契约/剪牌后（805-824）、剧本后补抽（1538-1566）。重进即重生成。**不得新增"日限"计数器**，留痕字段即是防重弹的机制。

**修法（已定，不须 §12 再议）**：

| 步骤 | 位置 | 仿照 |
|---|---|---|
| 字段 | `chapters.ts:92-93` 旁加 `rejectedRedemptionDayByItem?: Record<string, number>`（itemId → 绝对天 `save.day`） | `redeemedDayByItem`（D1 冷却） |
| 校验 | `save.ts:199-218` 段，仿 `redeemedDayByItem` 的校验块 | 同上 |
| 初始 | `chapters.ts:207-209` 旁 | 同上 |
| 深拷贝 | `chapters.ts:224-226` 旁（只展开不写会使多份 clone 共享同一对象引用，`cloneChapterState` 其余字段都是深拷贝） | 同上 |
| 写入 | `PawnshopScene.ts:1486-1495` 附近，在 `handleRedemption` 里、仅随机 offer 且 `!accept` 时写（剧本已有 done 旗，见下） | `day2BrideRedemptionDone`/`day7FatherRedemptionDone` 置位处 |
| 读取 | `createRedemptionOffer` 加可选参数（如 `rejectedDayByItem` + `day`），生成时跳过当天已拒件；**放函数内**，4 处生成点一次覆盖 | `isItemOnRedemptionCooldown`（`pawnshop.ts:538-554`）的传参模式 |

- **不需要存档版本升级（v3 不动）**：现有模式就是可选字段 + 默认缺失，P10/P11 已三次用过：`day1RingPawned`、`day2BrideRedemptionDone`、`day7FatherRedemptionDone`、`redeemedDayByItem`、`pawnedItemIds`、`bossComponentItemIds` 全是 `ChapterSaveState` 的可选字段（`chapters.ts:86-97`）；校验只在存在时验类型（`save.ts:187-232`）；`createInitialChapterState` 只在 overrides 提供时写入（`chapters.ts:198-215`）；`saveGame` 经 `cloneChapterState` 透传（`save.ts:434-452`）。旧存档读入后字段缺失即"未拒绝过"，与 `tutorialCompleted?` 同款。
- **语义已定：A"某天拒绝某件"**：只屏蔽当天该件；第二天同一件可再弹（若仍是唯一念旧候选）；换件不受影响。修掉制作人第 5 天的重复弹，但第 6 天可能再弹二胡——明确这是可接受的（玩家次日可重新决定）。
- **语义 B 不采用**："某天拒绝过就不再弹"（如 `lastRedemptionRejectedDay: number`）会误伤"剧本后补抽"设计（第 2 天拒新娘后补抽、第 7 天拒父亲后补抽都会被屏蔽，与"不占当日随机赎当名额"冲突）。若写成"拒过的件永久不再弹"则改变玩法，玩家永久失去赎回该牌的机会。
- 天数必须用**绝对天 `save.day`**（与 `redeemedDayByItem` 一致，写入点 `PawnshopScene.ts:1492-1495` 用 `this.state.day`），不要用 `dayInChapter`（跨章会撞）。D1 冷却规则供参考：`0 <= day - redeemedDay <= 2`（`pawnshop.ts:538-554`，含当天及之后 2 天）。
- 剧本事件不需要新字段：`day2BrideRedemptionDone`、`day7FatherRedemptionDone` 在 `handleRedemption` 中**无论接受/拒绝都置 true**（`PawnshopScene.ts:1486-1490`），只触发一次已有保障。注意是结算时才置位，面板打开时刷新/退出则不置位，下次重进预告会重弹。
- 拒绝不消耗券：随机拒绝分支 `pawnshop.ts:901-912`（`redeemTickets: currentTickets`，909 行）；面板文案亦写明（`PawnshopScene.ts:1438`）。接受：券−1（940）、钱+（934）、口碑+1（935）。剧本拒绝口碑−1、券不变（859/864）；剧本接受钱+口碑+1、券不变（889-895）。
- **测试用例**：拒绝→刷新/回标题重进→同一件不再弹且券数不变；拒绝→第二天→同一件可再弹（语义 A）；接受→券−1 且 `redeemedDayByItem` 写入、D1 冷却生效。
- **"点平价钱没变"不修**：赎当面板上根本没有"平价"按钮，只有接受/拒绝（`renderRedemption`，`PawnshopScene.ts:1238-1470`；三个分支每分支恰 2 个 `addActionButton`，按钮常量 `src/game/layout.ts:30-31`；随机分支文案：接受 `1429`、拒绝 `1438`——"拒绝:牌与赎当券均保留"）。接受分支无条件加钱并立即存盘（钱+在 `pawnshop.ts:934`、口碑+1 在 935、券−1 在 940）。三种可能：制作人记混了按钮名；点的是正常当客的"平价"——报价被拒（平价接受率 80%）时钱确实不变，但 `settle`（`pawnshop.ts:960+`）每次报价后都会进 feedback、换下一位当客，不会同一当客反复弹；点击坐标偏移（见 §7.3）。**需制作人确认到底点了哪个按钮**，本轮不据此改代码。

## 5. 子项 4：战斗操作与反馈

### 5.1 手牌移位

**问题**：出牌后剩下的手牌会重新居中、换位置，连着点很容易点空，或者误按「结束回合」。制作人第 1 局因此白丢了一个回合。

**机制（C 路核查，纠正核查报告的时序）**：

- `renderHand()`（`CardBattleScene.ts:897-899`，全量 `removeAll` 后按 `computeHandCardX` 重建）在飞行期间**不**被调用；`refreshHandSlotsInPlace()`（`:1035-1063`）只改 `y`/填充/描边/tint，**不动 x**。出牌 240ms 飞行结束 → `drainNextQueuedPlay()`（`:1293-1318`）→ 若队列已空才调 `renderBattle()` → `renderHand()`，剩牌在**动画结束瞬间**跳位。核查报告"动画结束调 renderBattle → renderHand"只对**连锁的最后一张**成立——有排队连锁时，`drainNextQueuedPlay` 会直接 `launchSlotAnimation` 下一张而不重排，跳位推迟到整条连锁打完。
- 坐标（640 版）：结束回合钮 `layout.ts:69` `(564,186,128,44)` → x 500..628、y 164..208；`layout.ts:65` `BATTLE_HAND_Y=288`，卡高 128 → 手牌顶 224；**纵向间隙 16px**。横向：`computeHandCardX`（`layout.ts:77-94`）算得最右列卡中心 3 张 424 / 4 张 476 / 5 张 528 / 6 张 580，按钮 x 500..628 与最右列的横向重叠为 **3 张 0px、4 张 24px、5 张 76px、6 张 96px**——"横向正对最右列"只在手牌 ≥4 张时成立。另：悬停抬起（`HAND_Y-8`）与排队抬起（`HAND_Y-10`）把有效间隙分别压到 8px / 6px。
- 排队路径成立：`handleEndTurn()`（`:1319-1330`）在 `isAnimating` 时置 `queuedEndTurn=true`（字段 `:156`，复位 `:186`），`drainNextQueuedPlay`（`:1310-1316`）排空后立即 `renderBattle()` + `handleEndTurn()` → 马上结算。补充：`renderBattle` 的 `canAct` 只改按钮**外观**（`:582` 左右），不拦截点击；另 `handleEndTurn` 在排队前会先 `dismissIntroBanner()`（横幅被顺手关掉）。
- `FLY_DURATION_MS = 240` 在 `:102` 确认。

**两种修法（二选一，见 §12 Q1；推荐 A）**：

- **A. 出牌后保持原位、回合结束再整理**（推荐：确定性高、无动画时序边角）：`renderHand`（`:897`，拆"只刷新不重排"分支或加 `keepPositions` 参数）+ `drainNextQueuedPlay`（`:1293`，排空后不立即完整 `renderBattle`）+ `handleEndTurn`（`:1319`，结算完成后再调一次完整重排）。`refreshHandSlotsInPlace`（`:1035`）现状已 x 稳定，可直接复用。
- **B. 加位移动画**：`renderHand`（`:897`，对存活 slot 做 `tween.x` 240ms 而非重建）或新增 `slideHandToCenter()` 由 `drainNextQueuedPlay`（`:1293`）调用；需处理飞行中点牌（`playQueue`）与 `pendingChoice` 打断。钮的排队逻辑不动。
- 钮本身的改动点另有：`layout.ts:69`（坐标）、`createActionStrip`（`:545-575`，创建与 pointerdown）、`handleEndTurn` 排队分支（`:1319-1330`，如改为动画期间禁用/二次确认）。无论 A/B，**动画期间点结束回合不得再被排队后立刻结算**：改为动画期间禁用（按钮置灰且不接受点击），或二次确认；二者取一，见 §12 Q1。

**验收**：战斗连拍截图——出牌瞬间、队列排空后、回合结束时；重点截最右列手牌与结束回合钮（手牌 5 张时）；E2E 覆盖"出牌后立即点原位置的牌"与"动画期间点结束回合不结算"。

### 5.2 飘字重叠与盾吸收拆分

**问题**：伤害飘字会叠在一起（截图 04、11）；Boss 的盾从 5 掉到 4、3，画面上没说为什么。

**重叠（C 路核查，含一处纠正）**：

- 打断重叠成立，数字精确：`-N` 在 `(DEMON_X, DEMON_Y-24)=(148,60)`（`CardBattleScene.ts:1209`），`打断${skill}!` 在 `(148,76)`（`:1248`，`DEMON_Y-8`），纵向差 **16px**；`addPixelText` 默认字号 24（`pixelFont.ts`），字高 24 → 两行垂直重叠 **8px**（48..72 vs 64..88），且两者都以 28px/360ms 同速上飘，间距全程不变。连续出牌：飘字寿命 360ms（`spawnFloatText` `:1281-1291`，tween `duration: 360`）> 出牌间隔 240ms，第二张的事件在 t=240ms 触发时第一张飘字仍活 120ms，同锚点重叠。遗漏：同一 `playCard` 的同批事件里还有同锚点同时间的碰撞——`DAMAGE_DEALT`、`REFLECT_TRIGGERED`、`BOSS_CHARGE_STARTED` 三者都在 `(148,60)`（`:1209/1222/1241`）。
- **纠正**：截图 04 里红字 `-3` 与顶部"人情+1"**并未相互重叠**。`-3` 是 `DAMAGE_DEALT`（恶魔锚点 x≈148，y 60 起飘；反馈行"打出 余音（伤3情+1）"佐证是余音的 3 伤），横向约 136..160；"人情+1"飘字（`RENQING_GAINED`，`(240,52)`，`:1235`）横向约 192..288，两者相隔 30px 以上。**真正重叠的是"人情+1"飘字与 HUD 常驻"人情3/3"**（`:607`，x=180 起，y=18）：飘字从 y=52 上飘 28px 至 y=24，侵入 HUD 带（高 36），与同为黄色系的 HUD 字（黄铜 `#C9973F` vs 灯黄 `#E8B34B`）几乎完全重合，截图里"人情"重影、"3/3"被"+1"盖住。同病：`+N盾`（`(112,52)`，`:1216`）上飘进 HUD"命"字区；`DEMON_ACT` 的 `-hpDamage`（`(96,56)`，`:1259`）同样会飘进 HUD 带。
- **修法**：同批事件飘字按下标纵向错开，或加队列依次飘；**收益类飘字（人情/盾/治疗）不得飘进 HUD 带**（锚点下移或封顶上飘高度，二者取一，须截图验证）。只动 `CardBattleScene.ts` 的 `presentBattleEvents`（`:1202-1278`）与 `spawnFloatText`（`:1281-1291`）。

**盾吸收拆分**：

- 盾的来源：R1 开局盾 +5 是婚戒碎片（`demons.json:113`，开战时由 `createBattle`（`battle.ts:213-215`，取 R1 动作的 `shield`，合成后已含 +5）设为初始 `demonShield`）；R2 蓄力 +4 盾是 Boss 基础动作（`demons.json:171`，R2 回合开始时 `activateRoundChargeIfAny`（`battle.ts:161-180`，赋值 `:168`）设置）。盾每回合清零：`battle.ts:612-613`（`endTurn` 进入下一回合时 `shield = 0; demonShield = 0`）。掉的唯一原因是**伤害被盾吸收**（`effects.ts:372-374`：`shieldAbsorbed = min(盾, 伤害)`，`demonShield -= shieldAbsorbed`）。5→4→3 就是玩家两次 1 点伤害被盾吃掉。
- **事件字段已带齐，不用动事件层**。`DAMAGE_DEALT` 的 `shieldAbsorbed / hpDamage / demonShieldAfter` 为可选字段（类型 `effects.ts:123-134`；赋值 `:372-390` 的条件展开——**只在 `shieldAbsorbed > 0 || isBoss` 时才附加**，非 Boss 无盾时字段缺失，显示层须用 `?? ev.amount` 兜底）；`DEMON_ACT` 的 `absorbed / hpDamage / rawDamage` 全量携带（`battle.ts:556-569`）。今天 `presentBattleEvents`（`:1202-1278`）一次没读这些字段：`:1209` 只用 `ev.amount`（原始伤害），`:1255-1268` 只显示 `-hpDamage` 或"格挡"，**部分吸收时（absorbed>0 且 hpDamage>0）被盾挡掉的部分直接丢了**。
- **修法**：只动 `presentBattleEvents` 一处函数的两个 case（`DAMAGE_DEALT` `:1209`、`DEMON_ACT` `:1255-1268`）。显示规则：全部被盾挡下（hpDamage=0、absorbed>0）显示「盾挡 N」；部分吸收（两者都 >0）显示「-N（盾挡 M）」，如 `-3（盾挡 3）`；无吸收时保持现有 `-N`。`BOSS_CHARGE_INTERRUPTED` 的 `damageDealt`（`effects.ts:163-170`）也可顺带用于打断飘字显实伤。

**验收**：Boss R2 打断瞬间截图（`-N` 与"打断封门!"同框不重叠）；连续出牌两张截图（第二张飘字升起时第一张仍在，不重叠）；`人情+1` 飘字与 HUD"人情"同框截图（不重叠）；盾吸收拆分截图（全挡与部分吸收各一张）。

### 5.3 HUD「抽 N」文案

**问题**：回合开始显示「抽6」，手里只有 3 张，也没提示是不是有手牌上限。

**根因（C 路核查）**：`:619` 就是 `抽${this.state.drawPile.length} 弃${this.state.discardPile.length}`（`renderHud` 内，右对齐 `x=BASE_WIDTH-12, y=18`，银蓝字）。"抽 6 是抽牌堆剩余"正确。开局抽 5 / 每回合抽 2 正确：`balance.json: drawFirst 5 / drawPerRound 2`，`battle.ts:266`（开局）与 `:623`（回合开始）各调一次 `drawCardsWithEvents`。无手牌上限正确（全仓无 `maxHand`，只在 `hand.length===0` 时判空）。

**修法（二选一，见 §12 Q6；推荐 A）**：

- **A. 「牌库 6 弃 0」**（推荐）：只动 `CardBattleScene.ts:619` 一处，改成 ``牌库${drawPile.length} 弃${discardPile.length}``。
- **B. 显示本回合实抽数**：**没有现成变量**。`CARDS_DRAWN` 事件带 `cards` 数组（类型 `effects.ts:175`，发出 `:362`），但 `CardBattleScene` 从不消费它（`presentBattleEvents` 无此 case）；开局事件在 `battle.ts:266` 被丢弃（只取 `.state`）；每回合事件在 `:623` 混入 `endTurn` 事件流，`handleEndTurn` 能拿到但未用。需新增场景字段（如 `lastDrawnCount`），在 `handleEndTurn`（`:1319` 起）从 events 取 `CARDS_DRAWN` 的 `cards.length`，在 `create` 开局处记实抽（或直接用初始 `hand.length`），再由 `renderHud`（`:619`）显示——**3 处改动点，全在 `CardBattleScene.ts` 内**。
- 边缘情况（两种修法都要处理）：`drawCardsWithEvents`（`effects.ts:300-362`，含弃牌洗回分支）按余量抽，牌库+弃牌合计不足时实抽 < 抽数，无提示。修法 A 下此情况不产生误导（显示的是剩余数）；修法 B 下须显示实抽数本身。

**验收**：开局 HUD 截图（应为"牌库 N"或"本回合抽 5"）+ 第 2 回合开始后 HUD 截图。

## 6. 子项 5：教程、新词与失败页

### 6.1 教程气泡 vs 开场横幅

**问题**：战斗教程的提示框正好盖住敌人血量，点了好几次才关掉。

**根因（C 路核查，纠正"盖住的东西"）**：

- 血条本身没被盖：`DEMON_HP_BAR_RECT`（`layout.ts:71`，y 76..84）与气泡（y 130 起）无交集。核查报告"盖的不是血条"正确。
- **真正被盖的是开场横幅**：4/6、5/6 气泡 box 均为 `(44,130,452,88)`（`tutorial.ts` `night_play` / `renqing`），即 x 44..496、y 130..218；横幅常规 `(46,132,444,82)`（`layout.ts:72`），即 x 46..490、y 132..214；**重叠 ≈ 整块横幅**。depth 气泡 100（`tutorialBubble.ts:52`）压横幅 90（`CardBattleScene.ts:371`）。两者同时出现于 `CardBattleScene.ts:311-312`（`showDemonIntroBanner()` 紧接 `renderTutorialBubble()`，且 `create` 里 `:280` 已由 `syncTutorialForBattle` 把当前步置为 `night_play`）。截图 05 佐证：气泡盖住横幅，只在右侧露出横幅第二行末字"来"（横幅第二行约 20 字，末字中心 ≈496，半个字伸出气泡右缘 496）。
- **纠正**：`CardBattleScene.ts:361-363` 的注释"Boss 3 行 y=126..222"是错的。实际 `cy=171`、`bannerH=104` → `topY=119`，**3 行横幅 y=119..223**，底边距手牌顶（224）仅 **1px**。2 行（131..215）与常规（132..214）注释无误。
- **遗漏补充**：(1) 横幅 2400ms 后自动消失（`INTRO_BANNER_MS`，`:102` 附近常量，`showDemonIntroBanner` 末尾 `delayedCall`），气泡不点不走 → **横幅在气泡后面白白烧掉 2.4 秒，玩家基本看不到**，不只是"盖住"；(2) 气泡还盖住恶魔徽章行（`detailLayer` y=144，`:780-825`）与卡片详情条（约 y 196..218），不只横幅；(3) 4/6 指针朝下伸到 y=228，戳进手牌区顶 4px（`tutorialBubble.ts` 指针段）；5/6 指针朝上（x=232）伸到 y=120，与恶魔信息板底边（y 42..126）交叠 6px；(4) 6/6 复核通过：`ResultScene.ts:546` 注释已分区（正文 ≤180、气泡 186..274、按钮 286..334），`tutorial.ts` 6/6 box `(32,186,576,88)` 无冲突。
- **空间上没有干净的挪位区**：中带（130..218）是唯一能放 452×88 的矩形，上方是恶魔区（42..126）、下方是手牌区（224..352）。

**修法（二选一，见 §12 Q4；推荐延迟出现）**：

- **首选横幅延迟出现**：`renderTutorialBubble` 推进到 null（或 `tutorial.active` 为 false）后再 `showDemonIntroBanner`，2400ms 计时从那时起算。动 `CardBattleScene.ts:311-312 / :351-458`，**不动 `tutorial.ts` 坐标也能修**。
- 备选：把 4/6 文案并进横幅、取消该步独立气泡。
- 「点了好几次才关掉」：气泡本身是点任意处推进（`tutorialBubble.ts`），点不中更可能源于点击坐标偏移（见 §7.3），而非气泡逻辑；本子项不改气泡推进逻辑。

**验收**：第 1 夜开场截图——横幅全文可见、气泡不遮；点掉气泡后横幅仍在（2400ms 内）；Boss 3 行横幅截图（底边与手牌顶 1px 间隙，须确认无视觉粘连）。

### 6.2 新词首次解释

**问题**：开局完全没交代「当铺等级」「口碑」「赎当券」「人情」这些资源到底干什么用；第 7 天「封门打断阈值」「R2累伤打断返+1情」「执念」扎堆出现，没有任何解释。

**首次出现点（C 路核查）**：

| 词 | 首次出现（主流程） | 更早可见 | 现有解释 |
|---|---|---|---|
| 人情 | `CardBattleScene.ts:607` HUD `人情${renqing}/${maxRenqing}`（第 1 夜开场即见；上限已显示，`maxRenqing` 随铺面等级，上限 6） | —（白天 HUD 无此词；`PawnshopScene.ts:1337` 第 7 天父亲台词"我欠你人情"是剧情用法） | 5/6 气泡 `tutorial.ts:162-165`："顶上'人情'就是出牌本钱，每回合回满，用完点'结束回合'" |
| 执念 | 第 7 天封门预告 `PawnshopScene.ts:683`（`formatBossPreviewHpLine` → `bossComposition.ts:199-205` "第7夜，债主带着X件旧物的执念上门"）及 `:715` "当前无旧物执念加成" | 台历 `CalendarMapScene.ts:392` "执念:" 标签，Boss 预览带 y=176..238，"从第 1 天起可见" | 无；战斗内见 `CardBattleScene.ts:799-800` Boss 徽章 `执念(n块):… 阈14` |
| 封门阈值 | 第 7 天封门预告 `PawnshopScene.ts:696` "封门打断阈值:10/14(R2累伤打断返+1情)" | 台历第 7 天格 `CalendarMapScene.ts:468` "4回战:R2封门4盾,累伤14打断返+1情"；战斗内首次是蓄力反馈 `CardBattleScene.ts:1242` "蓄力「封门」获4盾！累伤14打断"（R2） | 无；"阈值"二字只以"阈14"缩写出现于预告/徽章 |
| 口碑 | 白天 HUD `PawnshopScene.ts:437` "口碑:"（x=104, y=17，顶栏 y 0..34，第 1 天开局即见） | 2/6 气泡 `tutorial.ts` offer_tiers："高价涨口碑" | 仅提示条 `PawnshopScene.ts:1671` `formatReputationHint`（接受率修正文字）；无独立解释 |

**解释入口：没有**。全仓 grep 图鉴 / glossary / tooltip / 悬停 / 说明弹窗零命中；HUD 文本无 pointer 事件。可复用的现成机制：(1) [故] 详情面板（`CardBattleScene.ts` `renderCardDetailPanel`，Boss 徽章行 y=144）；(2) 教程气泡；(3) 台历日格详情行（`CalendarMapScene.ts:468` 一带）；(4) 掌柜横幅 / toast（`PawnshopScene.ts`）；(5) 结算 aftermath 行（`ResultScene.ts`）。

**要求**：人情 / 执念 / 封门阈值 / 口碑四个词，第一次出现时各给一句白话解释。机制三选一，见 §12 Q5（推荐首次出现横幅/toast，复用现有 toast/banner；文案由实现方拟、PR 描述列出审定）。**不得加常驻 HUD 元素**（制作人 2026-11-25 已定约束，640×360 落地前继续适用）。**文案红线**：不得用字库外字符（见 §7.4；特别注意"横"字不在字库里，"横屏"二字不得写进 BitmapText 文案）。

**验收**：台历第 7 天格、封门预告屏、Boss 战徽章行各一张截图，四个词的解释至少覆盖其中三处首次出现点；新词解释出现时不遮挡按钮与关键数字。

**注**：口碑提示条与 1/6 气泡的关系——提示条 `PawnshopScene.ts:1655-1671`，矩形中心 (320,286) 560×24 → y 274..298；1/6 气泡 y 161..271 → **间隙 3px，不重叠**，画布轮已修过（注释"彻底移出 1/6 气泡区域"属实；但 3px 在 1x 下视觉上几乎贴着）。本子项不改此处。

### 6.3 失败页方向提示

**问题**：输了只告诉玩家「4 回合未分胜负」，没告诉该往哪个方向改进，连该攒什么牌都不知道。

**现状（A 路核查）**：

- 分支判定（引擎侧）：`lose_hp` 在 `battle.ts:584-585`（心魔行动后 `playerHp <= 0`）；`lose_timeout` 在 `battle.ts:603-607`（回合结束时 `round >= maxRounds`）。类型定义 `effects.ts:99`。
- 文案（`ResultScene.ts:156-159`）：`lose_hp` →「被打倒」；`lose_timeout` →「`${maxRounds} 回合未分胜负`」（即「4 回合未分胜负」）。若 `data.result` 缺失，默认按 `lose_timeout` 处理（`ResultScene.ts:123`）。
- 章节失败页：`renderChapterFailed`（`ResultScene.ts:479-521`），仅当 Boss 战失败时进（`ResultScene.ts:190-194` `resultView='chapter_failed'`）；当前内容只有标题「章节失败 · 第1章未通关」、大心魔名、失败原因行、「钱与牌组未扣除，可回标题重开第1章」、一个「回到标题」按钮。**没有任何按失败原因的方向提示**。普通心魔失败页（`renderNormalResult`，`ResultScene.ts:523` 起）同样只显示失败原因，无提示——**本子项只修章节失败页**，普通失败页不在范围。
- 入口数据已齐：`ResultSceneData`（`ResultScene.ts:72-84`）含 `result/round/maxRounds/playerHp`，`CardBattleScene.ts:1399,1405,1412` 起已传入，无需改战斗场景。

**修法**：只动 `ResultScene.ts` 一处文件，两处改动：(1) 调用点 `ResultScene.ts:247` 目前只传 `(demonName, loseReason)`——`loseReason` 是已格式化的字符串（「被打倒」/「4 回合未分胜负」），按字符串分支脆弱，应改为把 `result`（`'lose_hp' | 'lose_timeout'`，`create()` 内已有，`ResultScene.ts:122`）或 `round/maxRounds/playerHp` 一并传入 `renderChapterFailed`；(2) 在 `renderChapterFailed`（`:479-521`）内按分支加提示行。文案目前全部内联在函数体内，无独立文案表/配置文件，新增提示文案直接写在该函数内即可（标题按钮坐标在 `layout.ts` 的 `CHAPTER_FAIL_TITLE_BUTTON`，加行须注意纵向排布，现有失败原因行在 y=156、说明行在 y=212）。

**文案**：候选草稿见 §12 Q8，由负责人审定。硬性要求：提示文案中的数字须用**合成后数值**（本局 R3 实际 14 点不是 11，R2 实际 1 点，打断成功时 R3 改写为 3，见 §1.3）；不得用字库外字符。

**验收**：两种失败原因的失败页截图各一张（回合耗尽 / 血量归零），提示行完整可见、不遮挡按钮。

## 7. 子项 6：文字、版本、点击、字库、竖屏与文档

### 7.1 小字对比度（修正后范围：只修一处，其余不动）

**问题**：小字号的说明，比如底部的结果行、深色底上的蓝灰字，读起来费劲。

**核查结论（C 路核查，纠正任务前提）**：**银蓝字在深色底上对比度是够的，不用调亮**。实测 WCAG 比值（`PALETTE` 在 `pawnshop.ts:196-215`）：

| 文字＼底色 | 夜黑 `#10182B` | 深蓝 `#1B2A4A` | 夜蓝 `#2E4A73` | 深木 `#2E2118` |
|---|---|---|---|---|
| 银蓝 `#8FA8C8` | **7.24 ✓** | **5.83 ✓** | 3.67 ✗ | 6.39 ✓ |
| 雾蓝 `#4E739E` | 3.60 ✗ | 2.89 ✗ | 1.82 ✗ | 3.17 ✗ |
| 蜡烛 `#F2E3C6` | 13.96 ✓ | 11.23 ✓ | 7.08 ✓ | 12.31 ✓ |
| 纸白 `#FBF6E9` | 16.39 ✓ | 13.18 ✓ | 8.31 ✓ | 14.45 ✓ |
| 灯黄 `#E8B34B` | 9.25 ✓ | 7.44 ✓ | 4.69 ✓ | 8.15 ✓ |
| 旧纸 `#D9A066` | 7.72 ✓ | 6.21 ✓ | 3.91 ✗ | 6.81 ✓ |
| 黄铜 `#C9973F` | 6.72 ✓ | 5.41 ✓ | 3.41 ✗ | 5.93 ✓ |
| 玉绿 `#4E7A5A` / 朱红 `#B03A2E` | 3.58 / 2.94 ✗ | 2.88 / 2.36 ✗ | — | — |

- 数字与代码内已有审计注释完全吻合：`CardBattleScene.ts:698-700` "对比度审计：夜黑底意图字用银蓝(7.24:1)替雾蓝(3.60:1)"——意图行已修过。
- "底部结果行"逐一核实，银蓝处**全部过线**：结算 aftermath 行（`ResultScene.ts` 约 :605-612，y=162，银蓝/深蓝 5.83）、章节失败行（`:212`，银蓝/夜黑 7.24）、战斗反馈行（`CardBattleScene.ts:545,582`，银蓝/深蓝 5.83）、HUD 抽/弃（`:619`，银蓝/夜黑 7.24）、恶魔徽章行（`:806,819`，银蓝/夜黑 7.24）。
- **真正低于 4.5 的是雾蓝**：现存唯一雾蓝正文是**禁用态结束回合字**（`CardBattleScene.ts:582`，`setTint(mistBlue)`，夜黑底 3.60 / 深蓝底 2.89）。另玉绿（打断返还飘字 `:1249`）与朱红（伤害飘字）夜黑底 3.58 / 2.94，但飘字是大字动态提示，可放宽到 3:1 或加描边/暗底，**不宜直接换色（颜色即含义）**。

**修法**：

1. 禁用态结束回合字改蜡烛 `#F2E3C6`（13.96 / 11.23），**只动 `CardBattleScene.ts:582` 一处**。
2. 全仓 grep 雾蓝正文：除上述一处外如还有低于 4.5:1 的正文，逐处改到板内高对比色（蜡烛/纸白/灯黄/旧纸/黄铜优先）；**银蓝各处不动**。
3. 飘字（玉绿/朱红）如验收截图中仍难读，加描边或暗底，不得换色。
4. 目标值：正文 ≥4.5:1，大字/动态提示 ≥3:1（WCAG）。

**验收**：禁用态结束回合按钮特写 + 胜/负结算屏各一张截图；grep 雾蓝正文清零（飘字除外，按第 3 条处理）。

### 7.2 标题版本号（新增，不是"加回"）

**前提纠正**（见 §0）：仓库里从来没有过 v0.4.1-P11。制作人可能记混了别处看到的版本号（如 `docs/PROGRESS.md` 里的 P11 标记或口头约定）。所以本子项是**新增**一行版本号，不是恢复被删的代码。

**修法**：只动 `TitleScene.ts` **一处**（`create()` 末尾加一行 `addPixelText`；建议位置 (320,338)、`size: 12`、银蓝字——按钮区底边 331、卡片底边 344，y=338 的 12px 字刚好塞进；注意 `TitleScene.ts` 现无 `size: 12` 用法，全屏最小字是 24）。版本号口径见 §12 Q7（建议 v0.4.2-PlaytestFix）；`package.json` 的 `0.1.0` 是否同步是**第二处（可选，建议一致）**，避免第二事实来源。

**验收**：标题屏全屏截图，版本号在底部可见；版本号与 §12 定稿一致。

### 7.3 点击坐标核查（先验证，不直接改换算代码）

**问题**：制作人报：在他的电脑上，点击坐标要按 1920/1024 放大才点得中。这可能是他那边窗口缩放造成的，建议在不同分辨率和窗口比例下自己点一下确认。

**换算链（C 路核查）**：游戏内**无任何手动换算**，全靠 Phaser Scale Manager：`scale.mode = Phaser.Scale.NONE`（`main.ts:31-33`），画布属性尺寸 640×360，CSS 尺寸由 `applyIntegerCanvasScale()`（`main.ts:54-70`）按 `calculateScaledDimensions`（`scale.ts:17-46`，`floor(min(宽/640, 高/360))`，最小 1）整数缩放；输入映射是 `transformX/Y = (page - canvasBounds) × displayScale`（`node_modules/phaser/src/scale/ScaleManager.js:1270-1288`），`displayScale = baseSize / canvasBounds`，由 `refresh()`（`:967-976`，`updateBounds()` 即 `getBoundingClientRect`）更新。刷新点：`main.ts:67`（READY + resize + orientationchange，**现版才有** `game.scale?.refresh()`）+ 各场景 `syncInputBounds`（create 立即 + 1 次 rAF + window resize 监听，Title / Pawnshop / CardBattle / Result / Calendar 五处一致，`CardBattleScene.ts:1415-1432`）。

**结论**：旧版 P11 的 `main.ts` 确实没有 `refresh()`（`git show f84a983:src/main.ts` 全文核实），但**这不等于点击必错**——旧版各场景同样有 `syncInputBounds`（`f84a983` 的 `CardBattleScene.ts:1396`、`PawnshopScene.ts:2155` 等，create + rAF + resize 监听），启动与改尺寸两条路径都会把 bounds 纠回来；在现有代码里**找不到一条必然复现 1920/1024 偏移的路径**。最可能的解释（按可能性排序）：(1) 制作人当时玩的 live 构建是旧缓存/旧部署（画布部署 11-25 晚三次失败、11-26 07:1x 才成功；截图 07 拍于 11-25 22:16，当时线上仍是 P11 旧构建）；(2) 浏览器缩放 / Windows 显示缩放叠加；(3) 系统缩放/DPR 变化不触发 resize；(4) 竖屏下 `main.ts:67` 跳过 refresh（此时画布 0×0，`refresh()` 会算出 `displayScale=Infinity`，横屏后由两条路径纠回，属残留边缘）。

**为什么 E2E 全过不能作证**：(1) 只测 4 个视口（390×844、844×390、800×500、1280×720），**没有 1920×1024**；(2) 1280×720 是**零 letterbox**（2x 画布正好填满视口），测不到 letterbox 偏移类错误；(3) Playwright `deviceScaleFactor=1`、无浏览器缩放、无真实系统缩放；(4) `clickLogical`（`tests/e2e/helpers.ts:44-51`）用 live `boundingBox` 按比例算屏坐标——它验证的是"屏坐标→逻辑坐标"往返，但只在它测过的尺寸/DPR 下成立，且它与 Phaser 共享同一份 bounds 假设。另：`helpers.ts` 顶部的注释已说明一次真实的输入竞态（`InputPlugin._pendingInsertion` 需等 2 个 rAF，否则点击静默丢失）——快速连点"没反应"与"点偏"是两回事，别混为一谈。

**验证方法（不动游戏代码，除非复现出 bug）**：

1. E2E 加 1920×1024（及 1920×1080、1366×768、1600×900）用例，标题/当铺/战斗/结算各点一个按钮；新 spec 文件 `tests/e2e/scaling.spec.ts`（或扩 `portrait.spec.ts`）。
2. 另加一次**不用 `clickLogical`** 的真实鼠标校验：按 `window.innerWidth/innerHeight` 与整数缩放公式独立算屏坐标再点。
3. 真机复查浏览器缩放 100%/125% × Windows 显示缩放 100%/125%/150%（制作人侧复核，见 §10 第 6 条）。
4. 若复现出 bug，修掉并在 PR 描述里写明根因与复现条件；若复现不出，写清结论（旧构建缓存最可能），**不要直接改换算代码**。

**验收**：1920×1024 下标题/当铺/战斗各一按钮点击通过截图；另附一次不用 `clickLogical` 的独立坐标校验记录。

### 7.4 字库完整性护栏

**现状（C 路核查）**：

- `src/data/pixel-font.json` 共 **774 字形**（`font: Fusion Pixel 12px, version 2026.11.10, size 12, lineHeight 12`）；`横` / `悔` 确实都不在。`横`只出现在代码注释（4 处：`chapters.ts:94`、`TransitionScene.ts:52,87`、`CardBattleScene.ts:324`、`PawnshopScene.ts:565`）与 `index.html:108-109` 的 DOM 竖屏提示（"请横屏游玩"，系统字体渲染，不走 BitmapText）；`悔`在全仓（字库外）**零出现**。结论：今天没有任何 BitmapText 文案会触发 tofu；但"横"是一颗雷——失败页方向提示等若把"横屏"写进 BitmapText 文案，立即 tofu。
- 截图 03 裁字不成立（见 §0 与 §1.1 C5）：几何（截图 03 是第 3 天传闻版，`PawnshopScene.ts:1903-1935`）：槽高 28，色条在槽顶内侧（`y-14+2`，高 2px：行 0 色条 145..147、行 1 色条 179..181），牌名 BitmapText 中心 `y+2`、字高 24（size 24 = 字库 12×2），字块行 0 为 148..172、行 1 为 182..206，**字顶距色条底 1px，无重叠**；第三列右缘 578 < 面板右缘 608，无超框。像素实测：最近邻 4x 放大截图，行 1"余音"两字完整，字顶与色条之间有清晰纸白间隙；全仓六字（旧书飞驰集邮余音）首墨行均为字形 row 1，墨迹起点与字库数据一致。截图里看起来像被切，是 **1px 间隙被 JPEG 压缩糊住 + 12×12 字形顶行笔画密**（缩略图视觉），不是裁剪。`addPixelText` 是 BitmapText，无裁剪逻辑。

**修法**：

- **提取逻辑已有，断言缺失**。`scripts/generate-pixel-font.py` 的 `collect_characters()` 已实现全量提取：扫 `src/data/*.json`（除字库本身）+ `src/**/*.ts` 全部字符串/模板字面量（`TS_TOKEN_RE` 跳注释、递归扫 `${}`、跳 `pixelart.ts`），另有 `BASE_CHARS` 硬编码集。`tests/unit/pixelFont.test.ts` 目前只测 atlas 打包与 builder，不测覆盖。实测：用该脚本的 `collect_characters()` 跑一遍——**收集 774 字 = 字库 774 字形，缺失 0**，字库与当前源码完全同步。
- 落点：在 `tests/unit/pixelFont.test.ts`（或新建 `tests/unit/fontCoverage.test.ts`）加一个用例，把 collect 逻辑移植为 TS（读 `src/data/*.json` + 正则扫 `src/**/*.ts` 字面量），断言每个字符都在 `PIXEL_FONT_DATA.glyphs` 里。**不改字库本身**（不动 `scripts/generate-pixel-font.py`，不动 `src/data/pixel-font.json`）。
- 盲区须写进测试注释：collect 不扫 `index.html`（DOM 文案走系统字体，无 BitmapText 风险）、不扫 `docs/*.md` 与测试文件；动态拼接（如 `'第'+n+'天'`，数字已在 `BASE_CHARS` 的 ASCII 里）无风险；后续若把文案抽进新 JSON/新目录，须同步更新扫描范围，否则断言会漏。
- **新文案红线**：本轮新增的全部 BitmapText 文案（失败页提示、新词解释、HUD 文案、版本号）不得用字库外字符；单测即是 enforcement，写文案前先查字库。

**验收**：单测通过输出 + 结算牌组列表截图（与截图 03 同角度，确认字顶与色条间隙）。

### 7.5 竖屏模式（方案 A：按宽度缩小可玩 — 已实施）

**行为变化（C 路核查，纠正"按钮"说法）**：

- 新版（`index.html:33-48, 96-113`；`main.ts:50-60`）：竖屏时 `#portrait-hint` 为全屏 fixed 遮罩（`inset: 0, z-index: 9999`，`#120e16` 底），文案"请横屏游玩 / 旋转屏幕至横屏后自动继续"；同时 `body.is-portrait #game-container { position: fixed; width: 0; height: 0; overflow: hidden; visibility: hidden; pointer-events: none }` → **画布不可见、不可点、游戏原地暂停**（状态不丢，横屏后自动恢复）。`tests/e2e/portrait.spec.ts` 断言与之完全一致：390×844 下 hint 可见、含"请横屏游玩"、hint 框 ≥390×844、中央点击不改变 phase（仍为 title）、无横向溢出；转 844×390 后 hint 隐藏、canvas 640×360 可玩。
- 旧版（`f84a983:index.html:38-65, 68-71`；`main.ts` 的 `syncPortraitHint` 只切 `hidden`）：`#portrait-hint` 是 in-flow 的 `inline-flex` 小条（`margin-top: 18px`，`pointer-events: none`），文案只有"↻ 横屏体验更佳"，画布完全不受影响；竖屏时画布按整数缩放（旧 320×180：390×844 → scale 1 → 320×180 小窗居中），**全程可玩**。截图 07 佐证：手机竖屏实拍，战斗画面以小窗居中显示（四张手牌、结束回合钮俱全），下方就是那条"横屏体验更佳"提示，地址栏为 `game.zhuchaofan.com`。
- **纠正**：旧提示不是"按钮"——它是 `pointer-events: none` 的纯提示条，无点击行为、无关闭功能。行为变化的准确写法：**"旧版竖屏仅在画布下方显示一行'横屏体验更佳'提示，游戏以小窗继续可玩；新版竖屏改为全屏'请横屏游玩'遮罩并隐藏画布、阻断输入，横屏后自动恢复。"**

**本轮改（制作人 2026-11-26 08:25 定，方案 A：竖屏直接按宽度缩小、能玩）**：移除新版全屏阻塞遮罩，恢复旧版非阻塞模式：

- 删掉 `#portrait-hint` 的全屏 fixed 遮罩（`inset: 0, z-index: 9999, #120e16` 底）与 `body.is-portrait #game-container` 的隐藏规则（0×0、`visibility: hidden`、`pointer-events: none`）；画布在竖屏下保持可见、可点、游戏继续运行（状态不丢）。
- 恢复旧版小提示条：in-flow `inline-flex` 小条、文案「↻ 横屏体验更佳」、`pointer-events: none`、无点击行为、无关闭功能，置于画布下方（仿 `f84a983:index.html:38-65`）。
- 缩放规则：竖屏时按宽度等比缩小——scale = min(可用宽/640, 可用高/360)，**不取整**（390×844 下约 0.61×，画布约 390×219）；横屏保持现行整数缩放（floor，最小 1）不动。破例只限竖屏：制作人已知并接受竖屏像素稍糊。
- 落点：`scale.ts` 的 `calculateScaledDimensions`（现取整）须加竖屏分支，或 `main.ts` 的 `applyIntegerCanvasScale` 内分支；`syncPortraitHint` / `main.ts:67` 的 refresh 路径保留（输入映射仍靠 Phaser ScaleManager 的 bounds，须验证竖屏点击）。
- E2E：`tests/e2e/portrait.spec.ts` 现行断言与新版行为冲突（断言遮罩阻断输入），**必须改写**：390×844 下提示条可见、画布可见且宽 ≤390、无横向溢出、点标题按钮能进游戏；转 844×390 后提示条隐藏、画布 640×360 可玩。

**验收**：390×844 竖屏截图（画布按宽度缩小居中显示、提示条在画布下方、标题/战斗可点）与旧版截图 07 对照；真机确认由制作人在手机上玩时顺手做，不主动催（同 P5 遗留口径）。

### 7.6 文档同步

- `docs/GAME_DESIGN.md` 文末增补一节（本轮），写明：Boss sim 扫参目标与选定参数（§2 扫参表）、快照语义（§3 定稿方案）、赎当留痕语义（§4 语义 A）、手牌/飘字/HUD/教程/新词/失败页改动、版本号口径（§12 Q7 定稿）、竖屏模式（§7.5 定稿：竖屏按宽度缩小可玩）。
- `docs/ART_STYLE.md`：小字对比度条文（如有，按 §7.1 定稿写：正文 ≥4.5:1、大字/动态提示 ≥3:1；银蓝不动、禁用态结束回合字改蜡烛）；版本号展示规范（如有，按 §7.2 定稿写）。
- `docs/ASSET_LEDGER.md`：**无需新增登记项**（无新素材）。
- `docs/PROGRESS.md`：记录本轮合并与部署（按既往格式）。
- `p0-research/13-development-roadmap.md`：更新相关条（修整轮完成；P12 仍待办）。
- 本任务书 `proto-tasks/16-playtest-fix-round.md` 随 PR 入库；状态行更新为已实施（合入后）。

## 8. 明确排除

- **不改 P12 内容扩容**：不新增 `items.json` 之外的数据（现 6 件：`watch`/`ring`/`old_book`/`bicycle`/`erhu`/`stamp_album`），不改 `pickDailyItems` 池子；不加传家宝——代码里仅 `src/game/hooks.ts:71` 一句注释提及未来扩展（`relics / shelf heirlooms`），排除项为"不新增 `items.json` 之外的数据与 `hooks.ts` 注释之外的入口"。不改 D1 冷却 N=2 与 D2 优先未拥有（本轮只动赎当留痕，不动冷却与优先逻辑）。
- **不碰心魔伤害方向重构（B+C 等，另轮）**：不动普通心魔 `actions`（药费 3/3/3、车票 2/2/8、房租 3/4/5、学费 1/2/10）；不动 `battle.ts` 心魔回合逻辑（`incomingDamage`、盾吸收、`hpDamage`）与 `effects.ts` 伤害结算；不动 `balance.json`（`startingHp 30` 等）。Boss 扫参可动的范围以 §2.2 表为准：Boss 各回合伤害值（R1 3 / R3 11 / R4 6）、打断返 +1 人情、打断后 R3 改 3 **不在扫参范围内**。
- **不改存档版本**（v3 不动；拒绝留痕用可选字段，见 §4）。
- **不改音频**（ZzFX、Lookahead、BGM 均不动）。
- **不碰 `.github/workflows/`**（无 workflow 权限，见 §11）。
- **不加新内容**：不加新旧物、新牌、新心魔、新事件、不改章节结构、不加常驻 HUD 元素（新词解释机制如需常驻元素须 §12 另定——§12 Q5 的三个选项均不含常驻 HUD 元素）。
- **第 5、6 天心魔重复、白天跳过当客机械**：内容量问题，归 P12，不进本轮。
- **「平价钱没变」**：无法复现，不修；待制作人确认点的哪个按钮（见 §4 末），确认后如属实另行处理。
- **牌组列表裁字**：不成立，不改结算屏布局；只加字库护栏与截图回归（§7.4）。
- **小字对比度**：银蓝各处不动（已过线），只修禁用态结束回合字（§7.1）。
- **标题版本号**：只加标题屏一行；`package.json` 同步与否见 §12 Q7。

## 9. sim 与护栏（数字服从护栏，不得为过护栏改护栏）

- `sim:check` = `node scripts/sim.mjs --check`（`package.json:13`），护栏在 `montecarlo.ts:1786-1900` 的 `checkSimGuardrails`，本轮基线实测 **PASSED（约 8.8 秒）**。
- **冻结（扫 Boss 参数时只随随机种子浮动，超 ±3% 即停查）**：普通心魔 A–D 胜率 [40%, 95%]（`montecarlo.ts:83-84, 1788-1796`）；7 天常赢玩家中位现金流 ≥30（`:85, 1799-1803`，经济模拟不含 Boss）；新玩家首夜胜率 [20%, 45%] 与单攻击牌 [5%, 25%]（`:103-106, 1819-1836`）。
- **联动（随 Boss 参数动，守护栏区间而非 ±3%）**：单场 Boss 测试胜率 [45%, 85%]（`:86-87, 1805-1811）——但只对改 `actions`/顶层 hp 敏感，改合成字段（baseHp、hpBonus、碎片盾、邮票册增量）**不**动它；第 1 章通关率 [35%, 75%]（`:88, 1813-1817`）；合成 Boss 典型档 n=2..5 [40%, 85%]（`:91-92, 1845-1857`）、素体 n=0 [50%, 90%]（`:93-94`）、满配+赊账 ≥25%（`:95, 1863-1867`）、单调性容差 3%（`:96, 1870-1878`）、赎当削弱容差 3%（`:97, 1880-1888`）、邮票册打断率 ≥10%（`:98, 1890-1894`）。
- **注意**：第 1 章通关率 = Boss 胜率（§1.2），Boss 变易必然抬升它——**不得用 ±3% 卡通关率**，用 [35%,75%] 区间卡。同样，n=5 档目标 60% 是**有意的改动**，不在 ±3% 规则内；其余数字超 ±3% 即停查。
- **sim 耗时红线**：单次 `sim:check` 约 9 秒；整轮扫参如超过 10 分钟未完成，立即停下来查原因（先看真正干活的 node 子进程 CPU 时间，不得只看 npm/sh 包装进程），不得放任烧 CPU，不得为赶时间跳过 sim。

| 护栏 | 口径 | 现值（2026-11-26 实测） | 扫 Boss 参数时 |
|---|---|---|---|
| 普通心魔 A–D 胜率 | [40%, 95%]，TEST_DECK 各 1000 局 | A 91.3% / B 82.1% / C 55.9% / D 91.3% | 冻结，不动 |
| 7 天常赢玩家中位现金流 | 第 7 天 ≥30 | 57.0 | 冻结（经济模拟不含 Boss） |
| 新玩家首夜胜率 / 单攻击牌 | [20%, 45%] / [5%, 25%] | 28.5% / 8.8% | 冻结 |
| 单场 Boss 测试胜率 | [45%, 85%]，TEST_DECK + 未合成 38 血 Boss，1000 局 | 48.5% | 联动——仅改 `actions`/顶层 hp 时动；改合成字段不动 |
| 第 1 章通关率 | [35%, 75%]，完整 7 天模拟 1000 局 | 46.2% | 联动（= Boss 胜率），守区间不守 ±3% |
| 合成 Boss 典型档 n=2..5 | [40%, 85%]，**目标口径：n=5 档 ≥60%**，每档 2 子集 ×1000 局 | n=2: 60.1% / n=3: 56.0% / n=4: 51.6% / n=5: 41.4% | 联动，扫参主指标 |
| 合成 Boss 素体 n=0 | [50%, 90%] | 68.8% | 联动，守 90% 上限 |
| 满配+赊账（48 血） | ≥25% | 27.7% | 联动，下限 |
| 单调性 / 赎当削弱 | 高档胜率不得比低档高 >3% / 赎当后胜率跌幅 ≤3% | 通过 | 联动 |
| 邮票册打断率 | 满配含邮票册 ≥10% | 25.3% | 联动 |

## 10. 验收标准

1. `npx tsc --noEmit` 0 错误；`npm run build` 退出码 0。
2. `npx vitest run` 全过（含新增的字库覆盖断言 §7.4；以及因本轮改动更新的单测）。
3. `npm run test:e2e` 全过（现有 42 例 + 新增的 `scaling.spec.ts` §7.3；`portrait` 与 `subpath` 原样跑过）。
4. `npm run sim:check` PASSED；扫参表已交付（§2.1）；n=5 档 ≥60%；§9 全部护栏成立（冻结项在 P11 基线 ±3% 内，联动项在区间内）。
5. **逐屏截图目视核实**（本地 localhost 截图 + 部署后 live 截图两轮）：标题屏（版本号可见）、第 7 天预告（快照一致）、父亲事件后 Boss 变弱提示（修法 B）或战斗直接用快照（修法 A）、赎当拒绝后重进不再弹、战斗连拍（出牌瞬间、队列排空后、回合结束时，最右列手牌与结束回合钮）、Boss R2 打断瞬间（`-N` 与"打断封门!"同框不重叠）、连续出牌两张飘字、HUD「牌库 N」、人情+1 飘字与 HUD"人情"同框、盾吸收拆分（全挡与部分吸收各一张）、第 1 夜开场（横幅全文可见、气泡不遮）、台历第 7 天格、封门预告屏、失败页（回合耗尽 / 血量归零各一张）、禁用态结束回合按钮特写、结算牌组列表（与截图 03 同角度）、390×844 竖屏（按宽度缩小可玩）。每张无溢出、无遮挡、无截断、无缺字；文字对比度符合 WCAG 4.5:1（正文）/ 3:1（大字/动态提示）。
6. **多尺寸验收**：390×844 竖屏（按宽度缩小可玩、提示条可见）、844×390 横屏、800×500 窄窗口、**1920×1024（新增，§7.3）**逐一截图与点击验证，不得出现横向溢出、横向滚动条、画布被裁、点击点空；真机复查浏览器缩放 100%/125% × Windows 显示缩放 100%/125%/150% 由制作人侧做（如复现出 bug，另行处理）。
7. **GDD/ART_STYLE/PROGRESS/路线图**同步更新完成（§7.6 清单逐项打勾）；PR 描述列出全部新增文案（失败页提示、新词解释、HUD 文案、版本号）供审定。
8. 合并后部署成功、live 页截图验过（合并≠部署，见 §11）。

## 11. 实施约束（既往铁律，照搬）

- 分支：`feature/playtest-fix-round`，从 `main` @ `fd7860a` 切出。**注意**：本地工作区当前 checkout 在 `feature/canvas-640x360 @ 349b759`（画布轮残留），切分支前须先 `git checkout main && git pull` 确认 main 在 `fd7860a`；本任务书文件目前是工作区未跟踪文件，切分支后确认它仍在（未跟踪文件不受 checkout 影响），随 PR 入库。**一次提交、一次推送、一次建 PR**；不要逐文件提交、不要半成品上 CI。
- **本地构建 + 单测 + E2E 全绿之前不推**。
- AGY 调用一律加 `--model gemini-pro-orchestrator-neon`；AGY 用全路径 `~/.local/bin/agy`（exec 是非登录 shell，`agy` 不在默认 PATH 里）；print 模式加 `--dangerously-skip-permissions`。AGY 提示词放持久位置（`~/workspace/game-studio/playtest-fix-agy-prompt.txt`，首次调用 AGY 前建好），**不要放 /tmp**（VM 替换会清空）。
- 验收用临时 E2E spec（`tests/e2e/zz-*.spec.ts`）用完即删，仓库保持干净。
- **合并口径（制作人 2026-11-25 22:05 定）**：试玩验收没问题后直接合并，不再逐轮等制作人确认——本轮由协调员在负责人独立验收通过后直接合并（`gh pr merge`），合完部署工作流自动跑，部署成功后截图验 live 页。**实现方不得自行合并**。
- gh 已授权（账号 `zhuuchaofan`，token scopes `gist`、`read:org`、`repo`，**无 workflow 权限**，推 `.github/workflows/` 会 403；workflow 只能经浏览器网页改，或 `gh auth refresh` 加权限——本轮不碰 workflow）。
- 部署用拆 build+deploy 双 job + 有界轮询的现行结构；合完必须截图验 live 页，不能只看 HTTP 200 或标题。
- 美术红线：像素画必须是真 8-bit 像素风；外部素材必须登记 `docs/ASSET_LEDGER.md`；AI 生图不作正式像素素材来源；GPLv3/AGPLv3/无 LICENSE 的参考项目只能借鉴抽象设计，禁止抄代码/配置/文案/美术（调研 14 §17）。
- **同一任务连续失败三次后，停止自动重试，分析原因并向负责人报告**；未获授权不启动无限循环式的自主开发。

## 12. 待负责人拍板

以下取舍须负责人定，实施轮次不得自己悄悄定。括号内为起草协调员建议，供参考。

### 12.0 拍板记录

- **Boss 改法：C**（制作人 2026-11-26 07:31 定）——让 AGY 用 sim 扫参数，目标典型牌组胜率 60%+；不直接写死 6 回合或 32 血。见 §2。
- **赎当留痕语义：A"某天拒绝某件"**（B 路核查推荐，任务书 §4 已定，不须再议）——只屏蔽当天该件；第二天同一件可再弹。

**负责人 2026-11-26 审定（Q1–Q8 全定，照起草建议）：**

- **Q1 = A**：出牌后保持原位、回合结束再整理；动画期间结束回合按钮**禁用**（置灰且不接受点击），不排队、不二次确认。
- **Q2 = B**：赎当后重算并提示（「Boss 已变弱 44→42」/「Boss 已变强 42→44」），覆盖 §3 表中 4 条路径；`CardBattleScene.ts` 与 `save.ts` 不动。
- **Q3 = (i)**：直接改 `demons.json` + 重跑 `sim:check`；`bossCh1Hp` 对合成 Boss 无效，**禁用**。
- **Q4 = 延迟出现**：气泡推进到 null 后再 `showDemonIntroBanner`，2400ms 计时从那时起算；不动 `tutorial.ts` 坐标。
- **Q5 = A**：首次出现横幅/toast；文案由实现方拟、PR 描述列出审定；不得加常驻 HUD 元素。
- **Q6 = A**：「牌库 6 弃 0」，只改 `CardBattleScene.ts:619` 一行。
- **Q7 = v0.4.2-PlaytestFix**；`package.json` 的 `0.1.0` 同步改为 `0.4.2`。
- **Q8**：回合耗尽用制作人原话「试试多攒伤害牌来打断封门」；血量归零用「先攒护盾牌，顶住前两回合」。数字须用合成后数值（R3 实际 14 点、R2 实际 1 点、打断后 R3 改 3），不得用字库外字符。
- **护栏口径确认**：第 1 章通关率 = Boss 胜率，**不得用 ±3% 卡通关率**，用 [35%,75%] 区间卡（§9 口径正确；负责人此前“其余护栏沿用 ±3%”的说法在此处不适用，特此确认）。n=5 档目标 60% 本身不在 ±3% 规则内。
- **竖屏模式：A 直接按宽度缩小、能玩**（制作人 2026-11-26 08:25 定）——移除全屏阻塞遮罩，恢复旧版「↻ 横屏体验更佳」小提示条；竖屏 scale = min(可用宽/640, 可用高/360) 不取整（约 0.61×），横屏保持整数缩放；像素稍糊已获制作人接受。见 §7.5。

**Q1 手牌移位修法：A 还是 B**

- **A. 出牌后保持原位、回合结束再整理**（推荐）：确定性高、无动画时序边角；`refreshHandSlotsInPlace` 现状已 x 稳定，可直接复用。
- B. 加位移动画：观感好、手牌始终居中，但须处理飞行中点牌（`playQueue`）与 `pendingChoice` 打断，边角多。
- 无论 A/B，动画期间点结束回合不得再被排队后立刻结算：改为动画期间禁用，或二次确认（同属本问，一并定）。

**Q2 Boss 快照修法：A 还是 B**

- A. 快照带进战斗：预告时冻结组合带进战斗；可验性强，但第 7 天成交加牌不再影响 Boss，与预告屏"今日白天收当/赎当仍可改变今夜 Boss 构成"文案冲突；且须改 `bossComponentItemIds` 字段语义（开战快照→预告快照）与 `buildEndingLedger` 输入来源。
- **B. 赎当后重算并提示**（推荐）：保留"白天行动改变 Boss"的设计，预告是承诺、战斗是终局，改完把新数字亮出来（「Boss 已变弱 44→42」/「Boss 已变强 42→44」）；`CardBattleScene.ts` 与 `save.ts` 不动。代价：须覆盖 §3 表中 4 条路径（父亲接受、随机赎当接受、父亲后补抽接受、白天成交加牌），只修赎当路径不够。
- 注意：两种修法回归断言相反（§3 末），以定稿为准。

**Q3 扫参方式：(i) 还是 (ii)**

- **(i) 直接改 `demons.json` + 重跑 `sim:check`**（推荐）：零代码改动、单次约 9 秒，逐格扫完全可行。
- (ii) 新增 `SIM_TUNE` 键 + 在 `runBalanceSimulation`（`montecarlo.ts:1657`）里透传进 `baseBoss`：须改 `montecarlo.ts`，留作扫参规模过大时的备选。
- 另：`bossCh1Hp` 对合成 Boss 无效，**禁用**，见 §2.3。

**Q4 横幅修法：延迟出现，还是并文案**

- **延迟出现**（推荐）：`renderTutorialBubble` 推进到 null 后再 `showDemonIntroBanner`，2400ms 计时从那时起算；不动 `tutorial.ts` 坐标。
- 并文案：把 4/6 文案并进横幅、取消该步独立气泡；改动面更大（教程步骤定义）。

**Q5 新词解释机制**

- **A. 首次出现横幅/toast**（推荐）：复用现有 toast/banner 机制，一句白话；无新系统、无常驻元素。
- B. [故] 详情面板扩展：点徽章/词条看解释；须给 HUD 文本加 pointer 事件，现全仓无此机制。
- C. 教程气泡复用：把解释塞进现有气泡步骤；但执念/封门阈值首次出现在第 7 天，教程气泡只在第 1 天，时间对不上。
- 文案由实现方拟、PR 描述列出审定；不得加常驻 HUD 元素。

**Q6 HUD 文案：A 还是 B**

- **A. 「牌库 6 弃 0」**（推荐）：只改 `CardBattleScene.ts:619` 一行，零风险。
- B. 显示本回合实抽数：须新增场景字段、3 处改动（`handleEndTurn` 取 `CARDS_DRAWN` 的 `cards.length` + `create` 开局记数 + `renderHud` 显示），收益有限。

**Q7 版本号口径**

- 建议 **v0.4.2-PlaytestFix**（与 P11 的口头约定衔接；仓库里从来没有过 v0.4.1-P11，见 §0）。
- `package.json` 的 `0.1.0` 是否同步——建议同步，避免第二事实来源。

**Q8 失败页提示文案（实现方拟稿、负责人审定）**

候选草稿（数字须用合成后数值；不得用字库外字符）：

- 回合耗尽（`lose_timeout`）：「试试多攒伤害牌来打断封门」（制作人原话）；或「封门蓄力时，一回合打满阈值伤害，下一回合只受 3 点」。
- 血量归零（`lose_hp`）：「先攒护盾牌，顶住前两回合」；或「多收能抽牌的旧物，关键牌上手更快」。
- 文案定稿后写进 §6.3 与 GDD 增补。

---

*状态：已实施，待合并。*
