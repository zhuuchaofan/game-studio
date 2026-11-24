# M0 试点进度记录（草稿，试点结束后随代码一同进仓库）

> 试点：M0 脚手架 + Hello World + CI + 试玩页部署｜方向：《当铺纸牌》｜开始：2026-11-24 13:09

## 2026-11-24 13:09 — 试点启动
- 制作人选定方向《当铺纸牌》，分辨率 320×180（概念文档第 8 项已定）。
- 协调员已读：04 号文档方案 4 全文（15 项）、09 号文档第 9 节 M0 6 步、GitHub 连接器文档与 snapshot-push 规范。

## 2026-11-24 13:11 — GitHub 状态确认（已验证）
- `/opt/hatch/bin/github status`：`connected`，账号 zhuuchaofan（默认账号）。
- 仓库 `zhuuchaofan/game-studio`：仅 `main` 分支，head `8772ab5b`，README 只有一行 `# game-studio`，分支未受保护。
- shell 里 `gh auth status`：未登录；本机无 `~/.gitconfig`。`git push` 走 shell 此路不通。

## 2026-11-24 13:11 — 推送路径结论（第一项验证）
- **可用路径**：Muse GitHub 连接器（MCP）的 `create_branch` + `push_files`（快照推送）+ `create_pull_request` + `merge_pull_request`。AGY 在 shell 本地写代码，协调员经连接器推送。
- **限制**：快照推送只支持 UTF-8 文本文件（不含删除、二进制、符号链接），单次 ≤ 2000 文件 / 16 MiB；`node_modules/`、`dist/` 必须排除（`.gitignore` 已配）。
- **未采用的路径**：shell `gh auth login` / PAT / 把 token 写进命令——按红线不做，等制作人决定也不需要（连接器路径已够用）。

## 2026-11-24 13:12 — AGY 任务 1（脚手架）已派发
- 任务书：`m0-tasks/01-scaffold.md`；模型：Gemini 4 Neon (Medium)。
- **发现 1**：AGY print 模式默认无工具权限，首次调用 9 秒即失败（`read_file` 权限被自动拒绝，`jetski: no output produced`）。改用 `--dangerously-skip-permissions` 后重新派发，任务进行中。
- 本地工作目录：`~/workspace/game-studio/repo`（已 `git init`，仅含 `.gitignore`，无远程、无提交）。

## 2026-11-24 13:19 — AGY 任务 1 结果（AGY 自报 + 协调员独立验证通过）
- 耗时：约 7 分 40 秒（05:11:22Z–05:18:43Z，含约 5 分钟 Playwright Chromium 下载）；AGY 任务 1 次，失败 1 次、自我修复 1 次（`tsc` 报 `TS2580: Cannot find name 'process'`，缺 `@types/node`，补装后通过；另有 3 次 Playwright 下载 30 秒网络超时，内置重试后完成）。
- AGY 自报：`npm run build` 退出码 0、零错误零警告；Vitest 5/5 通过；`npm run dev` / `preview` 探活 HTTP 200；E2E 1/1 通过。
- **协调员独立复核（未轻信 AGY 报告）**：亲自读了全部源码与配置（`package.json` 锁定 phaser `3.90.0` 精确、TS `~5.9.3`、Vite `8.3.8`；`src/main.ts` 320×180 + `pixelArt: true`；`BootScene` 仅 Hello World 两行字；`ci.yml` 五步齐全）；亲自重跑 `npm run build`（退出码 0，`dist/index.html` 0.70 kB、`index-B9aY_xzb.js` 1,196.71 kB）、`npm run test`（5/5 通过）、`npm run test:e2e`（1/1 通过）；亲自查看冒烟截图 `test-results/smoke-hello-world.png`（金框 + PAWN SHOP CARDS + 当铺纸牌居中，像素锐利无模糊）。
- 备注：`vite.config.ts` 用 `chunkSizeWarningLimit: 1600` 压住了 Phaser 单包体积警告（AGY 已披露，非隐藏错误）；构建产物 1.2 MB 在 M0 性能预算（≤2 MB）内。

## 2026-11-24 13:21 — 分支已创建
- `feature/m0-scaffold` 从 main head `8772ab5b` 创建成功（`create_branch`，经连接器）。

## 2026-11-24 13:22 — 推送：`push_files` 403，改走逐文件推送，14 个文件已上分支
- `push_files` 快照推送失败：`POST /git/trees: 403 Resource not accessible by integration`。原因待查（连接器侧 git 数据库 API 权限不足）。
- 改走 `create_or_update_file`（contents API）逐文件推送：README（含探针替换）、`.gitignore`、`package.json`、`package-lock.json`、`index.html`、`tsconfig.json`、`vite.config.ts`、`vitest.config.ts`、`playwright.config.ts`、`src/main.ts`、`src/scenes/BootScene.ts`、`src/utils/scale.ts`、`tests/unit/scale.test.ts`、`tests/e2e/smoke.spec.ts` 共 14 个文件全部成功（各有 commit SHA，见推送脚本输出）。
- **新阻塞**：`.github/workflows/ci.yml` 推送失败：`PUT /contents/.github/workflows/ci.yml: 403 Resource not accessible by integration`。这是 GitHub 的已知规则：通过 API 创建 workflow 文件需要 workflow 权限/范围，本次安装的 App 未授予该权限。同理 `deploy-pages.yml` 也无法经此路径推送。
- **后果**：CI 工作流与 Pages 部署工作流目前不在仓库里，CI 与部署两项记为“阻塞、未验证”。需要制作人处理（二选一）：① 在 GitHub 上调整 Muse App 安装权限，授予 workflow 相关权限后由我重推；② 制作人在网页上手动创建 `.github/workflows/ci.yml` 与 `deploy-pages.yml` 两个文件（内容与本地 `repo/.github/workflows/` 完全一致）。

