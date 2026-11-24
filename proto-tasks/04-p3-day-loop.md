# 任务 04：P3 人情 + 1 天流程串联 + 像素修正（SaveData + DayLoop + 位图字体 + 真像素插画）

> 协调员任务书。工作区：`~/workspace/game-studio/repo/`（本地 git 无提交，仅作工作区）。
> 基线：`main`（已含 PR #5 P2 夜里牌局，merge commit `e2b4249` + 定稿 GDD v1.0）。
> 分支：`feature/p3-day-loop`（已从 main 建好）。
> 只改本文指定的文件；**红线**：不改 `.github/`、`vite.config.ts`、`package.json`、
> `package-lock.json`、`README.md`、`src/utils/scale.ts`、缩放逻辑；不做图鉴、不做
> 云同步存档、不做 1 天以外的多天经济系统（房租、进货、当铺升级购买线）；不提交、
> 不推送、不碰 GitHub；不写任何凭据；不联网收费服务；不擅自改核心玩法、技术架构、
> 美术方向——只执行下面写明的范围。数值全部放 `src/data/*.json`，禁止写死在场景代码里。
> **不改平衡数值**：P2 蒙特卡洛结论（A 91.3%、B 97.3% 3 回合胜率、零血量归零负、
> 生存压力过小）制作人尚未决定是否调 JSON，P3 沿用现有数值；把该结论记入
> PROGRESS.md / DECISIONS.md 作为待评审项。**不改定稿 GDD 的“本回合”措辞**：
> 铁皮青蛙已按“敌方此前回合已行动”（`demonHasActed`，R1 打 3 伤、R2/R3 打 6 伤）
> 实现并复验通过，措辞修订等制作人定夺；实现行为保持现状。

## 背景

- GDD 已定稿（原型 v1.0）：`docs/GAME_DESIGN.md` 机制卡 2（人情：开局 3 点、上限随当铺
  等级提升、最高 6）、机制卡 5（3 回合牌局：打赢得新牌 + 钱 + 赎当券，打输旧物滞留、
  执念加重）、第 8 节原型范围（收当 + 牌局 + 人情系统 + 1 天流程）；`docs/ARCHITECTURE.md`
  第 6 节（跨天进度放 `SaveData` 模块）、第 8 节（存档 JSON 带 `version` 字段）；
  `docs/ART_STYLE.md`（16 色、320×180、整数缩放；§5 像素字体中文 12 像素点阵；
  §6 白天→夜里 6 帧“拉灯”转场；牌面插画 32×32、牌框 48×64）。
- P1/P2 现状：`TitleScene` → `PawnshopScene`（3 位当客固定顺序三档估价，结算屏“进入
  夜里牌局”/“返回标题”）→ `CardBattleScene`（`demonId: "a"` 固定传入）→
  `ResultScene`（胜负结算，只有“返回标题”）；`src/data/balance.json` 已有开局生命 30、
  人情 3/3、`drawFirst: 5`、`drawPerRound: 2`、`winRewardMoney: 20`；
  `src/game/battle.ts` 的 `createBattle` 接受 `BattleBalanceConfig`（含 `maxRenqing`）；
  `resolveWinReward` 已实现（得钱 + 随机新牌 + 赎当券 ×1）。
- **像素现状（制作人 2026-11-24 指出，属实）**：当前画面是程序化色块（`Graphics.fillRect`
  拼出来的示意图形）+ 系统 `monospace` 字体（`this.add.text`，浏览器抗锯齿渲染），
  看着不像真 8-bit。ART_STYLE.md §5 早已写明原型可用系统字体占位、正式版前必须换
  开源像素字体——本次 P3 把这笔债还上。

## 范围 A：1 天流程串联（多天循环雏形）

### A1. 存档模块 `src/game/save.ts`（新文件，纯函数 + localStorage，可单元测试）

- `SaveData` 类型：`{ version: 1, day: number, money: number, reputation: number,
  deck: string[], shopLevel: number, redeemTickets: number }`。
  - `version: 1`（ARCHITECTURE.md 第 8 节）；读档时版本号不符或 JSON 解析失败
    → 视为无存档（返回 `null`），不崩溃、不弹错。
  - `day`：当前天数（第 1 天为 1）；`deck`：牌名字符串数组（跨天保留）；
    `shopLevel`：当铺等级（开局 1）；`redeemTickets`：赎当券数量。
