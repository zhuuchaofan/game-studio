import Phaser from 'phaser';
import { audio } from '../game/audio';
import { PALETTE } from '../game/pawnshop';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export interface TransitionSceneData {
  next: string;
  payload?: Record<string, unknown>;
}

export interface TransitionDebugSnapshot {
  active: boolean;
  frame: number;
  totalFrames: number;
  next: string;
}

export interface TransitionDebugHook {
  getState: () => TransitionDebugSnapshot;
}

declare global {
  interface Window {
    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    __TRANSITION_DEBUG__?: TransitionDebugHook;
  }
}

const TOTAL_FRAMES = 6;
const FRAME_DURATION_MS = 83; // 12 FPS -> 6 frames ≈ 500ms

const WARM_BAND_COLORS = [
  PALETTE.candle.num,
  PALETTE.oldPaper.num,
  PALETTE.lampYellow.num,
  PALETTE.copperBrown.num,
  PALETTE.woodBrown.num,
  PALETTE.deepWood.num,
] as const;

const COOL_BAND_COLORS = [
  PALETTE.nightBlack.num,
  PALETTE.deepBlue.num,
  PALETTE.nightBlack.num,
  PALETTE.deepBlue.num,
  PALETTE.nightBlack.num,
  PALETTE.deepBlue.num,
] as const;

/**
 * 白天 → 夜里 6 帧“拉灯”转场（docs/ART_STYLE.md §6）。
 * 6 条横向色带自上而下依次由暖色（烛光/木棕）翻转为冷色（深蓝/夜黑），
 * 零半透明、零淡入淡出，播完 6 帧后切换至目标场景。
 */
export class TransitionScene extends Phaser.Scene {
  private currentFrame = 0;
  private isActiveTransition = false;
  private nextSceneKey = 'CardBattleScene';
  private bands: Phaser.GameObjects.Rectangle[] = [];
  private cordHandle!: Phaser.GameObjects.Rectangle;
  private cordLine!: Phaser.GameObjects.Rectangle;

  constructor() {
    super({ key: 'TransitionScene' });
  }

  create(data?: TransitionSceneData): void {
    this.nextSceneKey = data?.next ?? 'CardBattleScene';
    const payload = data?.payload;
    this.currentFrame = 0;
    this.isActiveTransition = true;
    this.bands = [];
    audio.stopBgm();

    window.__TRANSITION_DEBUG__ = {
      getState: () => ({
        active: this.isActiveTransition,
        frame: this.currentFrame,
        totalFrames: TOTAL_FRAMES,
        next: this.nextSceneKey,
      }),
    };

    const bandHeight = Math.floor(BASE_HEIGHT / TOTAL_FRAMES);
    const centerX = Math.floor(BASE_WIDTH / 2);

    // 初始暖色 6 条横向色带 + 1 像素墨黑分隔线
    for (let i = 0; i < TOTAL_FRAMES; i += 1) {
      const y = i * bandHeight + Math.floor(bandHeight / 2);
      const rect = this.add.rectangle(centerX, y, BASE_WIDTH, bandHeight, WARM_BAND_COLORS[i]);
      this.bands.push(rect);
      if (i > 0) {
        this.add.rectangle(centerX, i * bandHeight, BASE_WIDTH, 1, PALETTE.ink.num);
      }
    }

    // 右侧拉灯绳与黄铜拉坠（随帧下移，无半透明）
    const cordX = BASE_WIDTH - 24;
    this.cordLine = this.add.rectangle(cordX, 18, 2, 36, PALETTE.ink.num);
    this.cordHandle = this.add
      .rectangle(cordX, 38, 6, 8, PALETTE.brass.num)
      .setStrokeStyle(1, PALETTE.ink.num);

    // 每帧约 83ms（12 FPS），共 6 帧逐行翻转为冷色
    const stepFrame = (frameIndex: number): void => {
      if (!this.scene.isActive()) {
        return;
      }

      if (frameIndex >= TOTAL_FRAMES) {
        this.isActiveTransition = false;
        this.scene.start(this.nextSceneKey, payload);
        return;
      }

      this.currentFrame = frameIndex + 1;
      this.bands[frameIndex].setFillStyle(COOL_BAND_COLORS[frameIndex]);

      // 拉灯绳向下拉动
      const pullOffset = Math.min(this.currentFrame * 4, 20);
      this.cordLine.setSize(2, 36 + pullOffset);
      this.cordLine.setPosition(cordX, Math.floor((36 + pullOffset) / 2));
      this.cordHandle.setPosition(cordX, 38 + pullOffset);
      if (this.currentFrame >= 3) {
        this.cordHandle.setFillStyle(PALETTE.silverBlue.num);
      }

      this.time.delayedCall(FRAME_DURATION_MS, () => {
        stepFrame(frameIndex + 1);
      });
    };

    // 立即进入第 1 帧并按 83ms 步进
    this.time.delayedCall(FRAME_DURATION_MS, () => {
      stepFrame(0);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.isActiveTransition = false;
    });
  }
}