## PR #1（已创建，未合并）
- PR：https://github.com/zhuuchaofan/game-studio/pull/1（`feature/m0-scaffold` → `main`），2026-11-24 创建。
- **未合并，原因**：CI 工作流文件不在仓库里，没有 CI 运行，无法验证“CI 变绿”；按红线不合。
- **CI 状态**：阻塞、未验证。`.github/workflows/ci.yml` 推送 403（见上节）。
- **部署状态**：阻塞、未验证。`.github/workflows/deploy-pages.yml` 同样 403；且 GitHub Pages 需在仓库 Settings → Pages 启用（Source 选 GitHub Actions），该设置为网页操作，连接器无法代办。另注意：私有仓库的 Pages 可用性取决于账号套餐，若套餐不支持，部署会继续失败，届时以失败原文为准。

## 文档草稿
- `docs/GAME_DESIGN.md`、`docs/ARCHITECTURE.md`、`docs/ART_STYLE.md`、`docs/PROGRESS.md`（本文件）、`docs/DECISIONS.md` 草稿已随本次推送上 `feature/m0-scaffold` 分支，待制作人评审后定稿。

## 2026-11-24 14:08 — 试玩页手机全黑（制作人反馈，截图为证）
- 现象：https://zhuuchaofan.github.io/game-studio/ 在手机上打开全黑。
- 已查实的原因（不用再诊断）：Vite 默认 `base: '/'`，`dist/index.html` 用绝对路径引用
  `/assets/index-*.js`，在 Pages 项目子路径 `/game-studio/` 下请求 404
  （实测 `/assets/...` 返回 404，`/game-studio/assets/...` 返回 200），JS 没加载，Phaser 没启动，
  只剩近黑色 body 背景。本地 Playwright 测试跑在根路径所以通过，没查出这个问题。
- **教训**：部署验收不能只看标题或 HTTP 200——本次就是只核了标题“当铺纸牌 | PAWN SHOP CARDS”
  与 HTTP 200 就报了“已上线”，实际手机上全黑。以后每次部署验收必须打开 live URL
  实际截图看渲染（桌面 + 手机竖屏视口各一张），确认画面真出来、无失败请求。

## 2026-11-24 14:10–14:20 — 修复 fix/pages-base-path（AGY 实现 + 协调员独立验证）
- 修复：`vite.config.ts` 加 `base: './'`（相对路径，未写死 `/game-studio/`）；
  新增回归测试 `tests/e2e/subpath.spec.ts`（测试内用 Node `http` 自启静态服务器，
  把 `dist` 挂在 `/game-studio/` 下，断言访问后 `#game-container canvas` 可见、
  无失败请求、无 `pageerror`）。`src/`、缩放逻辑、`playwright.config.ts`、`.github/` 均未动。
- **新测试抓 bug 的证据（协调员亲自复现）**：先对旧构建（`base: '/'`）跑新测试，
  失败：`HTTP 404 http://127.0.0.1:38267/assets/index-B9aY_xzb.js` +
  `requestfailed ... (net::ERR_ABORTED)`，`1 failed`（AGY 的失败输出存于
  `/tmp/subpath-old-build-failure.txt`；协调员用 sed 临时改回 `base: '/'` 重建后又复现一次，
  同样 `1 failed`，随后恢复 `base: './'` 并重建）。
- **协调员独立验证（新构建）**：`npm run build` 退出码 0（`dist/index.html` 0.70 kB，
  JS 1,196.71 kB，引用已为 `./assets/index-B9aY_xzb.js`）；`npm run test` 5/5 通过；
  `npm run test:e2e` 2/2 通过（`subpath.spec.ts` + `smoke.spec.ts`）。
- 分支 `fix/pages-base-path` 已从 main（`f8d6d05`）创建；修复文件经连接器逐个推送后开 PR，
  标题写清是修 Pages 子路径黑屏；制作人已授权：CI 绿了直接合并（merge commit），
  合并后等部署跑完再对 live URL 实截桌面 + 手机竖屏两张图验收。
- **后续待决策（本次未动）**：竖屏手机上 320×180 画布整数缩放后只有 scale 1、画面很小；
  是否允许小屏非整数适配或建议横屏，由制作人定。

