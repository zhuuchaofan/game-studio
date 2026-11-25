import Phaser from 'phaser';
import cardsJson from '../data/cards.json';
import { ITEM_PIXEL_ART } from '../data/pixelart';
import { audio, installAudioDebugHook } from '../game/audio';
import { buildCardMap, formatEffectDescription, type CardDef } from '../game/battle';
import {
  advanceCustomer,
  BALANCE,
  canAffordTier,
  createInitialState,
  createRedemptionOffer,
  DAILY_CUSTOMER_COUNT,
  deriveDaySeed,
  deriveRedemptionSeed,
  formatReputationHint,
  formatSignedDelta,
  getEffectiveAcceptRate,
  getTierAffordability,
  hasAnyAffordableTier,
  ITEMS,
  PALETTE,
  parseHexColor,
  pickDailyItems,
  quotePrice,
  resolveOffer,
  resolveRedemption,
  settle,
  skipCustomer,
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
  loadPawnPrices,
  loadTutorialDone,
  maxRenqingForLevel,
  saveGame,
  savePawnPrices,
  saveTutorialDone,
  type SaveData,
} from '../game/save';
import {
  advanceTutorialStep,
  cloneTutorialState,
  createTutorialState,
  getTutorialCopy,
  skipTutorial,
  syncTutorialForPawnshop,
  type TutorialState,
} from '../game/tutorial';
import { createTutorialBubble } from '../game/tutorialBubble';
import { createRngFromUrl, mulberry32, type RngFn } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export interface PawnshopSceneData {
  save?: SaveData;
  forceTutorial?: boolean;
}

export const REDEMPTION_ACCEPT_BUTTON = { x: 96, y: 151, width: 124, height: 32 } as const;
export const REDEMPTION_REJECT_BUTTON = { x: 224, y: 151, width: 124, height: 32 } as const;

const CARDS_BY_NAME = buildCardMap(cardsJson as CardDef[]);

const HUD_HEIGHT = 22;
const NEGOTIATING_PANEL_CENTER_Y = 73;
const NEGOTIATING_PANEL_HEIGHT = 96;
const FEEDBACK_PANEL_CENTER_Y = 56;
const FEEDBACK_PANEL_HEIGHT = 64;
const BUTTON_ROW_Y = 154;
const FEEDBACK_NEXT_BUTTON_Y = 154;
const STORY_WRAP_CHARS = 18;
const SKIP_BUTTON_X = 270;
const SKIP_BUTTON_Y = 107;
const SKIP_BUTTON_WIDTH = 64;
const SKIP_BUTTON_HEIGHT = 18;
const TOAST_DURATION_MS = 1400;

export class PawnshopScene extends Phaser.Scene {
  private save!: SaveData;
  private state!: PawnshopState;
  private tutorial!: TutorialState;
  private rng!: RngFn;
  private contentLayer!: Phaser.GameObjects.Container;
  private tutorialBubble?: Phaser.GameObjects.Container;
  private toastContainer?: Phaser.GameObjects.Container;
  private toastTimer?: Phaser.Time.TimerEvent;
  private lastToast: string | null = null;
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

    // 每天开始时按 ?seed= + 天数洗牌当客池并取前 3 位（第 1 天保底含 1 件伤害牌旧物，P6 B2）
    const shuffleRng = mulberry32(deriveDaySeed(seed, this.save.day));
    const dailyItems = pickDailyItems(ITEMS, this.save.day, shuffleRng, DAILY_CUSTOMER_COUNT);

    // 每天当客上门前检查赎当事件（P6 C4：有 ≥1 赎当券且牌库至少 1 张旧物牌，每天最多 1 次）
    const pawnPrices = loadPawnPrices();
    const redeemRng = mulberry32(deriveRedemptionSeed(seed, this.save.day));
    const redemptionOffer = createRedemptionOffer(
      this.save.deck,
      this.save.redeemTickets,
      pawnPrices,
      redeemRng,
      ITEMS,
    );

