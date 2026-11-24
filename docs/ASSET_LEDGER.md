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
| 用途 | 游戏内全部场景文字的位图字体渲染（经 `scripts/generate-pixel-font.py` 生成点阵 JSON `src/data/pixel-font.json`，运行时渲染为 Phaser `BitmapText` 位图字体；原始 TTF 不入库） |
| 是否修改 | 仅按项目用字子集化并做 12px 阈值二值化（灰度 > 128）转为 1-bit 点阵 JSON，未修改任何字形设计 |
| 上游第三方许可 | Fusion Pixel 缝合自以下上游开源像素字体，随官方发布包附带于 `LICENSES/`，全部为 SIL OFL 1.1：<br>1. **Ark Pixel Font**（TakWolf，https://github.com/TakWolf/ark-pixel-font ）— SIL OFL 1.1（`LICENSES/ark-pixel/OFL.txt`）<br>2. **Cubic 11（俐方體 11 號）**（含 JF Dot M+H 12 / M+ BITMAP FONTS 声明）— SIL OFL 1.1（`LICENSES/cubic-11/OFL.txt`）<br>3. **Galmuri**（Copyright (c) 2019–2025 Lee Minseo）— SIL OFL 1.1（`LICENSES/galmuri/LICENSE.txt`） |

## 像素插画

- `src/data/pixelart.ts`（20 张原型牌面 32×32 + 3 件旧物 32×32 + 2 个心魔 32×32）：项目原创逐像素手绘点阵，仅使用 `docs/ART_STYLE.md` 定稿 16 色调色板，未使用任何外部图片素材或 AI 生图。
