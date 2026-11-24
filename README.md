# 当铺纸牌 (Pawn Shop Cards)

基于 Phaser 3 + TypeScript + Vite 构建的像素风纸牌游戏工程脚手架（原生分辨率 `320×180`，整数倍像素缩放）。

## 环境要求

- Node.js 20+（推荐 Node.js 24）
- npm 10+

## 安装

```bash
npm install
npx playwright install chromium
```

> 在全新的 Linux 环境中，如需安装浏览器系统依赖，请运行 `npx playwright install --with-deps chromium`。

## 运行与开发

```bash
# 启动开发服务器
npm run dev

# 类型检查并构建生产产物
npm run build

# 预览构建产物
npm run preview
```

## 测试

```bash
# 运行 Vitest 单元测试
npm run test

# 运行 Playwright E2E 冒烟测试（会先通过 preview 启动构建产物）
npm run test:e2e
```

## 目录结构

- `src/main.ts`：Phaser 入口与整数倍画布缩放逻辑
- `src/scenes/BootScene.ts`：Hello World 启动场景
- `src/utils/scale.ts`：整数倍分辨率缩放纯函数
- `tests/unit/`：Vitest 单元测试
- `tests/e2e/`：Playwright 冒烟测试
- `.github/workflows/ci.yml`：GitHub Actions CI 配置