- localStorage 键：`'pawnshop-cards-save-v1'`。
- 导出函数：`createNewGame(): SaveData`（day 1、money 200、reputation 0、deck []、
  shopLevel 1、redeemTickets 0；数值取自 `balance.json` 的开局字段，不写死）、
  `loadSave(): SaveData | null`、`saveGame(data: SaveData): void`、
  `clearSave(): void`、`applyDayResult(save: SaveData, result: { outcome:
  'win' | 'lose', reward?: WinReward }): SaveData`（纯函数，不可变返回）：
  - 胜：`money += reward.money`（`winRewardMoney`，占位 20；全牌已有时 `resolveWinReward`
    已含 +20 加赠，照传即可）、`deck` 加入 `reward.cardName`（若有）、
    `redeemTickets += reward.redeemTicket`、`shopLevel += 1`（见 A2 上限）、`day += 1`。
  - 负：`day += 1`；钱、口碑、牌组、等级、赎当券均不变（旧物滞留 = 牌组原样保留；
    “执念加重”本次只做占位记录，不引入新数值——见 DECISIONS.md 记一笔）。
- 存档时机：ResultScene 确定胜负并算出奖励后立即 `saveGame`（自动存档，玩家无须
  手动存）；TitleScene“开始”新开一局时覆盖旧存档（原型简化，记入 DECISIONS.md）。

### A2. 人情上限随当铺等级提升

- `src/data/balance.json` 补充字段（不改已有字段）：`renqingBase: 3`、
  `renqingPerLevel: 1`、`renqingCap: 6`。
- 规则：`maxRenqing = min(renqingBase + (shopLevel - 1) * renqingPerLevel, renqingCap)`，
  即 1 级 3 点、2 级 4 点、3 级 5 点、4 级及以上 6 点封顶（GDD 机制卡 2：上限最高 6）。
- 实现：`src/game/save.ts` 导出纯函数 `maxRenqingForLevel(shopLevel, balance)`；
  `CardBattleScene` 的 `BATTLE_BALANCE` 不再直接取 `balanceJson.maxRenqing`，改为
  由场景 `data` 传入 `maxRenqing`（P2 既有调用方与测试不传时默认取 `balance.json`
  的 `maxRenqing`，保持向后兼容）；`createBattle` 已接受该字段，无须改状态机。
- 牌局内每回合回满到当前上限（既有逻辑，数值来自传入值）。

### A3. 场景串联改动

- `src/scenes/TitleScene.ts`（修改）：
  - 有存档时（`loadSave() !== null`）在“开始”按钮下方加“继续”按钮（样式与“开始”
    一致，位置在其下方约 34 像素处）；无存档时不画“继续”（P1 决策延续：不画死按钮）。
  - “开始”→ `createNewGame()` 并 `saveGame`，进 `PawnshopScene`（day 1）。
  - “继续”→ 读档进 `PawnshopScene`（带存档数据）。
- `src/scenes/PawnshopScene.ts`（修改）：
  - `create(data?: { save?: SaveData })`：有存档数据时用存档的 `day/money/reputation/
    deck` 初始化（`createInitialState` 需接受可选初始值——改 `src/game/pawnshop.ts`
    的 `createInitialState(initial?: Partial<...>)`，不改结算规则）；无数据时沿用
    P1 开局（day 1、钱 200、口碑 0、空牌组）。
  - HUD 增加天数显示（例如右上角“第 N 天”；与现有“当客 x/3”并存，布局不重叠，
    以截图验收为准）。
  - 当客顺序随机化：每天开始时用种子 RNG（`?seed=` + 天数）洗牌 `items` 顺序
    （Fisher-Yates，纯函数放 `pawnshop.ts`，可单测；固定种子下顺序可复现）。
    注意：P1 既有 E2E 用固定种子断言“手表→婚戒→旧书”固定顺序——洗牌后这些用例
    须按新规则更新断言（以 `?seed=` + day 确定的洗牌结果为准，不可删用例）。
  - 结算屏“进入夜里牌局”按钮：改为先经过拉灯转场（A4）再进 `CardBattleScene`，
    传入 `deck`（当日收下牌 + 往日牌组）与 `demonId`（见 A5）。
