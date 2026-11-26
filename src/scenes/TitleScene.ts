import Phaser from 'phaser';
import { audio, installAudioDebugHook } from '../game/audio';
import { buildEndingLedger, formatTitleSettlementSummary } from '../game/bossComposition';
import { BALANCE, ITEMS, PALETTE, SHOPKEEPER_OPENING_NOTE_LINES } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import {
  clearPawnPrices,
  createNewGame,
  loadSaveDetailed,
  loadTutorialDone,
  maxRenqingForLevel,
  saveGame,
} from '../game/save';
import {
  TITLE_CALENDAR_BUTTON,
  TITLE_COMPLETED_CALENDAR_BUTTON,
  TITLE_COMPLETED_START_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
  TITLE_TUTORIAL_BUTTON,
  TITLE_VOLUME_BUTTON,
} from '../game/layout';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export {
  TITLE_CALENDAR_BUTTON,
  TITLE_COMPLETED_CALENDAR_BUTTON,
  TITLE_COMPLETED_START_BUTTON,
  TITLE_CONTINUE_BUTTON,
  TITLE_START_BUTTON,
  TITLE_TUTORIAL_BUTTON,
  TITLE_VOLUME_BUTTON,
} from '../game/layout';

export const GAME_VERSION = 'v0.4.5-NightStakes';
export const TITLE_TUTORIAL_LABEL = '新手局';

