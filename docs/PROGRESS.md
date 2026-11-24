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
  - `npm run test` 6/6 文件、43/43 单测全部通过（含 P1 原有 20 用例全绿）；
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
- **PR 状态**：PR 待建。