## 2026-11-24 — GDD 定稿（docs/finalize-gdd）
- 依据 6 条评审意见修订三份核心设计文档（`docs/GAME_DESIGN.md`、`docs/ARCHITECTURE.md`、`docs/ART_STYLE.md`），并将三份文档状态更新为“定稿（原型 v1.0，2026-11-24）”：
  1. **机制卡 1 口碑规则**：改为自洽规则（只在成交时结算：低价成交口碑 −1、平价 +0、高价 +1，任意档位被拒均 +0），补充低价口碑代价与待验证项。
  2. **心魔 B 血量与回合数统一**：心魔 B「车票」血量 30 → 18（A 血量 20 未动）；澄清 B 第 1～2 回合每回合 2 伤、第 3 回合释放 8 伤“远行”（前置意图提示）；全稿统一为 3 回合牌局，补充 3 回合均伤测算与 P2 蒙特卡洛模拟验证说明。
  3. **0 费牌减至 2 张与算盘主题去重**：第 17 号“算盘珠”（0 费）改为“弹珠”（玻璃弹珠，1 费），与第 4 号“算盘”去重；第 7 号替换为“蒲扇”（1 费，护盾 3 + 抽 1）；0 费牌仅剩 14 号拨浪鼓与 20 号当票共 2 张。
  4. **删粮票**：移除牌局内货币概念（第 7 号粮票已替换为蒲扇），三份文档确认 0 处残留。
  5. **手表效果恢复“倒转 1 回合”**：第 1 号“倒转”恢复为将敌我双方生命恢复到上一回合开始时的数值（人情与手牌不回溯），并列为原型平衡测试重点观察项。
  6. **笔误与已落实表述修正**：`docs/ART_STYLE.md` 玉绿用途移除“旧书”、旧书主色改为木棕（2 号）；`docs/ARCHITECTURE.md` 补记 CI 已在 main（PR #1、#2 已合）；`docs/GAME_DESIGN.md` 第 9 节改为 6 项原型验证清单；三份文档状态行统一改为“定稿（原型 v1.0，2026-11-24）”。
- 分支：`docs/finalize-gdd`；PR：https://github.com/zhuuchaofan/game-studio/pull/3，CI 两次运行（push 与 pull_request）`build-and-test` 全部 success；未合并，等制作人确认。

## 2026-11-24 — P1 白天收当（feature/p1-pawnshop）
- **范围**：按 `proto-tasks/02-p1-pawnshop.md` 与定稿 GDD v1.0 实现白天收当闭环：
  - 数据配置：`src/data/balance.json`（P1 占位数值：开局钱 200、口碑 0、生命 30、人情 3/3、三档估价 50%/100%/150%、接受率 30%/80%/100%、成交口碑 -1/+0/+1、被拒 +0）、`src/data/items.json`（旧手表真值 40→倒转 2 费、婚戒真值 60→守诺 1 费、旧书真值 20→旧书 1 费；三档报价全部按真值 × 档位计算）。
  - 纯逻辑层：`src/game/pawnshop.ts`（`quotePrice`、`resolveOffer`、`settle`、`advanceCustomer` 等纯函数，状态不可变）与 `src/utils/rng.ts`（mulberry32 种子随机数，支持 `?seed=`）。
  - 场景与入口：`BootScene` 启动后即转 `TitleScene`（沿用金框卡片标题风格 + “开始”按钮，暂不做“继续”）；`PawnshopScene` 实现白天暖色 16 色程序化像素画、常驻顶部 HUD、3 位当客固定顺序（旧手表→婚戒→旧书）三档估价与成交/拒绝反馈、“白天结束”结算屏与“返回标题”；`src/main.ts` 注册新场景，缩放逻辑未改。
  - 测试与测试钩子：`window.__PAWNSHOP_DEBUG__`（测试专用钩子，非正式功能）；新增单元测试 `tests/unit/pawnshop.test.ts`、`tests/unit/rng.test.ts` 与 E2E 测试 `tests/e2e/pawnshop.spec.ts`（固定种子验证三档接受/拒绝分支数学与结算屏 + 桌面 1280×720 与手机竖屏 390×844 截图）。
- **分支名**：`feature/p1-pawnshop`
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，`dist/index.html` 0.70 kB，JS 1,210.79 kB）；
  - `npm run test` 3/3 文件、20/20 单测全部通过（`scale.test.ts` 5、`rng.test.ts` 7、`pawnshop.test.ts` 8）；
  - `npm run test:e2e` 5/5 全部通过（`pawnshop.spec.ts` 3 + `smoke.spec.ts` 1 + `subpath.spec.ts` 1），无失败请求、无 `pageerror`；
  - E2E 截图已保存在 `test-results/`（桌面标题/收当/结算 + 手机竖屏标题/收当）并人工核查渲染清晰无错位；
  - `grep -nE '40|60|20' src/scenes/*.ts` 0 命中，场景代码无写死游戏数值。
- **PR 状态**：PR：https://github.com/zhuuchaofan/game-studio/pull/4，CI 两次运行（push 与 pull_request）`build-and-test` 全部 success；未合并，等制作人确认。

