# 任务 10：P7 开源对照落地（Top 5：校验器、音频、事件流、当客性格、Hook 与存档底座）

> 实施任务书。工作区：`~/workspace/game-studio/repo-git/`。基线：`origin/main`（P6，merge commit `04735e4`）。
> 分支：`feature/p7-open-source-takeaways`（基于 `origin/main`，先 `git checkout main && git pull` 再切分支）。
> 只改本文指定的内容；**红线**：现金成本 ¥0；不改核心玩法、技术架构、美术方向；不写凭据进仓库；不碰 `.github/workflows/`；不碰 PR #11（`fix/custom-domain`，CNAME，独立分支，等 DNS）；不合并——合并等制作人确认。
> 输入：`~/workspace/game-studio/p0-research/10-open-source-reference-analysis.md` §4（Top 5 可落地建议）与 §5（协议红线）。制作人 2026-11-25 13:29 定“全排进 P7”。
> **协议红线（实施前必读）**：forty-five（GPLv3）、slaytheweb（AGPLv3）、Adventure-Time_Card_Wars（无 LICENSE）、spire-of-ashes（无 LICENSE + AI 生图）四者**只能借鉴抽象设计，绝对禁止复制任何代码、配置或美术**；唯一可引入的第三方代码是 MIT 的 ZzFX（见子项 2），引入时保留 MIT 声明并登记 `docs/ASSET_LEDGER.md`；其余一律自研。

## 子项 1：数据校验器 + `npm run sim` 平衡护栏（小，约 0.5–1 天）

- 新增 `src/game/validate.ts`，在常规 `npm test` 中运行，断言：
  - `cards.json` 全部 `id`/`name` 唯一，效果参数非负合法；
  - `items.json` 每件旧物的 `cardName` 均存在于 `cards.json`，且 `color` 属于 16 色调色板；
  - `demons.json` 回合动作连续（1/2/3 回合齐全）、血量 > 0。
- 把现有 `src/game/montecarlo.ts` 封装为命令行工具：
  - `npm run sim`：打印 4 心魔胜率、平均结束回合、7 天中位现金流与赎当次数；
  - `npm run sim:check`：胜率与现金流护栏断言——每心魔胜率须在 40%–95% 之间，7 天常赢玩家中位现金流 ≥ 30（当前实测 A 91.3%/B 82.1%/C 55.9%/D 91.3%、现金流 54.9，护栏须在当前数值下通过）；
  - 支持参数热覆盖（如 `SIM_TUNE='{"demonAHp":22}'` 形式的 env 覆写，调数值时可一条命令横向对比实验）。
- 验收：单测覆盖校验器（合法数据通过、故意改坏的数据报错）；`npm run sim` 与 `npm run sim:check` 在当前数值下均通过并打印报告；护栏区间写进 GDD 或 PROGRESS。

## 子项 2：音频升级——Lookahead 调度 + 融合 ZzFX（小–中，约 1 天）

- 保留现有 `AudioEngine` 外壳不变：手势解锁、静音持久化、无音频环境静默降级、`__AUDIO_DEBUG__` E2E 断言钩子全部不动。
- BGM 调度从 `setInterval` 逐拍即时发声改为基于 `ctx.currentTime` 的轻量 Lookahead（提前 100ms 排程），消除切后台或掉帧时的 BGM 节奏抖动。
- 引入 MIT 协议的 **ZzFX** 核心合成函数（<1 KB）：保留 MIT 版权声明，登记到 `docs/ASSET_LEDGER.md`（名称与版本号、官方来源 URL、作者与版权年份、MIT 许可全文副本路径、使用范围：单文件内联算法）；补齐 6 类新音效：`hit_demon`（受击）、`shield_block`（格挡）、`player_hurt`（玩家受伤）、`offer_rejected`（拒收）、`insufficient_funds`（钱不够）、`redeem_deal`（赎当成交），加入白噪声/失真质感。
- 约束：零外部音频文件路线不变；包体增幅 < 2 KB（验收时核对 `dist` 产物大小）。
- 验收：单测覆盖音频状态机与 6 类新音效配方；E2E 或浏览器实测验证新音效可触发、BGM 不抖动；`docs/ASSET_LEDGER.md` 有 ZzFX 登记条目。

## 子项 3：牌局核心升级——结构化事件流 + 可暂停选牌续体（中，约 1.5–2 天）

- `playCard`/`endTurn` 返回 `{ state, events: BattleEvent[] }`，事件至少包括：`CARD_PLAYED`、`DAMAGE_DEALT`、`SHIELD_GAINED`、`REFLECT_TRIGGERED`、`REWIND_APPLIED`、`DEMON_ACT`、`BATTLE_ENDED`。`CardBattleScene.ts`（现 1,151 行）按事件驱动播放飞牌、飘字、受击震屏与音效，不再在场景层反向猜状态变化。
- 在 `BattleState` 中引入轻量可序列化的 `pendingChoice`：卡牌效果可暂停结算、等玩家从手牌选 1 张执行 `discard` 后再续跑后续效果。首先把「当票」从 `effects.ts` 的“强制弃最左一张”升级为“玩家点选要弃的手牌”。
- 验收：单测覆盖事件产出（每种事件至少一例）与 pendingChoice 流程（选牌、续跑、取消/无可选牌时的行为）；E2E 用例——打出当票后点选一张手牌弃掉，验证弃的正是点的那张、人情正确增加；其余 E2E 全过；汇报 `CardBattleScene.ts` 瘦身前后的行数。

