import Phaser from 'phaser';
import { BALANCE, PALETTE } from '../game/pawnshop';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export class TitleScene extends Phaser.Scene {
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => ({
        phase: 'title',
        customerIndex: 0,
        money: BALANCE.startingMoney,
        reputation: BALANCE.startingReputation,
        deck: [],
        log: [],
      }),
    };

    // 背景与金色边框卡片（沿用 M0 BootScene 视觉风格）
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num);
    this.add
      .rectangle(centerX, centerY, BASE_WIDTH - 16, BASE_HEIGHT - 16, PALETTE.deepWood.num)
      .setStrokeStyle(2, PALETTE.brass.num);

    // 四角黄铜像素点缀
    const cornerInset = 12;
    this.add.rectangle(cornerInset, cornerInset, 4, 4, PALETTE.lampYellow.num);
    this.add.rectangle(BASE_WIDTH - cornerInset, cornerInset, 4, 4, PALETTE.lampYellow.num);
    this.add.rectangle(cornerInset, BASE_HEIGHT - cornerInset, 4, 4, PALETTE.lampYellow.num);
    this.add.rectangle(
      BASE_WIDTH - cornerInset,
      BASE_HEIGHT - cornerInset,
      4,
      4,
      PALETTE.lampYellow.num,
    );

    // 标题：PAWN SHOP CARDS（米白大字）+ 当铺纸牌（金色小字）
    this.add
      .text(centerX, centerY - 34, 'PAWN SHOP CARDS', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: PALETTE.paperWhite.hex,
        resolution: 1,
      })
      .setOrigin(0.5);

    this.add
      .text(centerX, centerY - 8, '当铺纸牌', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: PALETTE.lampYellow.hex,
        resolution: 1,
      })
      .setOrigin(0.5);

    this.add.rectangle(centerX, centerY + 8, 136, 1, PALETTE.brass.num);

    // “开始”按钮：烛光底 + 墨黑字 + 1 像素墨黑描边
    const buttonY = centerY + 38;
    const startBtn = this.add
      .rectangle(centerX, buttonY, 96, 26, PALETTE.candle.num)
      .setStrokeStyle(1, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(centerX, buttonY, '开始', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: PALETTE.ink.hex,
        resolution: 1,
      })
      .setOrigin(0.5);

    startBtn.on('pointerover', () => {
      startBtn.setFillStyle(PALETTE.lampYellow.num);
    });
    startBtn.on('pointerout', () => {
      startBtn.setFillStyle(PALETTE.candle.num);
    });
    startBtn.on('pointerdown', () => {
      this.scene.start('PawnshopScene');
    });

    this.syncInputBounds();
  }

  private syncInputBounds(): void {
    const refresh = (): void => {
      if (this.scene.isActive()) {
        this.scale.refresh();
      }
    };

    refresh();
    requestAnimationFrame(refresh);
    this.handleWindowResize = refresh;
    window.addEventListener('resize', refresh);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
