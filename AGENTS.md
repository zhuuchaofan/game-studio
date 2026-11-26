# AGENTS.md — 当铺纸牌 (Pawn Shop Cards)

本文件是开发、产品两位 agent 共读的项目操作手册。Codex 原生读它，AGY（Antigravity CLI）每次会话启动自动读它。

## 项目

1980 年代复古 2D 像素风卡牌构筑 Roguelite + 轻经营：1987 年老城区当铺，白天收当组牌、夜里打心魔牌局。Phaser 3.90.0 + TypeScript 5.9.x + Vite 8.3.8 + Vitest + Playwright。公开仓库 `zhuuchaofan/game-studio`，试玩页 https://game.zhuchaofan.com 。当前版本 v0.4.3-ClearRunFix。

- 设计：`docs/GAME_DESIGN.md`（GDD v1.0）、架构 `docs/ARCHITECTURE.md`、决策 `docs/DECISIONS.md`、进度 `docs/PROGRESS.md`
- 任务书：`proto-tasks/`，实现以当轮任务书为准，任务书没写的不要做

## 角色

- **PM**：朱超凡（制作人）——定方向、玩法、审美、最终验收，拍板关键改法
- **PL**：babyball（Muse）——策划、调度、质控、发布；起草任务书、独立验收、合并、验 live；裁决审稿意见
- **开发**：AGY（Antigravity CLI）——按任务书实现、开 PR、部署
- **产品**：Codex CLI——需求对齐、平衡核查、玩家体验审稿、根因调查；不写游戏代码
- **测试玩家**：Grok——PM 单独控制，不归 PL 调度

## 命令

- `npm run build`：`tsc --noEmit && vite build`
- `npm test`：单测（vitest run）
- `npm run test:e2e`：E2E（playwright test）
- `npm run sim`：平衡模拟；`npm run sim:check`：模拟校验
- `npm run dev`：本地预览

## 铁律

- 本地构建 + 单测 + E2E 全绿之前不推；合并 ≠ 部署，合完必须截图验 live 页
- 只改任务书范围内的文件，不要动无关文件
- 代码、文案、美术 100% 原创：开源参考只看设计，不抄代码、文案、美术
- 像素字库约束：文案用字必须在字库内（见 `scripts/generate-pixel-font.py` 与 `docs/fonts`），缺字就报错，不准造字、不准用字库外字符

## 最小改动（禁过度防御）

Make the smallest change that fully solves the task. Do not add abstractions, fallbacks, defensive guards, refactors, or features unless they are strictly required.

- 不要加哈希/校验和/指纹，除非它替代了一个实质上更贵的操作，并且结果会改变下一步做什么
- 不为本项目不会发生的情况加 feature flag、迁移框架、兼容层、包装层；不为理论上的边界情况加分支
- 上游已保证、类型系统已排除的值，不要层层判空；不要用 try/catch 吞掉真正的错误

## 模型路由（额度，2026-11-26 实测）

- 提案/方案/文案 → Gemini Orchestrator (Neon)：`--model gemini-pro-orchestrator-neon`。Gemini 周剩 14%，12-01 08:53 CST 重置，省着用
- 改代码/查 bug → Claude Sonnet 5.5 Medium：`--model claude-sonnet-5-5-medium`；难的 → Claude Opus 5.5 Medium：`--model claude-opus-5-5-medium`
- 审查 → Codex CLI（ChatGPT Plus）
- agy 内的 `gpt-oss-120b-medium` 是 GPT-OSS 120B 开源模型，不是 GPT-6.2，不用于严谨任务
- 每次调用须显式加 `--model`，settings.json 的 model 键不生效

## 审查门（Codex 只读审 PR，合并前）

- 挡上线（Block）：算错数（钱/血量/口碑等数值）、丢数据/丢存档、越权改动（改了任务书范围之外的文件或规则）
- 其他只记建议（Suggestion），不挡
- 最多审两轮。审稿意见先由 PL 核实（跑测试/读代码），核实过的才进修整单，未核实的丢弃并注明原因
- 已固定为每轮必跑（制作人 2026-11-26 定）

## 错一次，补一个测试

- 每个被纠正的 bug，必须留下一个能拦住它的测试或检查（单测、E2E 或 sim 校验），随修复一起提交
- 写成文字规则是最后的办法：能用测试拦住的，不写规则

## Code Review Rules

- 对照任务书验收：改动是否只做了任务书要求的事
- 数值：钱/生命/口碑/伤害的计算是否有单测或 sim 覆盖
- 回归：本次修的 bug 是否有对应的回归测试
- 范围：是否改了任务书之外的文件；是否有新增的防御性代码、抽象、脚手架
- 只报 P0/P1 级真问题；推测性问题写成建议，不挡