    this.state = createInitialState({
      day: this.save.day,
      money: this.save.money,
      reputation: this.save.reputation,
      deck: this.save.deck,
      items: dailyItems,
      redeemTickets: this.save.redeemTickets,
      pawnPrices,
      redemptionOffer,
    });

    this.tutorialBubble = undefined;
    this.toastContainer = undefined;
    this.toastTimer = undefined;
    this.lastToast = null;
    this.tutorial = createTutorialState({
      day: this.state.day,
      tutorialDone: loadTutorialDone(),
      forceReplay: data?.forceTutorial,
    });

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => {
        const currentItem = this.state.items[this.state.customerIndex];
        const isNegotiating = this.state.phase === 'negotiating' && Boolean(currentItem);
        const tierAffordability =
          isNegotiating && currentItem
            ? getTierAffordability(this.state.money, currentItem.trueValue)
            : undefined;
        const effectiveAcceptRates = isNegotiating
          ? {
              low: getEffectiveAcceptRate('low', this.state.reputation),
              fair: getEffectiveAcceptRate('fair', this.state.reputation),
              high: getEffectiveAcceptRate('high', this.state.reputation),
            }
          : undefined;
        const activeRedemption =
          this.state.phase === 'redemption' && this.state.redemptionOffer
            ? {
                itemId: this.state.redemptionOffer.item.id,
                itemName: this.state.redemptionOffer.item.name,
                cardName: this.state.redemptionOffer.cardName,
                basePrice: this.state.redemptionOffer.basePrice,
                payout: this.state.redemptionOffer.payout,
              }
            : null;
        return {
          ...toDebugSnapshot(this.state),
          day: this.state.day,
          shopLevel: this.save.shopLevel,
          redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
          maxRenqing: maxRenqingForLevel(this.save.shopLevel),
          itemsOrder: this.state.items.map((item) => item.id),
          canSkip: isNegotiating,
          lastToast: this.lastToast,
          redemptionOffer: activeRedemption,
          ...(tierAffordability ? { tierAffordability } : {}),
          ...(effectiveAcceptRates ? { effectiveAcceptRates } : {}),
          tutorialActive: this.tutorial.active,
          currentStep: this.tutorial.currentStep,
          tutorialDone: this.tutorial.done || loadTutorialDone(),
          tutorialCopy: getTutorialCopy(this.tutorial.currentStep),
        };
      },
    };

    this.drawDaytimeBackdrop();
    this.createHud();
    this.contentLayer = this.add.container(0, 0);

    installAudioDebugHook(audio);
    audio.playBgm('day');

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

    // 墙面暖色窗格
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
    this.add.rectangle(centerX, 122, BASE_WIDTH, 3, PALETTE.copperBrown.num);
    this.add.rectangle(centerX, 124, BASE_WIDTH, 1, PALETTE.ink.num);
    this.add.rectangle(centerX, 152, BASE_WIDTH, 56, PALETTE.deepWood.num);
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

    if (this.state.phase === 'redemption') {
      this.hudProgressText.setText('旧客赎当');
    } else if (this.state.phase === 'summary') {
      this.hudProgressText.setText('白天结束');
    } else {
      const current = Math.min(this.state.customerIndex + 1, this.state.items.length);
      this.hudProgressText.setText(`当客${current}/${this.state.items.length}`);
    }
  }

  private renderCurrentPhase(): void {
    this.updateHud();
    this.contentLayer.removeAll(true);
    this.clearToast(false);

    if (this.state.phase === 'redemption') {
      this.renderRedemption();
    } else if (this.state.phase === 'negotiating') {
      this.renderNegotiating();
    } else if (this.state.phase === 'feedback') {
      this.renderFeedback();
    } else {
      this.renderSummary();
    }

    this.tutorial = syncTutorialForPawnshop(this.tutorial, this.state.phase);
    this.renderTutorialBubble();
  }

  private renderTutorialBubble(): void {
    if (this.tutorialBubble) {
      this.tutorialBubble.destroy();
      this.tutorialBubble = undefined;
    }

    if (!this.tutorial.active || !this.tutorial.currentStep) {
      return;
    }

    this.tutorialBubble = createTutorialBubble(this, this.tutorial.currentStep, {
      onAdvance: () => {
        this.tutorial = advanceTutorialStep(this.tutorial);
        this.renderTutorialBubble();
      },
      onSkip: () => {
        this.tutorial = skipTutorial(this.tutorial);
        saveTutorialDone(true);
        this.renderTutorialBubble();
      },
    });
  }

  private showToast(message: string): void {
    this.clearToast(false);
    this.lastToast = message;

    const centerX = Math.floor(BASE_WIDTH / 2);
    // 轻提示置于当客卡片下半部空白处（y=107），不遮住 y=130 的口碑修正条
    //（原 y=126 会短暂盖住口碑条中间几字，P6 协调员验收时发现并修正）。
    const toastY = 107;
    const width = Math.max(76, message.length * 12 + 20);
    const height = 18;

    const container = this.add.container(0, 0).setDepth(120);
    const bg = this.add
      .rectangle(centerX, toastY, width, height, PALETTE.ink.num)
      .setStrokeStyle(1, PALETTE.vermilion.num);
    const text = addPixelText(this, centerX, toastY, message, {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });
    container.add([bg, text]);
    this.toastContainer = container;

    this.toastTimer = this.time.delayedCall(TOAST_DURATION_MS, () => {
      this.clearToast(false);
    });
  }

  private clearToast(resetRecord = false): void {
    if (this.toastTimer) {
      this.toastTimer.remove(false);
      this.toastTimer = undefined;
    }
    if (this.toastContainer) {
      this.toastContainer.destroy();
      this.toastContainer = undefined;
    }
    if (resetRecord) {
      this.lastToast = null;
    }
  }

  private renderRedemption(): void {
    const offer = this.state.redemptionOffer;
    if (!offer) {
      return;
    }

    this.addTicketPanel(offer.item, NEGOTIATING_PANEL_CENTER_Y, NEGOTIATING_PANEL_HEIGHT, 38, 56);

    const tickets = this.state.redeemTickets ?? this.save.redeemTickets;
    this.contentLayer.add(
      addPixelText(this, 66, 28, '有人回来赎当！', {
        color: PALETTE.vermilion.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 16, 28, `赎当券:${tickets}`, {
        color: PALETTE.copperBrown.hex,
        origin: [1, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(185, 42, 238, 1, PALETTE.oldPaper.num));

    this.contentLayer.add(
      addPixelText(this, 66, 45, `赎回「${offer.item.name}」（牌：${offer.cardName}）`, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 66, 60, wrapCjkText(offer.item.story, STORY_WRAP_CHARS), {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
        lineSpacing: 2,
      }),
    );

    this.contentLayer.add(
      addPixelText(
        this,
        66,
        90,
        `接受:牌离库 钱+${offer.payout} 口碑+1 券-1`,
        {
          color: PALETTE.jade.hex,
          origin: [0, 0],
        },
      ),
    );

    this.contentLayer.add(
      addPixelText(this, 66, 104, '拒绝:牌与赎当券均保留', {
        color: PALETTE.copperBrown.hex,
        origin: [0, 0],
      }),
    );

    this.addActionButton(
      REDEMPTION_ACCEPT_BUTTON.x,
      REDEMPTION_ACCEPT_BUTTON.y,
      REDEMPTION_ACCEPT_BUTTON.width,
      REDEMPTION_ACCEPT_BUTTON.height,
      '接受赎当',
      `+${offer.payout}元`,
      () => this.handleRedemption(true),
      false,
      PALETTE.candle.num,
      PALETTE.lampYellow.num,
    );

    this.addActionButton(
      REDEMPTION_REJECT_BUTTON.x,
      REDEMPTION_REJECT_BUTTON.y,
      REDEMPTION_REJECT_BUTTON.width,
      REDEMPTION_REJECT_BUTTON.height,
      '拒绝赎当',
      '保留纸牌',
      () => this.handleRedemption(false),
      false,
      PALETTE.oldPaper.num,
      PALETTE.lampYellow.num,
    );
  }

  private handleRedemption(accept: boolean): void {
    if (this.state.phase !== 'redemption') {
      return;
    }

    audio.unlock();
    audio.playSfx(accept ? 'deal_closed' : 'button_click');
    this.state = resolveRedemption(this.state, accept);

    this.save = {
      ...this.save,
      money: this.state.money,
      reputation: this.state.reputation,
      deck: [...this.state.deck],
      redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
    };
    saveGame(this.save);
    if (this.state.pawnPrices) {
      savePawnPrices(this.state.pawnPrices);
    }

    this.renderCurrentPhase();
  }

  private renderNegotiating(): void {
    const item = this.state.items[this.state.customerIndex];
    if (!item) {
      return;
    }

    this.addTicketPanel(item, NEGOTIATING_PANEL_CENTER_Y, NEGOTIATING_PANEL_HEIGHT, 38, 52);

    // 物品名与对应牌信息（置于 y=27..39，保证不被教程气泡遮挡）
    this.contentLayer.add(
      addPixelText(this, 66, 27, item.name, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 16, 27, `牌:${item.cardName}(${item.cardCost}费)`, {
        color: PALETTE.copperBrown.hex,
        origin: [1, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(185, 40, 238, 1, PALETTE.oldPaper.num));

    // 当客故事（C2：谈价期间完整可见，位于 y=41..66，严格高于教程气泡 y=80）
    this.contentLayer.add(
      addPixelText(this, 66, 41, wrapCjkText(item.story, STORY_WRAP_CHARS), {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
        lineSpacing: 1,
      }),
    );

    // 卡牌效果说明（C1：收当卡片同步写清效果，位于 y=67..79，高于教程气泡 y=80）
    const cardDef = CARDS_BY_NAME.get(item.cardName);
    if (cardDef) {
      this.contentLayer.add(
        addPixelText(this, 66, 67, `效果:${formatEffectDescription(cardDef)}`, {
          color: PALETTE.copperBrown.hex,
          origin: [0, 0],
        }),
      );
    }

    // 当客卡片右下角：跳过当客按钮
    const noneAffordable = !hasAnyAffordableTier(this.state.money, item.trueValue);
    this.addActionButton(
      SKIP_BUTTON_X,
      SKIP_BUTTON_Y,
      SKIP_BUTTON_WIDTH,
      SKIP_BUTTON_HEIGHT,
      '跳过当客',
      null,
      () => this.handleSkip(),
      false,
      noneAffordable ? PALETTE.lampYellow.num : PALETTE.oldPaper.num,
      noneAffordable ? PALETTE.paperWhite.num : PALETTE.lampYellow.num,
    );

    // 报价区顶部：口碑接受率修正提示（C3）
    const centerX = Math.floor(BASE_WIDTH / 2);
    const repColor =
      this.state.reputation > 0
        ? PALETTE.lampYellow.hex
        : this.state.reputation < 0
          ? PALETTE.vermilion.hex
          : PALETTE.oldPaper.hex;
    this.contentLayer.add(
      addPixelText(this, centerX, 130, formatReputationHint(this.state.reputation), {
        color: repColor,
        origin: 0.5,
      }),
    );

    // 三档报价按钮：低价 / 平价 / 高价
    const buttonXs = [58, centerX, BASE_WIDTH - 58];
    const buttonWidth = 92;
    const buttonHeight = 32;

    TIER_ORDER.forEach((tier, index) => {
      const x = buttonXs[index];
      const tierConfig = BALANCE.tiers[tier];
      const price = quotePrice(item.trueValue, tier);
      const affordable = canAffordTier(this.state.money, item.trueValue, tier);

      this.addActionButton(
        x,
        BUTTON_ROW_Y,
        buttonWidth,
        buttonHeight,
        tierConfig.label,
        `${price}元`,
        () => this.handleOffer(tier),
        !affordable,
        PALETTE.candle.num,
        PALETTE.lampYellow.num,
        () => this.handleUnaffordableClick(),
      );
    });
  }

  private renderFeedback(): void {
    const outcome = this.state.lastOutcome;
    if (!outcome) {
      return;
    }

    // 紧凑结算面板（y=24..88），确保 3/6 教程气泡（y=92..136）与底部按钮完全不遮挡结算内容
    this.addTicketPanel(outcome.item, FEEDBACK_PANEL_CENTER_Y, FEEDBACK_PANEL_HEIGHT, 36, 56);

    const headlineColor = outcome.accepted ? PALETTE.jade.hex : PALETTE.vermilion.hex;
    this.contentLayer.add(
      addPixelText(this, 60, 26, outcome.message, {
        color: headlineColor,
        origin: [0, 0],
      }),
    );

    if (outcome.accepted) {
      this.contentLayer.add(
        addPixelText(
          this,
          BASE_WIDTH - 14,
          26,
          `${outcome.price}元 口碑${formatSignedDelta(outcome.reputationDelta)}`,
          {
            color: PALETTE.copperBrown.hex,
            origin: [1, 0],
          },
        ),
      );
    }

    this.contentLayer.add(this.add.rectangle(183, 39, 244, 1, PALETTE.oldPaper.num));

    if (outcome.accepted) {
      // C1：收当结算显示卡牌效果说明
      const cardDef = CARDS_BY_NAME.get(outcome.item.cardName);
      const effectDesc = cardDef ? formatEffectDescription(cardDef) : '';
      this.contentLayer.add(
        addPixelText(this, 60, 41, `${outcome.item.cardName}:${effectDesc}`, {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );

      // C2：成交后结算再出现一次该故事（“你收下了……”）
      this.contentLayer.add(
        addPixelText(this, 60, 55, wrapCjkText(`你收下了：${outcome.item.story}`, 20), {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
          lineSpacing: 1,
        }),
      );
    } else {
      this.contentLayer.add(
        addPixelText(this, 60, 44, '钱、口碑、牌组均无变化', {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );
      this.contentLayer.add(
        addPixelText(this, 60, 60, `未收下${outcome.item.name}`, {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );
    }

    const isLastCustomer = this.state.customerIndex >= this.state.items.length - 1;
    const nextLabel = isLastCustomer ? '白天结束' : '下一位';
    const centerX = Math.floor(BASE_WIDTH / 2);

    this.addActionButton(centerX, FEEDBACK_NEXT_BUTTON_Y, 118, 26, nextLabel, null, () => {
      audio.unlock();
      audio.playSfx('button_click');
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
    this.addActionButton(88, 151, 122, 26, '进入夜里牌局', null, () => {
      audio.unlock();
      audio.playSfx('button_click');
      const updatedSave: SaveData = {
        ...this.save,
        day: this.state.day,
        money: this.state.money,
        reputation: this.state.reputation,
        deck: [...this.state.deck],
        redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
      };

      this.scene.start('TransitionScene', {
        next: 'CardBattleScene',
        payload: {
          deck: [...this.state.deck],
          demonId: demonIdForDay(updatedSave.day),
          maxRenqing: maxRenqingForLevel(updatedSave.shopLevel),
          save: updatedSave,
          tutorial: cloneTutorialState(this.tutorial),
        },
      });
    });

    this.addActionButton(224, 151, 138, 26, '返回标题', null, () => {
      audio.unlock();
      audio.playSfx('button_click');
      this.scene.start('TitleScene');
    });
  }

  private addTicketPanel(
    item: PawnItem,
    panelCenterY: number,
    panelHeight: number,
    boxX: number,
    boxY: number,
  ): void {
    const centerX = Math.floor(BASE_WIDTH / 2);

    this.contentLayer.add(
      this.add
        .rectangle(centerX, panelCenterY, BASE_WIDTH - 20, panelHeight, PALETTE.candle.num)
        .setStrokeStyle(1, PALETTE.ink.num),
    );

    // 左侧旧物 32×32 真像素插画框（40×40）
    this.contentLayer.add(
      this.add
        .rectangle(boxX, boxY, 40, 40, PALETTE.paperWhite.num)
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
    disabled = false,
    fillColor: number = PALETTE.candle.num,
    hoverColor: number = PALETTE.lampYellow.num,
    onDisabledClick?: () => void,
  ): void {
    // A3：买不起的档位采用深木灰显样式（16 色板内：深木底 + 木棕边 + 铜棕字，避免原银蓝底像“蓝高亮”），
    // 点击时绝不触发成交/扣钱/RNG，仅给出“钱不够”轻提示。
    const textColor = disabled ? PALETTE.copperBrown.hex : PALETTE.ink.hex;
    if (disabled) {
      const bg = this.add
        .rectangle(x, y, width, height, PALETTE.deepWood.num)
        .setStrokeStyle(1, PALETTE.woodBrown.num);
      if (onDisabledClick) {
        bg.setInteractive({ useHandCursor: false });
        bg.on('pointerdown', onDisabledClick);
      }
      this.contentLayer.add(bg);
    } else {
      const bg = this.add
        .rectangle(x, y, width, height, fillColor)
        .setStrokeStyle(1, PALETTE.ink.num)
        .setInteractive({ useHandCursor: true });

      bg.on('pointerover', () => {
        bg.setFillStyle(hoverColor);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(fillColor);
      });
      bg.on('pointerdown', onClick);

      this.contentLayer.add(bg);
    }

    if (bottomText === null) {
      this.contentLayer.add(
        addPixelText(this, x, y, topText, {
          color: textColor,
          origin: 0.5,
        }),
      );
      return;
    }

    this.contentLayer.add(
      addPixelText(this, x, y - 7, topText, {
        color: textColor,
        origin: 0.5,
      }),
    );

    this.contentLayer.add(
      addPixelText(this, x, y + 7, bottomText, {
        color: textColor,
        origin: 0.5,
      }),
    );
  }

  private handleUnaffordableClick(): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }
    this.showToast('钱不够');
  }

  private handleSkip(): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }

    audio.unlock();
    audio.playSfx('button_click');
    this.state = skipCustomer(this.state);
    this.renderCurrentPhase();
  }

  private handleOffer(tier: OfferTier): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }

    // 钱不能变负数：买不起的档位直接 return（并提示“钱不够”），且必须在 resolveOffer 之前，
    // 否则会消耗 RNG、固定种子下的接受序列会漂移。
    const item = this.state.items[this.state.customerIndex];
    if (!item || !canAffordTier(this.state.money, item.trueValue, tier)) {
      this.showToast('钱不够');
      return;
    }

    audio.unlock();
    // C3：口碑影响低价与平价接受率，高价 100% 不变
    const rate = getEffectiveAcceptRate(tier, this.state.reputation);
    const accepted = resolveOffer(rate, this.rng);
    this.state = settle(this.state, tier, accepted);
    if (accepted) {
      if (this.state.pawnPrices) {
        savePawnPrices(this.state.pawnPrices);
      }
      audio.playSfx('deal_closed');
      this.time.delayedCall(140, () => {
        if (this.scene.isActive()) {
          audio.playSfx('receive_card');
        }
      });
    } else {
      audio.playSfx('button_click');
    }
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
      this.clearToast(false);
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