- `src/scenes/ResultScene.ts`（修改）：
  - 胜负结算后立即算奖励并 `saveGame(applyDayResult(...))`（A1 时机）。
  - 按钮改为两个：“下一天”→ 进下一天 `PawnshopScene`（带更新后存档）；
    “返回标题”→ TitleScene（保留）。按钮布局不重叠，以截图验收为准。
  - 结算屏显示天数与当铺等级（例如“第 N 天 · 当铺 Lv.x”），胜/负文案不变。
- `src/main.ts`（修改，仅注册新场景）：注册 A4 的转场场景。

### A4. 白天→夜里 6 帧“拉灯”转场（ART_STYLE.md §6）

- 新场景 `src/scenes/TransitionScene.ts`：接收 `data { next: string, payload?: object }`。
- 表现：6 帧、每帧约 83ms（12 FPS），暖色画面逐行变暗为冷色——实现为 6 条横向
  色带自上而下依次由暖色（烛光/木棕）翻转为冷色（深蓝/夜黑），不用淡入淡出、
  不用半透明（ART_STYLE.md 禁止大面积半透明）；6 帧播完后 `scene.start(next, payload)`。
- 入口：仅 PawnshopScene 结算屏“进入夜里牌局”走转场；其余场景切换不走转场。
- E2E 须断言：点“进入夜里牌局”后出现转场画面（至少截到 1 帧中间态），随后进入
  牌局（`__BATTLE_DEBUG__` 可用）。

### A5. 心魔轮换（占位规则，记入 DECISIONS.md）

- 夜里心魔按天数轮换：第 1 天夜里 `demonId: "a"`（药费，教学）；第 2 天及以后
  `demonId: "b"`（车票）。第 4 天及以后仍为 B（原型只有 2 种心魔，不引入新心魔）。
- `PawnshopScene` 按 `save.day` 计算并传入；`?demon=a|b` URL 参数仍优先（测试用）。

## 范围 B：像素修正（真 8-bit）

### B1. 开源像素字体，走位图字体渲染

- 字体选定：**Fusion Pixel Font（缝合像素字体）12px 等宽简体中文版**
  （`fusion-pixel-12px-monospaced-zh_hans.ttf`），作者 TakWolf，
  项目主页 https://github.com/TakWolf/fusion-pixel-font ，**SIL Open Font License 1.1**
  （OFL-1.1；字体本身按 OFL 授权，构建脚本按 MIT——以随包的许可文本为准）。
  选定理由：12px 原生点阵、简中覆盖全（GB2312 6763 字中 6647 有字形）、OFL 可商用
  可再分发；备选为 Zpix（最像素）12px（SolidZORO/zpix-pixel-font，同样 OFL-1.1），
  仅当 Fusion Pixel 无法下载时换备选并记入 DECISIONS.md，**不得擅自换成其他字体**。
- 获取（构建时输入，不进仓库）：从官方 Release 下载 TTF（例如 tag `2026.10.25`，
  若该 tag 不可用则取 Release 页最新 tag，并在 ASSET_LEDGER.md 写明实际 tag）；
  下载地址解析：`https://github.com/TakWolf/fusion-pixel-font/releases`
  （Release 资产直链形如 `.../releases/download/<tag>/<asset>`，资产名从 Release 页
  解析；若 GitHub API 限流，改走 jsDelivr npm 镜像的 Fontsource 包
  `@fontsource/fusion-pixel-12px-monospaced-sc`（woff2，需 `fonttools` + `brotli`
  转 TTF）作为后备下载路径）。
  - TTF 本身**不提交进仓库**（二进制文件走连接器推送有风险，且 6.9MB 占体积）；
    生成脚本只把 TTF 放 `/tmp`（或工作区外临时目录），生成完即弃。
  - 下载后先核对包内 `OFL.txt` 确为 SIL OFL 1.1，再生成；核对失败则停手汇报。
- 生成脚本（新文件，提交进仓库）：`scripts/generate-pixel-font.py`（Python 3，
  本机已验证 PIL 10.2.0 可用；不用 node-canvas，未安装）：
  - 输入：`/tmp` 里的 TTF + 字符集（自动扫描 `src/**/*.ts` 与 `src/data/*.json`
    中的全部字符串字面量，提取去重后的全部字符；另加 ASCII 可见字符与常用标点，
    确保标题 `PAWN SHOP CARDS`、数字、标点全覆盖）。
  - 处理：PIL `ImageFont.truetype(..., 12)` 逐字渲染（像素字体原生 12px），
    阈值二值化（灰度 > 128 记为实像素）去抗锯齿，得到每字 12×12（西文半宽 6×12，
    按字体实测 advance 取值）的 1-bit 点阵；记录每字 `advance/xoffset/yoffset`。
  - 输出：`src/data/pixel-font.json`（纯文本 JSON，可提交）：`{ font: "Fusion Pixel 12px",
    version: "<release tag>", size: 12, glyphs: { "<char>": { "advance": n,
    "rows": ["...12 行 0/1 字符串..."] } } }`。JSON 体积目标 ≤ 200KB（约数百字）。
  - 脚本须可重复运行（`python3 scripts/generate-pixel-font.py --ttf /tmp/xxx.ttf`），
    并在文件头注释写明字体来源 URL、版本 tag、许可证。
