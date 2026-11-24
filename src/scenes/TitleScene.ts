import Phaser from 'phaser';
import { BALANCE, PALETTE } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import { createNewGame, loadSave, maxRenqingForLevel, saveGame } from '../game/save';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export const TITLE_START_BUTTON = { x: 160, y: 122, width: 96, height: 24 } as const;
export const TITLE_CONTINUE_BUTTON = { x: 160, y: 156, width: 96, height: 24 } as const;

export class TitleScene extends Phaser.Scene {
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const existingSave = loadSave();

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => ({
        phase: 'title',
        customerIndex: 0,
        money: existingSave?.money ?? BALANCE.startingMoney,
        reputation: existingSave?.reputation ?? BALANCE.startingReputation,
        deck: existingSave ? [...existingSave.deck] : [],
        log: [],
        day: existingSave?.day ?? 1,
        shopLevel: existingSave?.shopLevel ?? 1,
        redeemTickets: existingSave?.redeemTickets ?? 0,
        maxRenqing: maxRenqingForLevel(existingSave?.shopLevel ?? 1),
        hasSave: existingSave !== null,
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

    // 标题：PAWN SHOP CARDS（24px 2× 位图大字）+ 当铺纸牌（12px 金色字）
    addPixelText(this, centerX, 46, 'PAWN SHOP CARDS', {
      size: 24,
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });

    addPixelText(this, centerX, 74, '当铺纸牌', {
      size: 12,
      color: PALETTE.lampYellow.hex,
      origin: 0.5,
    });

    this.add.rectangle(centerX, 92, 136, 1, PALETTE.brass.num);

    // “开始”按钮：烛光底 + 墨黑字 + 1 像素墨黑描边
    this.createMenuButton(
      TITLE_START_BUTTON.x,
      TITLE_START_BUTTON.y,
      TITLE_START_BUTTON.width,
      TITLE_START_BUTTON.height,
      '开始',
      () => {
        const fresh = createNewGame();
        saveGame(fresh);
        this.scene.start('PawnshopScene', { save: fresh });
      },
    );

    // 有存档时在“开始”按钮下方约 34 像素处显示“继续”按钮；无存档时不画
    if (existingSave !== null) {
      this.createMenuButton(
        TITLE_CONTINUE_BUTTON.x,
        TITLE_CONTINUE_BUTTON.y,
        TITLE_CONTINUE_BUTTON.width,
        TITLE_CONTINUE_BUTTON.height,
        '继续',
        () => {
          this.scene.start('PawnshopScene', { save: existingSave });
        },
      );
    }

    this.syncInputBounds();
  }

  private createMenuButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): void {
    const btn = this.add
      .rectangle(x, y, width, height, PALETTE.candle.num)
      .setStrokeStyle(1, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, x, y, label, {
      size: 12,
      color: PALETTE.ink.hex,
      origin: 0.5,
    });

    btn.on('pointerover', () => {
      btn.setFillStyle(PALETTE.lampYellow.num);
    });
    btn.on('pointerout', () => {
      btn.setFillStyle(PALETTE.candle.num);
    });
    btn.on('pointerdown', onClick);
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