## 2026-11-24 — P2 夜里牌局核心（feature/p2-card-battle）
- **范围**：按 `proto-tasks/03-p2-card-battle.md` 与定稿 GDD v1.0 实现夜里牌局核心闭环：
  - 数值配置：新增 `src/data/cards.json`（GDD 20 张原型牌全量，字段 `{ id, name, item, cost, effects, story, color }`，覆盖 12 种声明式效果 `type`）与 `src/data/demons.json`（心魔 A「药费」20 血每回 3 伤；心魔 B「车票」18 血 R1–R2 各 2 伤、R3「远行」8 伤）；补充 `src/data/balance.json`（`drawFirst: 5`、`drawPerRound: 2`、`winRewardMoney: 20`，沿用 P1 已有字段）。
  - 纯逻辑层：新增 `src/game/effects.ts`（`EffectRunner` 按 `type` 不可变分发）、`src/game/battle.ts`（显式状态机枚举 `draw → play → demonAct → roundEnd → result`、`createBattle` / `canPlayCard` / `playCard` / `endTurn` / `getIntent` / `resolveWinReward`）、`src/game/montecarlo.ts`（固定 10 张测试牌组 + 贪心策略，支持种子 1～1000 蒙特卡洛模拟）。
  - 场景与入口：新增 `src/scenes/CardBattleScene.ts`（夜里冷色 16 色程序化像素画 + 暖色台灯光晕、HUD 常驻、48×64 手牌、出牌飞行与 1 帧旧纸色残影、击败 8×8 碎裂散开、支持 `?demon=a|b` 与 `?deck=test` 及空牌组提示“没有牌可打”、挂载 `window.__BATTLE_DEBUG__`）与 `src/scenes/ResultScene.ts`（胜负结算、种子随机得新牌、全 20 张已有改加钱 +20、赎当券 ×1 占位、返回标题）；更新 `src/scenes/PawnshopScene.ts`（结算屏“返回标题”旁增“进入夜里牌局”按钮）与 `src/main.ts`（注册两新场景）。
  - 测试：新增单元测试 `tests/unit/effects.test.ts`（13 用例）、`tests/unit/battle.test.ts`（9 用例）、`tests/unit/montecarlo.test.ts`（1 用例，各 1000 局）与 E2E 测试 `tests/e2e/battle.spec.ts`（5 用例，含 A/B 对局、倒转专项、P1→P2→结算→标题全流程及桌面/手机竖屏截图）。
- **分支名**：`feature/p2-card-battle`
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，`dist/index.html` 0.70 kB，JS 1,236.20 kB）；
  - `npm run test` 6/6 文件、44/44 单测全部通过（含 P1 原有 20 用例全绿；44 含铁皮青蛙跨回合集成用例，见补充修复）；
  - `npm run test:e2e` 10/10 全部通过（`battle.spec.ts` 5 + `pawnshop.spec.ts` 3 + `smoke.spec.ts` 1 + `subpath.spec.ts` 1），无失败请求、无 `pageerror`；
  - **蒙特卡洛模拟结论（10 张测试牌组，每种心魔 1000 局，种子 1～1000）**：
    - 心魔 A「药费」（20 血）：3 回合内胜率 **91.3%**（913/1000），平均结束回合 **2.99**，胜局平均剩余生命 **24.05**（被打倒 0 局，3 回合超时 87 局）；
    - 心魔 B「车票」（18 血）：3 回合内胜率 **97.3%**（973/1000），平均结束回合 **2.76**，胜局平均剩余生命 **26.50**（被打倒 0 局，3 回合超时 27 局）；
    - 结论：A、B 均可在 3 回合内击杀；30 开局生命下两心魔 3 回合总伤（9 / 12）不足以击杀玩家，全部败局均来自 3 回合超时，后续调平衡只需改 JSON。
  - E2E 截图已保存在 `test-results/`（桌面牌局 A/B 预警/胜负结算 + 手机竖屏牌局/结算）并人工核查渲染清晰、无重叠、无错位。
- **补充修复（铁皮青蛙 `damage_conditional` 条件分支无法触发）**：
  - 根因：原 `BattleState.demonActedThisRound` 仅在 `endTurn` 心魔行动瞬间为 `true`、进入下一回合即重置为 `false`，而玩家只能在 `play` 阶段出牌，导致该标志出牌时恒为 `false`，铁皮青蛙永远只打 3 伤、成为违背 GDD 验证清单的废牌。
  - 修复：删除 `demonActedThisRound`，改为持久标志 `demonHasActed`（初始 `false`，`endTurn` 心魔行动时置 `true` 且永不重置），同步更新 `src/game/battle.ts`、`src/game/effects.ts`、`src/game/montecarlo.ts`；更新 `tests/unit/effects.test.ts` 对应用例并在 `tests/unit/battle.test.ts` 新增跨回合状态机集成用例（R1 打 3 伤、R2/R3 打 6 伤）；`src/data/cards.json` 与定稿 `docs/GAME_DESIGN.md` 未改动，并在 `docs/DECISIONS.md` 补记语义澄清决策。
  - 复验：`npm run build`（exit 0，`dist/assets/index-BCzWRqKE.js` 1,236.16 kB）、`npm run test`（6/6 文件，44/44 通过）、`npm run test:e2e`（10/10 通过）全部绿灯。
- **PR 状态**：PR：https://github.com/zhuuchaofan/game-studio/pull/5，CI 两次运行（push 与 pull_request）`build-and-test` 全部 success；未合并，等制作人确认。