- 运行时（新文件 `src/game/pixelFont.ts`，纯逻辑 + Phaser 纹理生成）：
  - 从 `pixel-font.json` 的点阵在内存 Canvas 上拼出位图字体纹理（每字按 `advance`
    排布，字间 0 间距；颜色用白色像素，显示时用 tint 着色），用
    `this.textures.addCanvas` 注册纹理，再按本地 `node_modules/phaser` 的
    BitmapText 解析格式（先读源码确认 `cache.bitmapFont.add(key, { data, texture,
    frame })` 的 `data` 结构——`chars` 映射含 `x/y/width/height/xoffset/yoffset/
    xadvance`）注册为 Phaser 位图字体；若该 API 在 phaser 3.90.0 不可用，
    停下来汇报，不可擅自改用其他渲染方案。
  - 导出助手 `addPixelText(scene, x, y, text, opts)`（opts：`size`（12 或 24=2×）、
    `color`（调色板 hex）、`origin`），内部用 `scene.add.bitmapText`；另导出
    `PIXEL_FONT_KEY = 'pixel'` 与 `loadPixelFont(scene)`（在 BootScene `preload`
    中调用；字体纹理须在 TitleScene 之前就绪）。
  - **全场景文字替换**：`TitleScene`、`PawnshopScene`、`CardBattleScene`、
    `ResultScene`（以及仍有文字的任何场景）中全部 `this.add.text(...)` 改为
    `addPixelText`；标题 `PAWN SHOP CARDS` 用 24（2× 放大，整数倍仍锐利），其余
    一律 12；**画面上不得再出现任何系统字体抗锯齿文字**（E2E 截图 + 协调员肉眼核验）。
  - 注意：位图字体 tint 着色——HUD 数字的黄铜/灯黄、危险朱红等颜色改用 `setTint`；
    多行文本（故事、反馈）用 `\n` 换行，`lineSpacing` 按位图字体行高重算；
    `wrapCjkText` 按字符数换行逻辑保留（等宽字体下仍成立），以截图验收布局为准。
- 台账（新文件 `docs/ASSET_LEDGER.md`，原型阶段建立）：
  - 登记字体：名称、版本 tag、来源 URL、作者、许可证（SIL OFL 1.1，全文附后或
    链到随包 `OFL.txt` 的副本——把 OFL.txt 文本存为 `docs/fonts/OFL.txt` 一并提交，
    纯文本可推送）、用途（游戏内全部文字的位图字体）、是否修改（仅子集化 + 二值化，
    未改字形）、上游第三方许可（Fusion Pixel 缝合字源 Ark Pixel / Cubic 11 /
    Galmuri 的许可原文随包在 `LICENSES/`，记一笔并存副本说明）。
  - 此后任何外部素材（字体、音效、图片）都须先登记再使用。

### B2. 牌面改成真正的 32×32 像素插画

- 数据（新文件 `src/data/pixelart.ts`，纯文本，可提交）：20 张牌各一张 32×32 点阵
  （字符串数组，32 行 × 每行 32 字符，字符 = 调色板编号 0–15 的十六进制位，
  `.` = 透明）；另含 3 件旧物图标（手表/婚戒/旧书，各 32×32，复用牌面画法）与
  2 个心魔图标（药费/车票，各 32×32）。
  - 全部只用 ART_STYLE.md 16 色调色板；单图 ≤ 12 色；旧物主色与 GDD 一致
    （手表=黄铜、婚戒=银蓝、旧书=木棕）；朱红只用于重要/危险/盖章。
  - 插画须手绘点阵（逐像素设计，AGY 自己画），**不用 AI 生图**；每张牌的画法
    要能一眼认出旧物（例如钢笔=笔尖+笔身、秤砣=梯形砣身+提环、蒲扇=扇面+扇柄）。
  - 牌面插画 32×32 放在牌框 48×64 内（ART_STYLE.md §3）：插画区居中偏上，
    下方留牌名与效果文字区（位图字体 12px）；牌框本身仍为 48×64。