## 子项 4：当铺经济深化——当客性格标签 + 同源白话还价反馈 + 经济不变量单测（中，约 1–2 天）

- `src/data/items.json` 为每件旧物增加可选 `temperament`，三种标签（数值以本任务书为准，GDD 同步）：
  - `urgent` 急用钱：低价接受率 +10%，低价成交口碑 −2（原 −1）；
  - `proud` 爱面子：低价接受率 −10%，高价成交口碑 +2（原 +1）；
  - `sentimental` 念旧：平价接受率 +5%，赎当候选优先选念旧者的牌。
  - 分配：旧手表 `urgent`、婚戒 `sentimental`、旧书 `urgent`、永久自行车 `proud`、二胡 `sentimental`、邮票册 `proud`。
  - 当客卡片上用 2–4 字像素徽章明示性格（如“急用钱”“爱面子”“念旧”），让玩家“看人报价”。
- `src/game/pawnshop.ts` 新增纯函数 `formatOfferDialogue(item, tier, accepted, reputation)`，把口碑、报价档位与性格生成带 1987 老街人情味的成交/拒绝台词，替换当前模板化文案。风格示例（AGY 按此口吻补齐其余组合，文案进 PR 由制作人审）：口碑高时“听街坊说你家公道，少点我也认了”；低价被拒“这价连药费零头都不够”。
- `tests/unit/pawnshop.test.ts` 新增经济不变量属性测试：任意口碑与合法档位下，单次高价收当再赎当的收益有界、钱永不为负、不存在无限刷口碑/刷钱闭环。
- 验收：单测覆盖三档性格修正（接受率与口碑变动）与 `formatOfferDialogue` 各档输出；E2E 或浏览器实测验证性格徽章在当客卡片上可见；现有接受率单测按新规则同步更新。

## 子项 5：正式版扩容底座——战斗 Hook 注册表 + 存档版本迁移与坏档隔离（中–大，约 2–3 天）

- 新增 `src/game/hooks.ts`：6–8 个核心战斗钩子（`battleStart`/`cardPlayed`/`turnStart`/`turnEnd`/`onDiscard`/`onReflect`/`battleWon`），递归深度上限 `MAX_HOOK_DEPTH = 32`（超限时熔断并记录，不死循环）。现有战斗流程行为不变，钩子先搭架子、暂不挂载新效果。
- 升级 `src/game/save.ts`：
  - 增加 `MIGRATIONS` 顺序迁移表（为将来 `deck: string[]` 升级为带实例/金牌标记的对象数组、合并 `pawnPrices` 做好兼容；本次至少实现 v1 → v2 的空迁移占位与版本号写入）；
  - 坏档隔离：读档失败时把损坏存档复制到 `pawnshop-cards-save-corrupt-v1` 并提示玩家，而非静默丢档。
- 验收：单测覆盖钩子注册/触发/深度熔断、迁移表（v1 存档可正常读入新版本）、坏档备份（损坏存档被备份且游戏不崩）；现有存档行为不变（v1 照常读入）。

## 附带微优化（随本 PR 顺手带入）

- `vite.config.ts` 增加 `manualChunks`，把 `phaser` 拆出独立缓存 chunk，减少业务迭代后的首屏重载流量。验收：构建产物中 Phaser 独立成 chunk，构建仍为 0 退出码。

## 文档

- `docs/GAME_DESIGN.md`：增补 P7 一节（校验器与 sim 护栏、音频 Lookahead + ZzFX、新事件流与 PendingChoice、三档性格数值、Hook 注册表与存档迁移）；v1.0 定稿核心不动，只增补。
- `docs/ASSET_LEDGER.md`：登记 ZzFX（见子项 2）。
- 更新 `docs/PROGRESS.md` 与 `docs/DECISIONS.md`。

## 验收标准

1. `npm run build` 退出码 0；`npx tsc --noEmit` 0 错误；`npx vitest run` 全过；`npm run test:e2e` 全过（只跑 localhost，不测 live URL）；`npm run sim:check` 通过。
2. 本地构建 + 单测 + E2E 全绿之前一个提交都不推；一次提交、一次推送、一个 PR。
3. 子项 2 的新音效、子项 3 的当票自选弃牌、子项 4 的性格徽章须经浏览器实测截图或游戏状态检查验证，不能只看编译成功。
4. 不合并——合并等制作人确认；合完由负责人（Muse）截图验 live 页。