## 2026-11-24 — P3 人情 + 1 天流程串联 + 像素修正（feature/p3-day-loop）
- **范围**：按 `proto-tasks/04-p3-day-loop.md` 与定稿 GDD v1.0 实现跨天流程串联与真 8-bit 像素修正：
  - **范围 A（1 天流程串联）**：
    - 新增存档模块 `src/game/save.ts`（`SaveData` v1、localStorage 键 `pawnshop-cards-save-v1`、`createNewGame` / `loadSave` / `saveGame` / `clearSave` / `applyDayResult` / `maxRenqingForLevel` / `demonIdForDay`，版本不符或损坏 JSON 安全返回 `null`）。
    - `src/data/balance.json` 仅追加 `renqingBase: 3`、`renqingPerLevel: 1`、`renqingCap: 6` 三字段（不改动任何已有平衡数值）；人情上限按 `min(3 + (shopLevel - 1) * 1, 6)` 随当铺等级提升（1 级 3 点 → 4 级起 6 点封顶），`CardBattleScene` 由场景 `data` 接收 `maxRenqing`（向后兼容 P2 默认值）。
    - 场景串联：`TitleScene` 有存档时在“开始”下方 34px 处显示“继续”（无存档不画），“开始”新开并覆盖存档；`PawnshopScene` 接入 `SaveData`、HUD 右上角增加 `第N天`、每天按 `?seed=` + 天数用纯函数 Fisher-Yates（`shuffleItems`）洗牌当客顺序、多天牌组超过 3 张时分两行紧凑展示、点击“进入夜里牌局”走 6 帧拉灯转场并按天轮换心魔（第 1 天 A「药费」，第 2 天起 B「车票」）；新增 `TransitionScene`（6 条横向色带 12 FPS 自上而下由暖色翻转为冷色，零半透明）；`ResultScene` 结算即自动存档、展示“第 N 天 · 当铺 Lv.x”与“下一天”/“返回标题”双按钮；`src/main.ts` 注册 `TransitionScene`。
  - **范围 B（真 8-bit 像素修正）**：
    - 开源像素字体：从官方 Release（tag `2026.11.10`）下载 Fusion Pixel Font 12px 等宽简中版（`fusion-pixel-12px-monospaced-zh_hans.ttf`）至 `/tmp`，核验 `OFL.txt` 确为 SIL OFL 1.1 后复制至 `docs/fonts/OFL.txt` 并登记台账 `docs/ASSET_LEDGER.md`（含 Ark Pixel / Cubic 11 / Galmuri 上游许可说明）；新增生成脚本 `scripts/generate-pixel-font.py` 生成 1-bit 点阵 `src/data/pixel-font.json`（423 字形，89.6 KB ≤ 200 KB，原始 TTF 不入库）；新增 `src/game/pixelFont.ts`（`loadPixelFont` / `addPixelText` / 纯布局与 Phaser 3.90.0 `BitmapFontData` 转换），在 `BootScene.preload` 预载；全场景全部 `this.add.text` 替换为位图字体（`PAWN SHOP CARDS` 24px 2×，其余 12px），`grep -rn "add.text" src/scenes/` 与 `grep -rn "fontFamily" src/` 均 0 命中。
    - 32×32 真像素插画：新增 `src/data/pixelart.ts`（20 张牌面 + 3 件旧物复用 + 2 个心魔，全部原创逐像素手绘 32×32 点阵，严格 16 色调色板且单图 ≤ 12 色）与 `src/game/pixelart.ts`（`pixelRowsToTexture` + `validatePixelRows`）；替换 `CardBattleScene` 手牌色块与心魔 `drawDemonSilhouette`（函数已删除），替换 `PawnshopScene` 左侧旧物 `drawItemPixelArt`（函数已删除）。
  - **待评审项记录**：P2 蒙特卡洛结论（A 91.3%、B 97.3% 3 回合胜率、零血量归零负、生存压力过小）及铁皮青蛙“本回合”措辞仍待制作人决定，P3 沿用既有数值与 `demonHasActed` 实现未改动。
- **分支名**：`feature/p3-day-loop`
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，`dist/index.html` 0.70 kB，JS 1,357.40 kB ≤ 2 MB 预算）；
  - `npm run test` 9/9 文件、61/61 单测全部通过（新增 `save.test.ts` 9、`pixelart.test.ts` 6、`pixelFont.test.ts` 2；既有 44 用例全绿）；
  - `npm run test:e2e` 13/13 全部通过（新增 `dayloop.spec.ts` 3，覆及第 1 天→6 帧拉灯转场中间帧→夜里胜局→自动存档→第 2 天 HUD/人情 4/心魔 B→刷新后“继续”读档 round-trip→负局牌组不变天数 +1→桌面 1280×720 与手机竖屏 390×844 截图；既有 10 用例全绿，`pawnshop.spec.ts` 按洗牌后种子顺序更新断言），无失败请求、无 `pageerror`；
  - 像素修正前后对比：修正前全场景为浏览器抗锯齿 `monospace` 字体 + `Graphics.fillRect` 色块占位；修正后所有文字均为 Fusion Pixel 12px 1-bit 硬边位图点阵（24px 标题整数 2× 锐利无锯齿），20 张牌面 + 3 件旧物 + 2 个心魔全部替换为 32×32 手绘 16 色真像素插画，桌面与竖屏截图逐张核验清晰无重叠。
- **PR 状态**：PR #6 已建并合并（merge commit f7af78d）。
- **CI 可靠性修复（2026-11-24 追加，本地已改、待 AGY 一并推送）**：`ci.yml` 在 E2E 前加
  `actions/cache@v4` 缓存 `~/.cache/ms-playwright`（key 按 `package-lock.json`
  哈希，Playwright 版本变则失效重下）；`npx playwright install --with-deps chromium`
  保留，缓存命中时跳过约 150MB 下载。原因：P1/P2 每推文件单独触发 CI，有运行
  跑 6 分多钟才绿、偶发失败发邮件。`.github/workflows/` 不能走连接器推送（403），
  由 AGY 直接 push。