- 渲染（`src/game/pixelart.ts` 新文件，纯函数 + Phaser 纹理）：
  - `pixelRowsToTexture(scene, key, rows, palette)`：把点阵字符串画到内存 Canvas
    （1 字符 = 1 像素，透明跳过），`textures.addCanvas` 注册；同一 key 只生成一次。
  - 场景改动：`CardBattleScene` 手牌区每张牌用插画纹理（`add.image`）替代现有的
    平铺色块 + 文字（牌框矩形保留，插画贴在其内）；出牌飞行残影仍用旧纸色块；
    `PawnshopScene` 左侧旧物像素图框改用 32×32 旧物插画（替代现有 `Graphics.fillRect`
    手绘）；`CardBattleScene` 心魔剪影框改用 32×32 心魔插画（替代现有
    `drawDemonSilhouette` 的 fillRect 手绘；函数删除或留空，二选一并记入报告）。
  - 单元测试覆盖 `pixelRowsToTexture` 的数据校验（行数/列数/字符合法性）与
    `pixelart.ts` 全量校验（20 张牌 + 3 旧物 + 2 心魔全部存在、尺寸正确、用色在
    16 色内、单图 ≤ 12 色）。
- **不改**：320×180 原生分辨率、整数缩放、竖屏小屏问题（仍待制作人决策）；
  场景背景（柜台/牌桌/台灯等程序化色块）本次不动——像素修正只做文字与牌面/
  图标，背景留待正式美术阶段。

## 测试

- 单元测试（Vitest，新文件）：
  - `tests/unit/save.test.ts`：新开局默认值、存档 round-trip（localStorage mock）、
    版本不符/损坏 JSON 返回 `null`、胜负 `applyDayResult`（胜：钱/牌/券/等级/
    天数；负：仅天数 +1）、人情上限随等级（1 级 3、2 级 4、3 级 5、4 级 6 封顶）。
  - `tests/unit/pixelart.test.ts`：20 张牌 + 3 旧物 + 2 心魔点阵全量校验（见 B2）；
    位图字体 JSON 覆盖检查（`cards.json`/`items.json`/`demons.json` 中全部字符
    都在 `pixel-font.json` 的 `glyphs` 里；缺字即失败——缺字时先补字符集重跑脚本，
    不可静默留空）。
  - `tests/unit/pixelFont.test.ts`（若有纯逻辑部分）：点阵 → Phaser 位图字体
    `data` 结构的转换（`xadvance`、字符映射）单测。
- E2E（Playwright，新文件 `tests/e2e/dayloop.spec.ts` + 像素专项断言）：
  - 完整 1 天流程（固定种子）：标题“开始”→ 白天收当（洗牌后顺序以种子确定）
    → 结算 → 拉灯转场（截到中间帧）→ 夜里牌局 → 结算 → “下一天” →
    第 2 天白天 HUD 显示“第 2 天”、钱/牌组/人情上限与存档一致；
  - 存档读档：跑完第 1 天后刷新页面，标题出现“继续”→ 点“继续”→ 回到第 2 天
    白天，钱与牌组与存档一致；无存档时标题无“继续”按钮；
  - 负局流程：固定种子打输一局 → “下一天”后牌组不变、天数 +1；
  - 截图：桌面 1280×720 + 手机竖屏 390×844（标题/白天/转场/牌局/结算/第 2 天），
    确认画面渲染、无失败请求、无 `pageerror`；**像素专项**：截图须肉眼可辨为真
    8-bit（像素字体、32×32 牌面插画、无抗锯齿文字）——协调员逐张看图核验。
- 现有测试（单测 44 + E2E 10）必须保持全绿；P1 固定顺序 E2E 断言按 A3 洗牌
  规则更新（以 `?seed=` + day 确定的顺序为准，不可删用例）。

## 文档记录更新

- `docs/PROGRESS.md`：追加一节“2026-11-24 — P3 人情 + 1 天流程串联 + 像素修正
  （feature/p3-day-loop）”，记范围、分支名、验证证据（含存档 round-trip、
  第 2 天流程、像素修正前后对比）与 PR 状态（PR 号由协调员填，先写“PR 待建”）。
