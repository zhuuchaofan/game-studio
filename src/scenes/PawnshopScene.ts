import Phaser from 'phaser';
import { ITEM_PIXEL_ART } from '../data/pixelart';
import {
  advanceCustomer,
  BALANCE,
  createInitialState,
  DAILY_CUSTOMER_COUNT,
  deriveDaySeed,
  formatSignedDelta,
  ITEMS,
  PALETTE,
  parseHexColor,
  quotePrice,
  resolveOffer,
  settle,
  shuffleItems,
  TIER_ORDER,
  toDebugSnapshot,
  wrapCjkText,
  type OfferTier,
  type PawnItem,
  type PawnshopState,
} from '../game/pawnshop';
import { pixelRowsToTexture } from '../game/pixelart';
import { addPixelText } from '../game/pixelFont';
import {
  createNewGame,
  demonIdForDay,
  maxRenqingForLevel,
  type SaveData,
} from '../game/save';
import { createRngFromUrl, mulberry32, type RngFn } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export interface PawnshopSceneData {
  save?: SaveData;
}

const HUD_HEIGHT = 22;
const PANEL_CENTER_Y = 75;
const PANEL_HEIGHT = 92;
const BUTTON_ROW_Y = 151;
const STORY_WRAP_CHARS = 15;

export class PawnshopScene extends Phaser.Scene {
  private save!: SaveData;
  private state!: PawnshopState;
  private rng!: RngFn;
  private contentLayer!: Phaser.GameObjects.Container;
  private hudMoneyText!: Phaser.GameObjects.BitmapText;
  private hudRepText!: Phaser.GameObjects.BitmapText;
  private hudDeckText!: Phaser.GameObjects.BitmapText;
  private hudProgressText!: Phaser.GameObjects.BitmapText;
  private hudDayText!: Phaser.GameObjects.BitmapText;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'PawnshopScene' });
  }

  create(data?: PawnshopSceneData): void {
    this.save = data?.save
      ? { ...data.save, deck: [...data.save.deck] }
      : createNewGame();

    const { seed, rng } = createRngFromUrl();
    this.rng = rng;

    // 每天开始时按 ?seed= + 天数洗牌当客池并取前 3 位（Fisher-Yates，固定种子可复现）
    const shuffleRng = mulberry32(deriveDaySeed(seed, this.save.day));
    const shuffledItems = shuffleItems(ITEMS, shuffleRng).slice(0, DAILY_CUSTOMER_COUNT);

    this.state = createInitialState({
      day: this.save.day,
      money: this.save.money,
      reputation: this.save.reputation,
      deck: this.save.deck,
      items: shuffledItems,
    });

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => ({
        ...toDebugSnapshot(this.state),
        day: this.state.day,
        shopLevel: this.save.shopLevel,
        redeemTickets: this.save.redeemTickets,
        maxRenqing: maxRenqingForLevel(this.save.shopLevel),
        itemsOrder: this.state.items.map((item) => item.id),
      }),
    };

    this.drawDaytimeBackdrop();
    this.createHud();
    this.contentLayer = this.add.container(0, 0);

    this.renderCurrentPhase();
    this.syncInputBounds();
  }

  private drawDaytimeBackdrop(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);

    // 白天当铺暖色木墙
    this.add.rectangle(
      centerX,
      Math.floor((BASE_HEIGHT + HUD_HEIGHT) / 2),
      BASE_WIDTH,
      BASE_HEIGHT - HUD_HEIGHT,
      PALETTE.woodBrown.num,
    );

    // 墙面暖色窗格（置于卡片后方，避免在结算卡片外侧露出碎边）
    this.add
      .rectangle(BASE_WIDTH - 48, 48, 44, 34, PALETTE.candle.num)
      .setStrokeStyle(1, PALETTE.deepWood.num);
    this.add.rectangle(BASE_WIDTH - 48, 48, 36, 26, PALETTE.oldPaper.num);
    this.add.rectangle(BASE_WIDTH - 48, 48, 2, 34, PALETTE.deepWood.num);
    this.add.rectangle(BASE_WIDTH - 48, 48, 44, 2, PALETTE.deepWood.num);

    // 货架木格线
    this.add.rectangle(centerX, 34, BASE_WIDTH, 2, PALETTE.deepWood.num);
    this.add.rectangle(centerX, 68, BASE_WIDTH, 2, PALETTE.deepWood.num);

    // 当铺木柜台与操作区底板
    this.add.rectangle(centerX, 125, BASE_WIDTH, 4, PALETTE.copperBrown.num);
    this.add.rectangle(centerX, 127, BASE_WIDTH, 1, PALETTE.ink.num);
    this.add.rectangle(centerX, 154, BASE_WIDTH, 52, PALETTE.deepWood.num);
  }

  private createHud(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const hudY = Math.floor(HUD_HEIGHT / 2);

    this.add.rectangle(centerX, hudY, BASE_WIDTH, HUD_HEIGHT, PALETTE.deepWood.num);
    this.add.rectangle(centerX, HUD_HEIGHT - 1, BASE_WIDTH, 1, PALETTE.brass.num);
    this.add.rectangle(centerX, HUD_HEIGHT, BASE_WIDTH, 1, PALETTE.ink.num);

    addPixelText(this, 6, hudY, '钱:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudMoneyText = addPixelText(this, 24, hudY, '', {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    addPixelText(this, 60, hudY, '口碑:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudRepText = addPixelText(this, 90, hudY, '', {
      color: PALETTE.brass.hex,
      origin: [0, 0.5],
    });

    addPixelText(this, 114, hudY, '牌:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudDeckText = addPixelText(this, 132, hudY, '', {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    this.hudProgressText = addPixelText(this, 258, hudY, '', {
      color: PALETTE.oldPaper.hex,
      origin: [1, 0.5],
    });

    this.hudDayText = addPixelText(this, BASE_WIDTH - 6, hudY, '', {
      color: PALETTE.paperWhite.hex,
      origin: [1, 0.5],
    });
  }

  private updateHud(): void {
    this.hudMoneyText.setText(`${this.state.money}`);
    this.hudRepText.setText(`${this.state.reputation}`);
    this.hudDeckText.setText(`${this.state.deck.length}`);
    this.hudDayText.setText(`第${this.state.day}天`);

    if (this.state.phase === 'summary') {
      this.hudProgressText.setText('白天结束');
    } else {
      const current = Math.min(this.state.customerIndex + 1, this.state.items.length);
      this.hudProgressText.setText(`当客${current}/${this.state.items.length}`);
    }
  }

  private renderCurrentPhase(): void {
    this.updateHud();
    this.contentLayer.removeAll(true);

    if (this.state.phase === 'negotiating') {
      this.renderNegotiating();
    } else if (this.state.phase === 'feedback') {
      this.renderFeedback();
    } else {
      this.renderSummary();
    }
  }

  private renderNegotiating(): void {
    const item = this.state.items[this.state.customerIndex];
    if (!item) {
      return;
    }

    this.addTicketPanel(item);

    // 物品名与对应牌信息
    this.contentLayer.add(
      addPixelText(this, 82, 37, item.name, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 18, 37, `牌:${item.cardName}(${item.cardCost}费)`, {
        color: PALETTE.copperBrown.hex,
        origin: [1, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(191, 55, 218, 1, PALETTE.oldPaper.num));

    // 一句故事
    this.contentLayer.add(
      addPixelText(this, 82, 62, wrapCjkText(item.story, STORY_WRAP_CHARS), {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
        lineSpacing: 5,
      }),
    );

    // 三档报价按钮：低价 / 平价 / 高价
    const centerX = Math.floor(BASE_WIDTH / 2);
    const buttonXs = [58, centerX, BASE_WIDTH - 58];
    const buttonWidth = 92;
    const buttonHeight = 36;

    TIER_ORDER.forEach((tier, index) => {
      const x = buttonXs[index];
      const tierConfig = BALANCE.tiers[tier];
      const price = quotePrice(item.trueValue, tier);

      this.addActionButton(
        x,
        BUTTON_ROW_Y,
        buttonWidth,
        buttonHeight,
        tierConfig.label,
        `${price}元`,
        () => this.handleOffer(tier),
      );
    });
  }

  private renderFeedback(): void {
    const outcome = this.state.lastOutcome;
    if (!outcome) {
      return;
    }

    this.addTicketPanel(outcome.item);

    const headlineColor = outcome.accepted ? PALETTE.jade.hex : PALETTE.vermilion.hex;
    this.contentLayer.add(
      addPixelText(this, 82, 37, outcome.message, {
        color: headlineColor,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(191, 55, 218, 1, PALETTE.oldPaper.num));

    const detailLines = outcome.accepted
      ? [
          `出价 ${outcome.price}元 · 口碑 ${formatSignedDelta(outcome.reputationDelta)}`,
          `牌组加入：${outcome.item.cardName}（${outcome.item.cardCost}费）`,
        ]
      : ['钱、口碑、牌组均无变化', `未收下${outcome.item.name}`];

    this.contentLayer.add(
      addPixelText(this, 82, 63, detailLines.join('\n'), {
        color: PALETTE.ink.hex,
        origin: [0, 0],
        lineSpacing: 6,
      }),
    );

    const isLastCustomer = this.state.customerIndex >= this.state.items.length - 1;
    const nextLabel = isLastCustomer ? '白天结束' : '下一位';
    const centerX = Math.floor(BASE_WIDTH / 2);

    this.addActionButton(centerX, BUTTON_ROW_Y, 118, 28, nextLabel, null, () => {
      this.state = advanceCustomer(this.state);
      this.renderCurrentPhase();
    });
  }

  private renderSummary(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const cardWidth = BASE_WIDTH - 32;

    // 结算主卡片
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 99, cardWidth, 142, PALETTE.candle.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    // 标题条
    this.contentLayer.add(this.add.rectangle(centerX, 39, cardWidth, 22, PALETTE.deepWood.num));
    this.contentLayer.add(
      addPixelText(this, centerX, 39, `第${this.state.day}天 · 白天结束`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    );

    // 钱与口碑摘要条
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 64, cardWidth - 18, 20, PALETTE.deepWood.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    this.contentLayer.add(
      addPixelText(this, 34, 64, '钱:', {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
    );
    this.contentLayer.add(
      addPixelText(this, 54, 64, `${this.state.money}`, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, centerX + 8, 64, '口碑:', {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
    );
    this.contentLayer.add(
      addPixelText(this, centerX + 42, 64, `${this.state.reputation}`, {
        color: PALETTE.brass.hex,
        origin: [0, 0.5],
      }),
    );

    // 牌组列表
    this.contentLayer.add(
      addPixelText(this, 28, 80, `当前牌组（${this.state.deck.length}张）：`, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    if (this.state.deck.length === 0) {
      this.contentLayer.add(
        addPixelText(this, centerX, 112, '今日未收到新牌', {
          color: PALETTE.copperBrown.hex,
          origin: 0.5,
        }),
      );
    } else if (this.state.deck.length <= 3) {
      const slotXs = [72, centerX, BASE_WIDTH - 72];
      this.state.deck.forEach((cardName, index) => {
        const x = slotXs[index] ?? centerX;
        const matchedItem = ITEMS.find((item) => item.cardName === cardName);
        const stripColor = matchedItem ? parseHexColor(matchedItem.color) : PALETTE.brass.num;

        this.contentLayer.add(
          this.add
            .rectangle(x, 112, 82, 24, PALETTE.paperWhite.num)
            .setStrokeStyle(1, PALETTE.ink.num),
        );
        this.contentLayer.add(this.add.rectangle(x, 102, 80, 3, stripColor));
        this.contentLayer.add(
          addPixelText(this, x, 114, cardName, {
            color: PALETTE.ink.hex,
            origin: 0.5,
          }),
        );
      });
    } else {
      // 多天累计牌组超过 3 张时，分两行紧凑展示，防止重叠
      const slotXs = [72, centerX, BASE_WIDTH - 72];
      const maxSlots = 6;
      const visible = this.state.deck.slice(0, this.state.deck.length > maxSlots ? 5 : maxSlots);
      visible.forEach((cardName, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = slotXs[col];
        const y = row === 0 ? 104 : 124;
        const matchedItem = ITEMS.find((item) => item.cardName === cardName);
        const stripColor = matchedItem ? parseHexColor(matchedItem.color) : PALETTE.brass.num;

        this.contentLayer.add(
          this.add
            .rectangle(x, y, 82, 16, PALETTE.paperWhite.num)
            .setStrokeStyle(1, PALETTE.ink.num),
        );
        this.contentLayer.add(this.add.rectangle(x, y - 6, 80, 2, stripColor));
        this.contentLayer.add(
          addPixelText(this, x, y + 1, cardName, {
            color: PALETTE.ink.hex,
            origin: 0.5,
          }),
        );
      });
      if (this.state.deck.length > maxSlots) {
        this.contentLayer.add(
          addPixelText(this, slotXs[2], 125, `等${this.state.deck.length}张`, {
            color: PALETTE.copperBrown.hex,
            origin: 0.5,
          }),
        );
      }
    }

    // 进入夜里牌局按钮（经 6 帧拉灯转场）+ 返回标题按钮（保留 (160, 151) 在“返回标题”命中区内兼容既有 E2E）
    this.addActionButton(88, BUTTON_ROW_Y, 122, 26, '进入夜里牌局', null, () => {
      const updatedSave: SaveData = {
        ...this.save,
        day: this.state.day,
        money: this.state.money,
        reputation: this.state.reputation,
        deck: [...this.state.deck],
      };

      this.scene.start('TransitionScene', {
        next: 'CardBattleScene',
        payload: {
          deck: [...this.state.deck],
          demonId: demonIdForDay(updatedSave.day),
          maxRenqing: maxRenqingForLevel(updatedSave.shopLevel),
          save: updatedSave,
        },
      });
    });

    this.addActionButton(224, BUTTON_ROW_Y, 138, 26, '返回标题', null, () => {
      this.scene.start('TitleScene');
    });
  }

  private addTicketPanel(item: PawnItem): void {
    const centerX = Math.floor(BASE_WIDTH / 2);

    this.contentLayer.add(
      this.add
        .rectangle(centerX, PANEL_CENTER_Y, BASE_WIDTH - 24, PANEL_HEIGHT, PALETTE.candle.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    // 左侧旧物 32×32 真像素插画框
    const boxX = 48;
    const boxY = PANEL_CENTER_Y;
    this.contentLayer.add(
      this.add
        .rectangle(boxX, boxY, 48, 48, PALETTE.paperWhite.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    const rows = ITEM_PIXEL_ART[item.id] ?? ITEM_PIXEL_ART.old_book;
    const texKey = pixelRowsToTexture(this, `item-art-${item.id}`, rows);
    const sprite = this.add.image(boxX, boxY, texKey).setOrigin(0.5);
    this.contentLayer.add(sprite);
  }

  private addActionButton(
    x: number,
    y: number,
    width: number,
    height: number,
    topText: string,
    bottomText: string | null,
    onClick: () => void,
  ): void {
    const bg = this.add
      .rectangle(x, y, width, height, PALETTE.candle.num)
      .setStrokeStyle(1, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => {
      bg.setFillStyle(PALETTE.lampYellow.num);
    });
    bg.on('pointerout', () => {
      bg.setFillStyle(PALETTE.candle.num);
    });
    bg.on('pointerdown', onClick);

    this.contentLayer.add(bg);

    if (bottomText === null) {
      this.contentLayer.add(
        addPixelText(this, x, y, topText, {
          color: PALETTE.ink.hex,
          origin: 0.5,
        }),
      );
      return;
    }

    this.contentLayer.add(
      addPixelText(this, x, y - 8, topText, {
        color: PALETTE.ink.hex,
        origin: 0.5,
      }),
    );

    this.contentLayer.add(
      addPixelText(this, x, y + 8, bottomText, {
        color: PALETTE.ink.hex,
        origin: 0.5,
      }),
    );
  }

  private handleOffer(tier: OfferTier): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }

    const rate = BALANCE.tiers[tier].acceptRate;
    const accepted = resolveOffer(rate, this.rng);
    this.state = settle(this.state, tier, accepted);
    this.renderCurrentPhase();
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