## 部署故障记录（2026-11-24）
- Deploy #3、#4、#5、#6 全部失败。
- **#6 第 1 次**：构建成功、artifact 已上传，但部署步取不到 artifact 元数据（报错 `No artifacts named github-pages were found`）。
- **第 2 次 Re-run failed jobs**：重跑又上传了一个同名 artifact，运行里出现 2 个 `github-pages` 成品，`deploy-pages@v4` 要求恰好 1 个，报 `Artifact count is 2` 而失败。
- **结论**：重跑修不好，必须触发一次全新的部署运行；本次提交即为触发全新部署的提交。

## 2026-11-24 — P4 内容扩充（feature/p4-content-expansion）
- **范围**：按 `proto-tasks/05-p4-content-expansion.md` 在不改核心玩法、技术架构、美术方向及 `src/data/balance.json` 的前提下完成内容扩充：
  - **旧物池扩充（3 → 6 种，`src/data/items.json`）**：保留既有 3 件旧物不动，追加 `bicycle`（永久自行车，真值 80，牌「飞驰」2 费，`#4E7A5A` 玉绿）、`erhu`（二胡，真值 50，牌「余音」1 费，`#8A5A33` 铜棕）、`stamp_album`（邮票册，真值 30，牌「集邮」1 费，`#4E739E` 雾蓝）。
  - **新牌扩充（20 → 23 张，`src/data/cards.json`）**：仅复用已有效果类型（`damage` / `renqing` / `draw`），追加 `gallop`（飞驰，2 费，伤害 6）、`echo`（余音，1 费，伤害 3 + 人情 1）、`stamp_collecting`（集邮，1 费，抽牌 1 + 人情 1）。
  - **新心魔与 4 天轮换（2 → 4 种，`src/data/demons.json` + `src/game/save.ts`）**：保留心魔 A/B 不动，追加 `c`（房租，22 血，R1–R3 依次 3/4/5 伤）与 `d`（学费，16 血，R1–R2 依次 1/2 伤、R3 技能「开学」10 伤）；`demonIdForDay` 类型扩展为 `DemonId = 'a' | 'b' | 'c' | 'd'`，按 `(day - 1) % 4` 循环 A→B→C→D；`CardBattleScene` URL 参数 `?demon=` 同步支持 `a|b|c|d`。
  - **每天当客仍为 3 位（`src/game/pawnshop.ts` + `src/scenes/PawnshopScene.ts`）**：洗牌算法 `shuffleItems` 与按天种子 `deriveDaySeed` 不动，6 个旧物洗牌后取前 3 个（`DAILY_CUSTOMER_COUNT = 3`），固定种子可复现。
  - **手绘 32×32 像素插画与字形补齐（`src/data/pixelart.ts` + `src/data/pixel-font.json`）**：为 3 个新旧物与 2 个新心魔各手绘一张 32×32 像素画（严格 16 色调色板、单图 ≤ 12 色、1 像素描边，零 AI 生图），并登记入 `CARD_PIXEL_ART` / `ITEM_PIXEL_ART` / `DEMON_PIXEL_ART`；重跑 `scripts/generate-pixel-font.py`（临时 TTF 放 `/tmp` 用完即删，未入库）补齐 30 个新增汉字（423 → 453 字形，96.5 KB）。
  - **文档更新**：新建 `proto-tasks/05-p4-content-expansion.md`；`docs/GAME_DESIGN.md` 文末增补第 10 节 P4 增补内容（v1.0 定稿核心一字未改）；同步更新本进度记录与 `docs/DECISIONS.md`。
- **分支名**：`feature/p4-content-expansion`（改动留工作区待协调员验收，未提交/未推送/未建 PR）。
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，`dist/index.html` 0.70 kB，JS 1,371.20 kB ≤ 2 MB 预算）；
  - `npx tsc --noEmit` 退出码 0；
  - `npx vitest run` 9/9 文件、63/63 单测全部通过；
  - `npm run test:e2e`（Playwright，localhost）14/14 全部通过（含新增 P4 用例验证新旧物出现与第 3/4/5 天 C→D→A 轮换，以及桌面/竖屏与新插画截图核查），无失败请求、无 `pageerror`；
  - **蒙特卡洛模拟结果（`TEST_DECK` 10 张，贪心策略，每种心魔 1000 局，种子 1～1000，`balance.json` 未改）**：
    - 心魔 A「药费」（20 血）：胜率 **91.3%**（913/1000），平均结束回合 **2.99**，胜局均血 **24.05**（血归零 0，超时 87）；
    - 心魔 B「车票」（18 血）：胜率 **97.3%**（973/1000），平均结束回合 **2.76**，胜局均血 **26.50**（血归零 0，超时 27）；
    - 心魔 C「房租」（22 血）：胜率 **82.1%**（821/1000），平均结束回合 **3.00**，胜局均血 **23.00**（血归零 0，超时 179）；
    - 心魔 D「学费」（16 血）：胜率 **99.3%**（993/1000），平均结束回合 **2.42**，胜局均血 **28.17**（血归零 0，超时 7）。