- `docs/DECISIONS.md`：追加 P3 决策记录（格式：日期 — 决策 — 理由 — 影响）：
  存档格式 v1 与自动存档时机、“开始”覆盖旧存档、心魔按天轮换（1 天 A、2 天起 B，
  占位）、胜场升 1 级（人情上限 +1，封顶 6）、当客按天洗牌、拉灯转场实现方式、
  字体选定 Fusion Pixel 12px OFL-1.1（含备选 Zpix 的触发条件）、TTF 不进仓库而
  生成 JSON 点阵的方案、牌面 32×32 手绘点阵方案、P2 蒙特卡洛结论记为待评审项
  （数值未改）、铁皮青蛙措辞未改（实现保持 `demonHasActed`）。
- `docs/ASSET_LEDGER.md`（新文件）：见 B1 台账要求。

## 完成自查（做完逐项核对，缺一不可）

1. `npm run build` 退出码 0；`npm run test` 全部通过；`npm run test:e2e` 全部通过
   （含新增 `dayloop.spec.ts` 与既有测试）。
2. 完整 1 天流程可实际跑通（E2E 断言为证）；存档读档 round-trip 正确；
   人情上限随等级提升正确；当客洗牌在固定种子下可复现；拉灯转场 6 帧可见。
3. 全场景无系统字体文字残留（`grep -rn "add.text" src/scenes/` 0 命中；
   `grep -rn "fontFamily" src/` 0 命中）；`pixel-font.json` 覆盖全部游戏用字；
   20 张牌面 + 3 旧物 + 2 心魔均为 32×32 真像素插画且用色合规。
4. 只改了上面指定的文件，没有动其他任何文件（文件清单核对）；`src/data/*.json`
   数值未改（`balance.json` 只追加 `renqingBase/renqingPerLevel/renqingCap` 三字段）。
5. 向协调员汇报：新增/修改文件清单、构建与测试输出摘要、E2E 截图路径、
   游戏状态检查结果（贴关键断言输出）、像素修正前后对比结论。

## 附录（2026-11-24 17:58 追加，制作人决定）

### A. CI 可靠性修复（`ci.yml`，与 P3 同分支提交）

- 原因：P1/P2 每次推文件都单独触发 CI，一轮里有运行跑 6 分多钟才绿，疑似
  Playwright 浏览器下载重试、偶发失败，失败就给制作人发邮件。
- 改动：`build-and-test` job 在“Run unit tests”之后、“Install Playwright Chromium”
  之前加一步 `Cache Playwright browsers`（`actions/cache@v4`，`path:
  ~/.cache/ms-playwright`，`key: ${{ runner.os }}-playwright-${{ hashFiles('**/package-lock.json') }}`，
  `restore-keys` 前缀 `${{ runner.os }}-playwright-`）。`npx playwright install
  --with-deps chromium` 保留原样：浏览器已在缓存中时该命令跳过下载（只装系统
  依赖），不再每次下载约 150MB；Playwright 版本变化（`package-lock.json` 变化）
  时缓存 key 变化，自动重新下载。未改动其他步骤、未改测试行为。
- 推送方式：`.github/workflows/ci.yml` 不能走连接器推送（403），**由 AGY 在
  GitHub 认证就绪后直接 `git push` 提交**；本地已改好并通过 YAML 语法校验。
  若 P3 结束时 AGY 提交还没就绪，协调员把改好的 `ci.yml` 全文写进汇报，由
  制作人处理。

### B. 提交方式变更（制作人决定，2026-11-24 17:57）

- 以后提交（push 分支、开 PR）由 AGY 自己做（本地 `git push` + `gh pr create`），
  不再走 Muse 的 GitHub 连接器逐文件推送，不再弹审批卡。
- 本分支 `feature/p3-day-loop` 的 25 个 P3 文件已在决定前经连接器推完并逐个
  核对一致（见协调员核查记录），**PR 尚未建**，等 AGY 认证就绪后由 AGY
  `gh pr create` 创建 PR #6。协调员不再用连接器推送或开 PR。
- 待 AGY 推送的文件（本地已改、分支上还没有）：`.github/workflows/ci.yml`
  （本附录 A）、`docs/PROGRESS.md` 与 `docs/DECISIONS.md` 的 CI 修复记录
  （若协调员已补记）。