export class TitleScene extends Phaser.Scene {
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'TitleScene' });
  }

  create(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const loadResult = loadSaveDetailed();
    const existingSave = loadResult.save;
    const isCompletedShowcase =
      !loadResult.quarantinedCorrupt &&
      existingSave !== null &&
      existingSave.chapter.chapter1Completed &&
      existingSave.chapter.status === 'completed';
    const titleEndingLedger = isCompletedShowcase
      ? buildEndingLedger(existingSave.deck, existingSave.chapter, ITEMS)
      : null;
    const titleCompletedTeaser = isCompletedShowcase ? '第2章「站稳招牌」· 未完待续' : null;
    const titleSettlementLine = isCompletedShowcase
      ? formatTitleSettlementSummary(existingSave.money, existingSave.chapter)
      : null;

    audio.stopBgm();
    installAudioDebugHook(audio);

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
        corruptSaveQuarantined: loadResult.quarantinedCorrupt,
        chapter: existingSave?.chapter,
        shopkeeperNote: SHOPKEEPER_OPENING_NOTE_LINES.join('\n'),
        tutorialActive: false,
        currentStep: null,
        tutorialDone: loadTutorialDone(),
        version: GAME_VERSION,
        tutorialButtonLabel: TITLE_TUTORIAL_LABEL,
        titleCompletedTeaser,
        titleSettlementLine,
        titleEndingLedger,
      }),
    };

    // 背景与金色边框卡片（640×360 16 色像素风）
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num);
    this.add
      .rectangle(centerX, centerY, BASE_WIDTH - 32, BASE_HEIGHT - 32, PALETTE.deepWood.num)
      .setStrokeStyle(4, PALETTE.brass.num);

    // 四角黄铜像素点缀
    const cornerInset = 24;
    this.add.rectangle(cornerInset, cornerInset, 8, 8, PALETTE.lampYellow.num);
    this.add.rectangle(BASE_WIDTH - cornerInset, cornerInset, 8, 8, PALETTE.lampYellow.num);
    this.add.rectangle(cornerInset, BASE_HEIGHT - cornerInset, 8, 8, PALETTE.lampYellow.num);
    this.add.rectangle(
      BASE_WIDTH - cornerInset,
      BASE_HEIGHT - cornerInset,
      8,
      8,
      PALETTE.lampYellow.num,
    );

    // 标题：PAWN SHOP CARDS（48px 4× 位图大字）+ 当铺纸牌（24px 金色字）
    addPixelText(this, centerX, 58, 'PAWN SHOP CARDS', {
      size: 48,
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });

    addPixelText(this, centerX, 102, '当铺纸牌', {
      color: PALETTE.lampYellow.hex,
      origin: 0.5,
    });

    this.add.rectangle(centerX, 122, 280, 2, PALETTE.brass.num);
    this.add.rectangle(centerX - 140, 122, 6, 6, PALETTE.lampYellow.num);
    this.add.rectangle(centerX + 140, 122, 6, 6, PALETTE.lampYellow.num);

    const hasStatusLine =
      loadResult.quarantinedCorrupt ||
      existingSave?.chapter.status === 'failed' ||
      Boolean(existingSave?.chapter.chapter1Completed);
    const noteCenterY = isCompletedShowcase ? 160 : hasStatusLine ? 162 : 172;
    const noteHeight = isCompletedShowcase ? 58 : hasStatusLine ? 62 : 68;

    this.add
      .rectangle(centerX, noteCenterY, BASE_WIDTH - 64, noteHeight, PALETTE.ink.num)
      .setStrokeStyle(2, PALETTE.brass.num);
    addPixelText(this, centerX, noteCenterY - (isCompletedShowcase ? 13 : 14), SHOPKEEPER_OPENING_NOTE_LINES[0], {
      color: PALETTE.candle.hex,
      origin: 0.5,
    });
    addPixelText(this, centerX, noteCenterY + (isCompletedShowcase ? 13 : 14), SHOPKEEPER_OPENING_NOTE_LINES[1], {
      color: PALETTE.lampYellow.hex,
      origin: 0.5,
    });

    if (loadResult.quarantinedCorrupt) {
      this.add
        .rectangle(centerX, 214, 340, 28, PALETTE.vermilion.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      addPixelText(this, centerX, 214, '旧存档损坏，已备份隔离', {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      });
    } else if (existingSave?.chapter.status === 'failed') {
      this.add
        .rectangle(centerX, 214, 360, 28, PALETTE.vermilion.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      addPixelText(this, centerX, 214, '第1章未通关 · 可重开第1章', {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      });
    } else if (isCompletedShowcase) {
      this.add
        .rectangle(centerX, 222, 368, 52, PALETTE.jade.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      addPixelText(this, centerX, 210, '第1章·已完成', {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      });
      addPixelText(this, centerX, 234, titleCompletedTeaser ?? '', {
        color: PALETTE.candle.hex,
        origin: 0.5,
      });
      if (titleSettlementLine) {
        addPixelText(this, centerX, 315, titleSettlementLine, {
          color: PALETTE.candle.hex,
          origin: 0.5,
        });
      }
    } else if (existingSave?.chapter.chapter1Completed) {
      this.add
        .rectangle(centerX, 214, 220, 28, PALETTE.jade.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      addPixelText(this, centerX, 214, '第1章·已完成', {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      });
    }

    const startBtnRect = isCompletedShowcase ? TITLE_COMPLETED_START_BUTTON : TITLE_START_BUTTON;
    const calendarBtnRect = isCompletedShowcase
      ? TITLE_COMPLETED_CALENDAR_BUTTON
      : TITLE_CALENDAR_BUTTON;

    // “开始”按钮：烛光底 + 墨黑字 + 1 像素墨黑描边
    this.createMenuButton(
      startBtnRect.x,
      startBtnRect.y,
      startBtnRect.width,
      startBtnRect.height,
      '开始',
      () => {
        const fresh = createNewGame(undefined, existingSave?.chapter);
        clearPawnPrices();
        saveGame(fresh);
        this.scene.start('PawnshopScene', { save: fresh });
      },
    );

    // 有存档且章节进行中时在“开始”按钮下方约 34 像素处显示“继续”按钮；章节已结束/失败时可点“开始”重开第1章
    if (existingSave !== null && existingSave.chapter.status === 'in_progress') {
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

    // 左下角常驻音量开关（开/关，16 色像素风，状态持久化至 localStorage）
    this.createVolumeToggleButton();

    // 右侧常驻“台历”入口：打开独立全屏 7 天老街台历屏
    this.createMenuButton(
      calendarBtnRect.x,
      calendarBtnRect.y,
      calendarBtnRect.width,
      calendarBtnRect.height,
      '台历',
      () => {
        this.scene.start('CalendarMapScene', {
          returnTo: 'TitleScene',
          save: existingSave,
        });
      },
      PALETTE.oldPaper.num,
    );

    // 右下角常驻“教程”入口：重看教程（重新进入第 1 天带引导）
    this.createMenuButton(
      TITLE_TUTORIAL_BUTTON.x,
      TITLE_TUTORIAL_BUTTON.y,
      TITLE_TUTORIAL_BUTTON.width,
      TITLE_TUTORIAL_BUTTON.height,
      TITLE_TUTORIAL_LABEL,
      () => {
        const fresh = createNewGame(undefined, existingSave?.chapter);
        clearPawnPrices();
        this.scene.start('PawnshopScene', { save: fresh, forceTutorial: true });
      },
      PALETTE.oldPaper.num,
    );

    addPixelText(this, centerX, 338, GAME_VERSION, {
      size: 12,
      color: PALETTE.silverBlue.hex,
      origin: 0.5,
    });

    this.syncInputBounds();
  }

  private createVolumeToggleButton(): void {
    const getFill = (muted: boolean): number =>
      muted ? PALETTE.silverBlue.num : PALETTE.oldPaper.num;
    const getHover = (muted: boolean): number =>
      muted ? PALETTE.paperWhite.num : PALETTE.lampYellow.num;
    const getLabel = (muted: boolean): string => (muted ? '音量:关' : '音量:开');

    const btn = this.add
      .rectangle(
        TITLE_VOLUME_BUTTON.x,
        TITLE_VOLUME_BUTTON.y,
        TITLE_VOLUME_BUTTON.width,
        TITLE_VOLUME_BUTTON.height,
        getFill(audio.isMuted()),
      )
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    const label = addPixelText(
      this,
      TITLE_VOLUME_BUTTON.x,
      TITLE_VOLUME_BUTTON.y,
      getLabel(audio.isMuted()),
      {
        color: PALETTE.ink.hex,
        origin: 0.5,
      },
    );

    btn.on('pointerover', () => {
      btn.setFillStyle(getHover(audio.isMuted()));
    });
    btn.on('pointerout', () => {
      btn.setFillStyle(getFill(audio.isMuted()));
    });
    btn.on('pointerdown', () => {
      const nextMuted = audio.toggleMute();
      label.setText(getLabel(nextMuted));
      btn.setFillStyle(getFill(nextMuted));
      audio.playSfx('button_click');
    });
  }

  private createMenuButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
    fillColor: number = PALETTE.candle.num,
  ): void {
    const btn = this.add
      .rectangle(x, y, width, height, fillColor)
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, x, y, label, {
      color: PALETTE.ink.hex,
      origin: 0.5,
    });

    btn.on('pointerover', () => {
      btn.setFillStyle(PALETTE.lampYellow.num);
    });
    btn.on('pointerout', () => {
      btn.setFillStyle(fillColor);
    });
    btn.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      onClick();
    });
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