- **CI 修复（PR #7 首轮 CI 失败后）**：两轮 CI 均因 E2E 阶段等待超时失败（`waitForPawnshopPhase` 默认 5s、`waitForBattleReady` 10s），非数值/逻辑错误——本地构建+单测+E2E 两次全绿，CI 日志中失败均为阶段滞后超时（两轮失败点不同、且有 5 个用例首轮失败重试后通过，属 CI runner 慢的环境抖动）。修复：`playwright.config.ts` 加 `timeout: 90000`（单测默认 30s 不够多日流程用例）与 `expect.timeout: 15000`（覆盖全部 `expect.poll` 等待），不改游戏代码与测试逻辑。
- **CI 修复续（超时加长后仍失败）**：两轮新 CI 仍失败，且失败用例在两次运行间互换（一次 P4 用例、一次全流程用例），均为阶段等待超时、本地全绿——定性为 CI runner 并行负载抖动而非逻辑 bug。追加修复：`playwright.config.ts` 在 CI 时 `workers: 1`（串行跑 E2E，避免并行 Chromium 软渲染抢 CPU 拖垮游戏循环）；本地以 `CI=true` 验证：13 passed + 1 flaky（重试后通过），0 failed。
- **CI 故障调查（2026-11-24，制作人定方向“查 runner 环境”）**：6 次运行全败在 E2E（构建与单测都过）。日志核对：失败全是阶段等待超时（`waitForPawnshopPhase` / `waitForBattleReady`，15s 内阶段未变，如 `Expected: "feedback"` / `Expected: "negotiating" Received: "feedback"`），无数值断言失败；冒烟与 subpath 每次都过；同一提交两次运行结果不同（4 败 vs 11 败）。关键证据：6 次运行日志均写明 worker 数——2 workers 时每轮 1–2 败（只败长流程用例），1 worker（串行提交 8e985fa）后每轮 8–11 败，连 1 秒的收当用例也在 15s 超时；串行假设被证伪。另查：阶段切换本身是点击处理函数内同步完成的（`handleOffer`/`advanceCustomer` 直接改 phase 再渲染，无 tween/定时器依赖），点击靠 Phaser 游戏循环（rAF）处理，故超时即游戏循环在 runner 上间歇性停转；本地 `CI=true` 同配置多次全绿，无法复现，属 runner 环境问题而非游戏逻辑 bug。修复：只回滚串行提交，删 `workers: 1`、恢复 Playwright 默认（runner 4 核 → 2 workers），保留 `timeout: 90000` / `expect.timeout: 15000`。另记：`waitForBattleReady` 的 10s 超时是写死的，不受 `expect.timeout` 覆盖（首轮 dayloop:275 即败于此），如仍红可作后续调整点；串行提交 8e985fa 建议随回滚废弃，不保留。

## 2026-11-24 — 钱不能变负数规则（fix/no-negative-money）
- **范围**：按 `proto-tasks/06-no-negative-money.md` 与制作人 21:12 定的规则实现“钱不能变负数”，不改核心玩法、技术架构、美术方向与 `src/data/balance.json`：
  - **纯逻辑（`src/game/pawnshop.ts`）**：新增 `isTierAffordable(money, price)`（价格 ≤ 钱数）、`canAffordTier(money, trueValue, tier)`（经 `quotePrice` 算价）、`getTierAffordability(money, trueValue)`（三档一次返回）；`settle` 在纯逻辑层兜底——接受成交且报价高于钱数时不成交、不扣钱、不改状态（被拒报价不受影响）。
  - **界面（`src/scenes/PawnshopScene.ts`）**：`renderNegotiating()` 每档报价与当前钱比较，买不起的档位按钮置灰禁用（银蓝底、16 色板内，与可点的烛光底明显区分，无 hover 变色，不设 interactive）；`addActionButton` 增加可选 `disabled` 参数，其他调用点不变；`handleOffer` 开头先判 affordability、买不起直接 return，且在 `resolveOffer` 之前（不消耗 RNG）；调试钩子 `getState()` 增加 `tierAffordability`（仅 negotiating 阶段）。
  - **文档**：新建 `proto-tasks/06-no-negative-money.md`；`docs/GAME_DESIGN.md` 文末增补第 11 节（v1.0 定稿核心一字未改），§11.3 原样记录已知缺口；同步更新本进度记录与 `docs/DECISIONS.md`。
  - **测试改写**：`tests/unit/pawnshop.test.ts` 新增 affordability 单测 6 用例（边界、逐档、`settle` 兜底、刚好够买到 0、被拒不受影响）；新增 `tests/e2e/affordability.spec.ts`（localStorage 预置第 1 天 25 元存档，seed=7 首位二胡低 25 / 平 50 / 高 75：断言 `tierAffordability` 为 `{low: true, fair: false, high: false}`、点高/平档无反应且不消耗 RNG——随后点低价档按首抽 0.0117 接受、钱 25 → 0；钱为 0 时三档全 false、点低价档同样无反应）；`tests/e2e/dayloop.spec.ts` 主流程与竖屏用例由 seed=4 改 seed=2（第 1 天高价 150 → 钱 50，胜局存档 70，第 2 天低价后 55、口碑 2、牌组 5 张），P4 第 3/4/5 天改走低价路线（钱 180 / 155 / 145），seed=7 负局用例保持原样；`tests/e2e/battle.spec.ts` 另有 3 处经第 1 天高价进夜里的用例撞同一死角（seed=4 高价 270、seed=1 高价 285），改走低价进夜里（新增 `navigateThroughDayToBattleLow`，夜里均用 `?deck=test`），seed=2 与 seed=7（真实白天牌组）用例保持原样；全流程原 -70 / -50 负数断言全部改为非负断言与新流程具体值。
  - **已知缺口（死角，原样记录，需制作人定）**：某位当客三档报价全部高于当前钱数时，该当客无任何可点档位、且无“跳过当客 / 不成交”按钮，流程会卡住。实测：seed=4 第 1 天高价收下手表 60 + 自行车 120 后剩 20，第 3 位婚戒三档 30 / 60 / 90 全不可点；seed=4 第 3 天高价收下二胡 75 + 婚戒 90 后剩 35，第 4 天第 2 位自行车低价 40 起三档全不可点。本次测试改道绕开，未自行加跳过按钮。
