# 素材台账（ASSET_LEDGER）

> 原型阶段建立（2026-11-24）。此后任何外部素材（字体、音效、图片、参考资源）都须先在此登记来源与许可证，再进入项目使用。

## 字体

| 项目 | 内容 |
|------|------|
| 名称 | Fusion Pixel Font（缝合像素字体）12px 等宽简体中文版（`fusion-pixel-12px-monospaced-zh_hans.ttf`） |
| 版本 tag | `2026.11.10`（Release 资产 `fusion-pixel-font-12px-monospaced-ttf-v2026.11.10.zip`） |
| 来源 URL | https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.11.10 |
| 作者 | TakWolf（https://takwolf.com） |
| 许可证 | SIL Open Font License 1.1（OFL-1.1），许可全文副本见 [OFL.txt](./fonts/OFL.txt)（构建脚本本身按 MIT 许可） |
| 用途 | 游戏内全部场景文字的位图字体渲染（经 `scripts/generate-pixel-font.py` 生成点阵 JSON `src/data/pixel-font.json`，运行时渲染为 Phaser `BitmapText` 位图字体；原始 TTF 不入库）。运行时正文以 24px、英文标题以 48px 显示：12px 图集经 Phaser `BitmapText` 整数 2×/4× 放大（NEAREST），源 TTF 仍为 12px，未重新生成 24px 字库 |
| 是否修改 | 仅按项目用字子集化并做 12px 阈值二值化（灰度 > 128）转为 1-bit 点阵 JSON，未修改任何字形设计 |
| 上游第三方许可 | Fusion Pixel 缝合自以下上游开源像素字体（下列 `LICENSES/` 路径指上游官方发布包内目录；本仓库统一将 SIL OFL 1.1 许可全文副本存放在 [docs/fonts/OFL.txt](./fonts/OFL.txt)，音频合成许可存放在 [docs/licenses/ZzFX-LICENSE.txt](./licenses/ZzFX-LICENSE.txt)）：<br>1. **Ark Pixel Font**（TakWolf，https://github.com/TakWolf/ark-pixel-font ）— SIL OFL 1.1（上游发布包 `LICENSES/ark-pixel/OFL.txt`）<br>2. **Cubic 11（俐方體 11 號）**（含 JF Dot M+H 12 / M+ BITMAP FONTS 声明）— SIL OFL 1.1（上游发布包 `LICENSES/cubic-11/OFL.txt`）<br>3. **Galmuri**（Copyright (c) 2019–2025 Lee Minseo）— SIL OFL 1.1（上游发布包 `LICENSES/galmuri/LICENSE.txt`） |

## 像素插画

- `src/data/pixelart.ts`（30 张牌面 32×32，含「欠条」+ 12 件旧物 32×32 + 5 个心魔 32×32；P12 阶段 A 新增布票、口琴、药箱、账本、铁皮箱/顶住、金表 6 张原创图，旧物与同名牌面共用，共登记 12 个图项）：项目原创逐像素手绘点阵，仅使用 `docs/ART_STYLE.md` 定稿 16 色调色板，未使用任何外部图片素材或 AI 生图；在 640×360 画布下，源数据仍为 32×32，由 `src/game/pixelart.ts` 的 `pixelRowsToTexture` 统一按 2×2 最近邻块绘制渲染为 64×64 纹理。

## 音频合成算法

| 项目 | 内容 |
|------|------|
| 名称与版本号 | ZzFX — Zuper Zmall Zound Zynth `v1.4.0`（上游 commit `ac5a4727a44e5506a12f7340087e0b889cfd69dc`） |
| 官方来源 URL | https://github.com/KilledByAPixel/ZzFX |
| 作者与版权年份 | Frank Force，`Copyright (c) 2019 Frank Force` |
| 许可证 | MIT License，许可全文副本见 [ZzFX-LICENSE.txt](./licenses/ZzFX-LICENSE.txt) |
| 使用范围与修改说明 | 单文件内联算法：仅将 `ZzFX.js` 中的 `buildSamples` 核心合成函数以 TypeScript 形式内联进 `src/game/audio.ts`（`zzfxBuildSamples`，压缩后 < 1 KB），用于实时生成 `hit_demon` / `shield_block` / `player_hurt` / `offer_rejected` / `insufficient_funds` / `redeem_deal` 6 类带白噪声/失真质感的 8-bit 音效并接入自研 `AudioEngine` 的 `masterGain`；零外部音频文件，保留完整 MIT 版权声明 |
| 上游第三方依赖许可 | 无（纯浏览器 WebAudio / Math 零依赖算法） |
