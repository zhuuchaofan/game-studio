import Phaser from 'phaser';
import {
  advanceCustomer,
  BALANCE,
  createInitialState,
  formatSignedDelta,
  PALETTE,
  parseHexColor,
  quotePrice,
  resolveOffer,
  settle,
  TIER_ORDER,
  toDebugSnapshot,
  wrapCjkText,
  type OfferTier,
  type PawnItem,
  type PawnshopState,
} from '../game/pawnshop';
import { createRngFromUrl, type RngFn } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

const HUD_HEIGHT = 22;
const PANEL_CENTER_Y = 75;
const PANEL_HEIGHT = 92;
const BUTTON_ROW_Y = 151;
const STORY_WRAP_CHARS = 15;

export class PawnshopScene extends Phaser.Scene {
  private state!: PawnshopState;
  private rng!: RngFn;
  private contentLayer!: Phaser.GameObjects.Container;
  private hudMoneyText!: Phaser.GameObjects.Text;
  private hudRepText!: Phaser.GameObjects.Text;
  private hudDeckText!: Phaser.GameObjects.Text;
  private hudProgressText!: Phaser.GameObjects.Text;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'PawnshopScene' });
  }

  create(): void {
    const { rng } = createRngFromUrl();
    this.rng = rng;
    this.state = createInitialState();

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => toDebugSnapshot(this.state),
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

    const labelStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: PALETTE.candle.hex,
      resolution: 1,
    };
    const numStyle: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: PALETTE.lampYellow.hex,
      resolution: 1,
    };

    this.add.text(8, hudY, '钱:', labelStyle).setOrigin(0, 0.5);
    this.hudMoneyText = this.add.text(28, hudY, '', numStyle).setOrigin(0, 0.5);

    this.add.text(88, hudY, '口碑:', labelStyle).setOrigin(0, 0.5);
    this.hudRepText = this.add
      .text(124, hudY, '', { ...numStyle, color: PALETTE.brass.hex })
      .setOrigin(0, 0.5);

    this.add.text(165, hudY, '牌组:', labelStyle).setOrigin(0, 0.5);
    this.hudDeckText = this.add.text(199, hudY, '', numStyle).setOrigin(0, 0.5);

    this.hudProgressText = this.add
      .text(BASE_WIDTH - 8, hudY, '', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: PALETTE.oldPaper.hex,
        resolution: 1,
      })
      .setOrigin(1, 0.5);
  }

  private updateHud(): void {
    this.hudMoneyText.setText(`${this.state.money}`);
    this.hudRepText.setText(`${this.state.reputation}`);
    this.hudDeckText.setText(`${this.state.deck.length}`);

    if (this.state.phase === 'summary') {
      this.hudProgressText.setText('白天结束');
    } else {
      const current = Math.min(this.state.customerIndex + 1, this.state.items.length);
      this.hudProgressText.setText(`当客 ${current}/${this.state.items.length}`);
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
      this.add
        .text(82, 37, item.name, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.ink.hex,
          resolution: 1,
        })
        .setOrigin(0, 0),
    );

    this.contentLayer.add(
      this.add
        .text(BASE_WIDTH - 18, 37, `牌:${item.cardName}(${item.cardCost}费)`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.copperBrown.hex,
          resolution: 1,
        })
        .setOrigin(1, 0),
    );

    this.contentLayer.add(this.add.rectangle(191, 55, 218, 1, PALETTE.oldPaper.num));

    // 一句故事
    this.contentLayer.add(
      this.add
        .text(82, 62, wrapCjkText(item.story, STORY_WRAP_CHARS), {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.deepWood.hex,
          lineSpacing: 5,
          resolution: 1,
        })
        .setOrigin(0, 0),
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
      this.add
        .text(82, 37, outcome.message, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: headlineColor,
          resolution: 1,
        })
        .setOrigin(0, 0),
    );

    this.contentLayer.add(this.add.rectangle(191, 55, 218, 1, PALETTE.oldPaper.num));

    const detailLines = outcome.accepted
      ? [
          `出价 ${outcome.price}元 · 口碑 ${formatSignedDelta(outcome.reputationDelta)}`,
          `牌组加入：${outcome.item.cardName}（${outcome.item.cardCost}费）`,
        ]
      : ['钱、口碑、牌组均无变化', `未收下${outcome.item.name}`];

    this.contentLayer.add(
      this.add
        .text(82, 63, detailLines.join('\n'), {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.ink.hex,
          lineSpacing: 6,
          resolution: 1,
        })
        .setOrigin(0, 0),
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
      this.add
        .text(centerX, 39, '白天结束', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.lampYellow.hex,
          resolution: 1,
        })
        .setOrigin(0.5),
    );

    // 钱与口碑摘要条
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 66, cardWidth - 18, 22, PALETTE.deepWood.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    this.contentLayer.add(
      this.add
        .text(34, 66, '钱:', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.candle.hex,
          resolution: 1,
        })
        .setOrigin(0, 0.5),
    );
    this.contentLayer.add(
      this.add
        .text(56, 66, `${this.state.money}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.lampYellow.hex,
          resolution: 1,
        })
        .setOrigin(0, 0.5),
    );

    this.contentLayer.add(
      this.add
        .text(centerX + 8, 66, '口碑:', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.candle.hex,
          resolution: 1,
        })
        .setOrigin(0, 0.5),
    );
    this.contentLayer.add(
      this.add
        .text(centerX + 44, 66, `${this.state.reputation}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.brass.hex,
          resolution: 1,
        })
        .setOrigin(0, 0.5),
    );

    // 牌组列表
    this.contentLayer.add(
      this.add
        .text(28, 84, `收到牌组（${this.state.deck.length}张）：`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.ink.hex,
          resolution: 1,
        })
        .setOrigin(0, 0),
    );

    if (this.state.deck.length === 0) {
      this.contentLayer.add(
        this.add
          .text(centerX, 112, '今日未收到新牌', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: PALETTE.copperBrown.hex,
            resolution: 1,
          })
          .setOrigin(0.5),
      );
    } else {
      const slotXs = [72, centerX, BASE_WIDTH - 72];
      this.state.deck.forEach((cardName, index) => {
        const x = slotXs[index] ?? centerX;
        const matchedItem = this.state.items.find((item) => item.cardName === cardName);
        const stripColor = matchedItem ? parseHexColor(matchedItem.color) : PALETTE.brass.num;

        this.contentLayer.add(
          this.add
            .rectangle(x, 112, 82, 24, PALETTE.paperWhite.num)
            .setStrokeStyle(1, PALETTE.ink.num),
        );
        this.contentLayer.add(this.add.rectangle(x, 102, 80, 3, stripColor));
        this.contentLayer.add(
          this.add
            .text(x, 114, cardName, {
              fontFamily: 'monospace',
              fontSize: '12px',
              color: PALETTE.ink.hex,
              resolution: 1,
            })
            .setOrigin(0.5),
        );
      });
    }

    // 返回标题按钮
    this.addActionButton(centerX, BUTTON_ROW_Y, 108, 26, '返回标题', null, () => {
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

    // 左侧旧物像素图框
    const boxX = 48;
    const boxY = PANEL_CENTER_Y;
    this.contentLayer.add(
      this.add
        .rectangle(boxX, boxY, 48, 48, PALETTE.paperWhite.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    const graphic = this.add.graphics();
    this.drawItemPixelArt(graphic, item, boxX, boxY);
    this.contentLayer.add(graphic);
  }

  private drawItemPixelArt(
    g: Phaser.GameObjects.Graphics,
    item: PawnItem,
    cx: number,
    cy: number,
  ): void {
    const mainColor = parseHexColor(item.color);

    if (item.id === 'watch') {
      // 表带（木棕 + 墨黑描边）
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 5, cy - 18, 10, 36);
      g.fillStyle(PALETTE.woodBrown.num);
      g.fillRect(cx - 4, cy - 17, 8, 34);
      // 表壳（主色：黄铜）
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 11, cy - 11, 22, 22);
      g.fillStyle(mainColor);
      g.fillRect(cx - 10, cy - 10, 19, 19);
      // 受光高光与表冠
      g.fillStyle(PALETTE.lampYellow.num);
      g.fillRect(cx - 9, cy - 9, 18, 3);
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx + 11, cy - 3, 3, 6);
      g.fillStyle(mainColor);
      g.fillRect(cx + 11, cy - 2, 2, 4);
      // 表盘与指针
      g.fillStyle(PALETTE.paperWhite.num);
      g.fillRect(cx - 7, cy - 7, 14, 14);
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 1, cy - 5, 2, 6);
      g.fillRect(cx, cy - 1, 5, 2);
      return;
    }

    if (item.id === 'ring') {
      // 戒托宝石（纸白 + 灯黄高光）
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 6, cy - 16, 12, 8);
      g.fillStyle(PALETTE.paperWhite.num);
      g.fillRect(cx - 5, cy - 15, 10, 6);
      g.fillStyle(PALETTE.lampYellow.num);
      g.fillRect(cx - 3, cy - 14, 4, 2);
      // 戒环（主色：银蓝）
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 12, cy - 8, 24, 21);
      g.fillStyle(mainColor);
      g.fillRect(cx - 11, cy - 7, 22, 19);
      // 戒环暗面
      g.fillStyle(PALETTE.mistBlue.num);
      g.fillRect(cx - 11, cy + 8, 22, 5);
      // 戒环内孔
      g.fillStyle(PALETTE.ink.num);
      g.fillRect(cx - 7, cy - 3, 14, 12);
      g.fillStyle(PALETTE.paperWhite.num);
      g.fillRect(cx - 6, cy - 2, 12, 10);
      return;
    }

    // 默认旧书（主色：木棕）
    g.fillStyle(PALETTE.ink.num);
    g.fillRect(cx - 13, cy - 14, 26, 28);
    g.fillStyle(mainColor);
    g.fillRect(cx - 12, cy - 13, 24, 26);
    // 书脊暗面与封面高光
    g.fillStyle(PALETTE.deepWood.num);
    g.fillRect(cx - 12, cy - 13, 5, 26);
    g.fillStyle(PALETTE.copperBrown.num);
    g.fillRect(cx - 5, cy - 11, 14, 3);
    // 书页白边与黄铜标题签
    g.fillStyle(PALETTE.candle.num);
    g.fillRect(cx + 8, cy - 11, 3, 22);
    g.fillStyle(PALETTE.brass.num);
    g.fillRect(cx - 4, cy - 4, 10, 6);
    g.fillStyle(PALETTE.ink.num);
    g.fillRect(cx - 2, cy - 2, 6, 2);
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
        this.add
          .text(x, y, topText, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: PALETTE.ink.hex,
            resolution: 1,
          })
          .setOrigin(0.5),
      );
      return;
    }

    this.contentLayer.add(
      this.add
        .text(x, y - 8, topText, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.ink.hex,
          resolution: 1,
        })
        .setOrigin(0.5),
    );

    this.contentLayer.add(
      this.add
        .text(x, y + 8, bottomText, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.ink.hex,
          resolution: 1,
        })
        .setOrigin(0.5),
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