- **分支名**：`fix/no-negative-money`
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，JS 1,371.94 kB）；
  - `npx tsc --noEmit` 退出码 0；
  - `npx vitest run` 9/9 文件、69/69 单测全部通过（新增 6 用例）；
  - `npm run test:e2e`（Playwright，localhost）15/15 全部通过（`affordability.spec.ts` 1 + `battle.spec.ts` 5 + `dayloop.spec.ts` 4 + `pawnshop.spec.ts` 3 + `smoke.spec.ts` 1 + `subpath.spec.ts` 1），无失败请求、无 `pageerror`。
- **PR 状态**：PR #8 已合并（merge commit `badfd0b`）。

## 2026-11-24 — 跳过当客根治三档全买不起死角（fix/skip-customer）
- **根因查实**：
  - 精确触发条件：`quotePrice(trueValue, tier)` 按 `low=0.5 / fair=1.0 / high=1.5` 单调递增，故三档全部不可买 **当且仅当** `money < quotePrice(currentItem.trueValue, 'low')`（只要钱 ≥ 最低档价，至少低价档可点并推进流程）。
  - 界面无别的出口：`PawnshopScene.renderNegotiating()` 原仅绘制三档报价按钮，买不起的档位不设 `interactive` 且无回调；无快捷键、无跳过/退出按钮。
  - `settle` 兜底不介入：界面禁用且 `handleOffer()` 在 `resolveOffer()` 前提前 `return`，不调用 `settle`；即便直接调用 `settle(state, tier, true)`，其 `price > state.money` 兜底也只返回原状态（不推进阶段与 `customerIndex`）。
  - 实测复现（修复前）：`seed=4` 第 1 天（`watch -> bicycle -> ring`）高价收手表 60 + 高价收自行车 120 后剩 20，第 3 位婚戒三档 30/60/90 全不可点（`tierAffordability: {low: false, fair: false, high: false}`），点三档均停在 `phase: "negotiating", customerIndex: 2`。
- **改动**：
  - **纯逻辑（`src/game/pawnshop.ts`）**：新增 `hasAnyAffordableTier(money, trueValue, balance)` 与 `skipCustomer(state)`（仅 `negotiating` 阶段生效，不成交、钱/口碑/牌组不变、`lastOutcome` 置 `null`、日志追加 `<物品名>:跳过`、推进至下一位当客或 `summary`）；`PawnshopDebugSnapshot` 补 `canSkip?: boolean`。
  - **界面与字形（`src/scenes/PawnshopScene.ts`、`src/data/pixel-font.json`）**：`renderNegotiating()` 当客卡片右下角（`(270, 107)`，`64×18`）增「跳过当客」8-bit 按钮（16 色板 + 1px 墨黑描边，常态旧纸底、三档全买不起时灯黄底高亮），新增 `handleSkip()`（不消耗 RNG），`getState()` 补 `canSkip`；用 `scripts/generate-pixel-font.py` 基于 Fusion Pixel 12px 补齐「跳」字形（477 字形，102.0 KB，TTF 未入库）。
  - **文档**：更新 `docs/GAME_DESIGN.md` §11.3（补跳过规则，v1.0 核心不动）、`docs/DECISIONS.md` 与本文件，新建 `proto-tasks/07-skip-customer.md`。
  - **测试**：`tests/unit/pawnshop.test.ts` 新增 4 个单测用例，`tests/unit/pixelart.test.ts` 字形覆盖加入 `'跳过当客'`；新增 `tests/e2e/skip-customer.spec.ts`（2 用例：复现 `seed=4` 第 1 天死角与第 4 天中途跳过），原有全流程断言不受影响。
- **分支名**：`fix/skip-customer`
- **验证证据**：
  - `npm run build` 退出码 0（`tsc --noEmit` + `vite build`，JS 1,378.39 kB）；
  - `npm run test` 9/9 文件、73/73 单测全部通过；
  - `npm run test:e2e` 17/17 全部通过（含新增 `skip-customer.spec.ts` 2 用例），无失败请求、无 `pageerror`。
- **PR 状态**：（建 PR 后由汇报提供链接与 CI 状态）
