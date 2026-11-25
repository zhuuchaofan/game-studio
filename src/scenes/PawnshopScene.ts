import Phaser from 'phaser';
import cardsJson from '../data/cards.json';
import { ITEM_PIXEL_ART } from '../data/pixelart';
import { audio, installAudioDebugHook } from '../game/audio';
import { buildCardMap, formatEffectDescription, formatEffectShort, type CardDef } from '../game/battle';
import {
  composeBoss,
  formatBossPreviewHpLine,
  type ComposedBossResult,
} from '../game/bossComposition';
import {
  cloneChapterState,
  deriveSideQuestSeed,
  getChapterConfig,
  getNightDemonHpBonus,
  getRedemptionMultiplier,
  getSkipCustomerReputationDelta,
  isBossDay,
  pickSideQuestItem,
  removeCardAtIndex,
  selectDemonForChapterDay,
  type PactId,
} from '../game/chapters';
import {
  advanceCustomer,
  BALANCE,
  BRIDE_RING_CARD_NAME,
  BRIDE_RING_ITEM_ID,
  canAffordTier,
  createBrideRedemptionOffer,
  createFatherOverdueRedemptionOffer,
  createInitialState,
  createRedemptionOffer,
  DAILY_CUSTOMER_COUNT,
  deriveDaySeed,
  deriveRedemptionSeed,
  FATHER_WATCH_CARD_NAME,
  formatDay3Rumor,
  formatReputationHint,
  formatSignedDelta,
  getEffectiveAcceptRate,
  getTemperamentLabel,
  getTierAffordability,
  hasAnyAffordableTier,
  ITEMS,
  PALETTE,
  parseHexColor,
  pickDailyItems,
  quotePrice,
  REDEMPTION_COOLDOWN_DAYS,
  resolveOffer,
  resolveRedemption,
  settle,
  SHOPKEEPER_OPENING_NOTE_LINES,
  skipCustomer,
  TIER_ORDER,
  toDebugSnapshot,
  wrapCjkText,
  type CustomerTemperament,
  type OfferTier,
  type PawnItem,
  type PawnshopState,
} from '../game/pawnshop';
import { pixelRowsToTexture } from '../game/pixelart';
import { addPixelText } from '../game/pixelFont';
import {
  applyPactToSave,
  createNewGame,
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
import {
  BOSS_PREVIEW_CONFIRM_BUTTON,
  PACT_OPTION_BUTTONS,
  PAWNSHOP_CALENDAR_BUTTON,
  PAWNSHOP_FEEDBACK_NEXT_BUTTON,
  PAWNSHOP_HUD_HEIGHT,
  PAWNSHOP_SKIP_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON,
  PAWNSHOP_TIER_BUTTONS,
  PAWNSHOP_TRIM_NEXT_BUTTON,
  PAWNSHOP_TRIM_PREV_BUTTON,
  REDEMPTION_ACCEPT_BUTTON,
  REDEMPTION_REJECT_BUTTON,
  SIDE_QUEST_ACCEPT_BUTTON,
  SIDE_QUEST_REJECT_BUTTON,
  TRIM_CARD_SLOTS,
  TRIM_SKIP_BUTTON,
} from '../game/layout';
import { createRngFromUrl, mulberry32, type RngFn } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export {
  BOSS_PREVIEW_CONFIRM_BUTTON,
  PACT_OPTION_BUTTONS,
  PAWNSHOP_CALENDAR_BUTTON,
  REDEMPTION_ACCEPT_BUTTON,
  REDEMPTION_REJECT_BUTTON,
  SIDE_QUEST_ACCEPT_BUTTON,
  SIDE_QUEST_REJECT_BUTTON,
  TRIM_CARD_SLOTS,
  TRIM_SKIP_BUTTON,
} from '../game/layout';

export interface PawnshopSceneData {
  save?: SaveData;
  forceTutorial?: boolean;
}

const CARDS_BY_NAME = buildCardMap(cardsJson as CardDef[]);

const HUD_HEIGHT = PAWNSHOP_HUD_HEIGHT;
const NEGOTIATING_PANEL_CENTER_Y = 97;
const NEGOTIATING_PANEL_HEIGHT = 122;
const FEEDBACK_PANEL_CENTER_Y = 108;
const FEEDBACK_PANEL_HEIGHT = 136;
const STORY_WRAP_CHARS = 18;
const FEEDBACK_STORY_WRAP_CHARS = 20;
const TOAST_DURATION_MS = 1400;

export class PawnshopScene extends Phaser.Scene {
  private save!: SaveData;
  private state!: PawnshopState;
  private tutorial!: TutorialState;
  private seed = 1;
  private rng!: RngFn;
  private trimPage = 0;
  private pendingSideQuestItem: PawnItem | null = null;
  private contentLayer!: Phaser.GameObjects.Container;
  private tutorialBubble?: Phaser.GameObjects.Container;
  private shopkeeperBanner?: Phaser.GameObjects.Container;
  private shopkeeperBannerTimer?: Phaser.Time.TimerEvent;
  private shopkeeperBannerDismissed = false;
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
      ? {
          ...data.save,
          deck: [...data.save.deck],
          chapter: cloneChapterState(data.save.chapter),
        }
      : createNewGame();

    const { seed, rng } = createRngFromUrl();
    this.seed = seed;
    this.rng = rng;
    this.trimPage = 0;
    this.pendingSideQuestItem = null;
    this.shopkeeperBanner = undefined;
    this.shopkeeperBannerTimer = undefined;
    this.shopkeeperBannerDismissed = false;

    // 每天开始时按 ?seed= + 天数洗牌当客池并取前 3 位
    // （第 1 天保底含 1 件伤害牌旧物，P6 B2；输首夜后第 2 天保底 1 件可负担伤害牌旧物，P10 子项 3；
    //  P11 子项 4：D1 赎回后 N=2 天冷却排除 + D2 优先未拥有软版）
    const shuffleRng = mulberry32(deriveDaySeed(seed, this.save.day));
    const lostNight1 =
      this.save.day === 2 &&
      this.save.chapter.daysVisited.includes(1) &&
      !this.save.chapter.daysCleared.includes(1);
    const dailyItems = pickDailyItems(
      ITEMS,
      this.save.day,
      shuffleRng,
      DAILY_CUSTOMER_COUNT,
      {
        deck: this.save.deck,
        redeemedDayByItem: this.save.chapter.redeemedDayByItem,
        cooldownDays: REDEMPTION_COOLDOWN_DAYS,
        ...(lostNight1
          ? {
              recoverDamageAfterDay1Loss: {
                money: this.save.money,
                deck: this.save.deck,
              },
            }
          : {}),
      },
    );

    // 每天当客上门前检查事件：
    // 第 7 天白天开张前先展示「封门预告」（boss_preview），确认后再检查父亲过赎期事件 / 随机赎当；
    // 第 2 天新娘剧本化赎当（独立分支）优先于随机赎当（P6 C4 + P9 契约倍率）。
    const pawnPrices = loadPawnPrices();
    const needsDay4Pact =
      this.save.chapter.dayInChapter === 4 && this.save.chapter.pactChoice === null;
    const needsDay4Trim =
      this.save.chapter.dayInChapter === 4 &&
      !needsDay4Pact &&
      !this.save.chapter.day4TrimDone &&
      this.save.deck.length > 0;
    const needsDay7BossPreview = this.save.chapter.dayInChapter === 7;

    const brideOffer =
      needsDay4Pact || needsDay4Trim || needsDay7BossPreview
        ? null
        : createBrideRedemptionOffer(
            this.save.day,
            this.save.deck,
            pawnPrices,
            Boolean(this.save.chapter.day1RingPawned),
            Boolean(this.save.chapter.day2BrideRedemptionDone),
            ITEMS,
          );

    const redeemMultiplier = getRedemptionMultiplier(
      this.save.chapter.pactChoice,
      this.save.chapter.currentChapter,
    );
    const redeemRng = mulberry32(deriveRedemptionSeed(seed, this.save.day));
    const redemptionOffer =
      brideOffer ??
      (needsDay4Pact || needsDay4Trim || needsDay7BossPreview
        ? null
        : createRedemptionOffer(
            this.save.deck,
            this.save.redeemTickets,
            pawnPrices,
            redeemRng,
            ITEMS,
            redeemMultiplier,
          ));

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

    if (needsDay7BossPreview) {
      this.state = { ...this.state, phase: 'boss_preview' };
    } else if (needsDay4Pact) {
      this.state = { ...this.state, phase: 'pact' };
    } else if (needsDay4Trim) {
      this.state = { ...this.state, phase: 'trim_deck' };
    }

    this.tutorialBubble = undefined;
    this.toastContainer = undefined;
    this.toastTimer = undefined;
    this.lastToast = null;
    this.tutorial = createTutorialState({
      day: this.state.day,
      tutorialDone: loadTutorialDone(),
      forceReplay: data?.forceTutorial,
    });

    this.installDebugHook();

    this.drawDaytimeBackdrop();
    this.createHud();
    this.contentLayer = this.add.container(0, 0);

    installAudioDebugHook(audio);
    audio.playBgm('day');

    this.events.on(Phaser.Scenes.Events.RESUME, () => {
      this.installDebugHook();
      installAudioDebugHook(audio);
      if (this.scene.isActive()) {
        this.scale.refresh();
      }
    });

    this.renderCurrentPhase();
    this.syncInputBounds();
  }

  private installDebugHook(): void {
    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__PAWNSHOP_DEBUG__ = {
      getState: () => {
        const currentItem = this.state.items[this.state.customerIndex];
        const isNegotiating = this.state.phase === 'negotiating' && Boolean(currentItem);
        const tierAffordability =
          isNegotiating && currentItem
            ? getTierAffordability(this.state.money, currentItem.trueValue)
            : undefined;
        const effectiveAcceptRates =
          isNegotiating && currentItem
            ? {
                low: getEffectiveAcceptRate('low', this.state.reputation, BALANCE, currentItem.temperament),
                fair: getEffectiveAcceptRate('fair', this.state.reputation, BALANCE, currentItem.temperament),
                high: getEffectiveAcceptRate('high', this.state.reputation, BALANCE, currentItem.temperament),
              }
            : undefined;
        const currentTemperament: CustomerTemperament | null =
          isNegotiating && currentItem?.temperament ? currentItem.temperament : null;
        const currentTemperamentLabel = getTemperamentLabel(currentTemperament ?? undefined);
        const activeRedemption =
          this.state.phase === 'redemption' && this.state.redemptionOffer
            ? {
                itemId: this.state.redemptionOffer.item.id,
                itemName: this.state.redemptionOffer.item.name,
                cardName: this.state.redemptionOffer.cardName,
                basePrice: this.state.redemptionOffer.basePrice,
                payout: this.state.redemptionOffer.payout,
                ...(this.state.redemptionOffer.isBrideScripted ? { isBrideScripted: true } : {}),
                ...(this.state.redemptionOffer.isFatherOverdueScripted
                  ? { isFatherOverdueScripted: true }
                  : {}),
              }
            : null;
        const bossPreview =
          this.state.phase === 'boss_preview'
            ? (() => {
                const composed = this.getComposedBossPreview();
                return {
                  componentCount: composed.componentCount,
                  finalHp: composed.finalHp,
                  baseHp: composed.baseHp,
                  componentHpBonus: composed.componentHpBonus,
                  pactHpBonus: composed.pactHpBonus,
                  hpCapped: composed.hpCapped,
                  r1Shield: composed.r1Shield,
                  chargeThreshold: composed.chargeThreshold,
                  fragmentNames: [...composed.fragmentNames],
                  hpLine: formatBossPreviewHpLine(composed),
                };
              })()
            : null;
        const chapterCfg = getChapterConfig(this.save.chapter.currentChapter);
        const day3Rumor =
          this.state.phase === 'summary' && this.save.chapter.dayInChapter === 3
            ? chapterCfg.day3Rumor
            : null;
        return {
          ...toDebugSnapshot(this.state),
          day: this.state.day,
          shopLevel: this.save.shopLevel,
          redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
          maxRenqing: maxRenqingForLevel(this.save.shopLevel),
          itemsOrder: this.state.items.map((item) => item.id),
          currentTemperament,
          currentTemperamentLabel,
          lastMessage: this.state.lastOutcome?.message ?? null,
          canSkip: isNegotiating,
          lastToast: this.lastToast,
          redemptionOffer: activeRedemption,
          bossPreview,
          shopkeeperNote:
            this.state.day === 1 ? SHOPKEEPER_OPENING_NOTE_LINES.join('\n') : null,
          ...(tierAffordability ? { tierAffordability } : {}),
          ...(effectiveAcceptRates ? { effectiveAcceptRates } : {}),
          tutorialActive: this.tutorial.active,
          currentStep: this.tutorial.currentStep,
          tutorialDone: this.tutorial.done || loadTutorialDone(),
          tutorialCopy: getTutorialCopy(this.tutorial.currentStep),
          chapter: cloneChapterState(this.save.chapter),
          pactChoice: this.save.chapter.pactChoice,
          sideQuestChoice: this.save.chapter.sideQuestChoice,
          day3Rumor,
          sideQuestItemId: this.pendingSideQuestItem?.id ?? null,
        };
      },
    };
  }

  private drawDaytimeBackdrop(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);

    // 白天当铺暖色木墙（640×360）
    this.add.rectangle(
      centerX,
      Math.floor((BASE_HEIGHT + HUD_HEIGHT) / 2),
      BASE_WIDTH,
      BASE_HEIGHT - HUD_HEIGHT,
      PALETTE.woodBrown.num,
    );

    // 墙面暖色窗格
    this.add
      .rectangle(BASE_WIDTH - 96, 96, 88, 68, PALETTE.candle.num)
      .setStrokeStyle(2, PALETTE.deepWood.num);
    this.add.rectangle(BASE_WIDTH - 96, 96, 72, 52, PALETTE.oldPaper.num);
    this.add.rectangle(BASE_WIDTH - 96, 96, 4, 68, PALETTE.deepWood.num);
    this.add.rectangle(BASE_WIDTH - 96, 96, 88, 4, PALETTE.deepWood.num);

    // 货架木格线
    this.add.rectangle(centerX, 68, BASE_WIDTH, 4, PALETTE.deepWood.num);
    this.add.rectangle(centerX, 136, BASE_WIDTH, 4, PALETTE.deepWood.num);

    // 当铺木柜台与操作区底板
    this.add.rectangle(centerX, 298, BASE_WIDTH, 6, PALETTE.copperBrown.num);
    this.add.rectangle(centerX, 301, BASE_WIDTH, 2, PALETTE.ink.num);
    this.add.rectangle(centerX, 331, BASE_WIDTH, 58, PALETTE.deepWood.num);
  }

  private createHud(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const hudY = Math.floor(HUD_HEIGHT / 2);

    this.add.rectangle(centerX, hudY, BASE_WIDTH, HUD_HEIGHT, PALETTE.deepWood.num);
    this.add.rectangle(centerX, HUD_HEIGHT - 2, BASE_WIDTH, 2, PALETTE.brass.num);
    this.add.rectangle(centerX, HUD_HEIGHT, BASE_WIDTH, 2, PALETTE.ink.num);

    addPixelText(this, 10, hudY, '钱:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudMoneyText = addPixelText(this, 46, hudY, '', {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    addPixelText(this, 104, hudY, '口碑:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudRepText = addPixelText(this, 166, hudY, '', {
      color: PALETTE.brass.hex,
      origin: [0, 0.5],
    });

    addPixelText(this, 218, hudY, '牌:', { color: PALETTE.candle.hex, origin: [0, 0.5] });
    this.hudDeckText = addPixelText(this, 254, hudY, '', {
      color: PALETTE.lampYellow.hex,
      origin: [0, 0.5],
    });

    this.hudProgressText = addPixelText(this, 310, hudY, '', {
      color: PALETTE.oldPaper.hex,
      origin: [0, 0.5],
    });

    this.hudDayText = addPixelText(this, 548, hudY, '', {
      color: PALETTE.paperWhite.hex,
      origin: [1, 0.5],
    });

    // P9 顶部 HUD「台历」按钮（打开独立全屏台历屏，返回状态不丢）
    const calBtn = this.add
      .rectangle(
        PAWNSHOP_CALENDAR_BUTTON.x,
        PAWNSHOP_CALENDAR_BUTTON.y,
        PAWNSHOP_CALENDAR_BUTTON.width,
        PAWNSHOP_CALENDAR_BUTTON.height,
        PALETTE.oldPaper.num,
      )
      .setStrokeStyle(2, PALETTE.ink.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, PAWNSHOP_CALENDAR_BUTTON.x, PAWNSHOP_CALENDAR_BUTTON.y, '台历', {
      color: PALETTE.ink.hex,
      origin: 0.5,
    });

    calBtn.on('pointerover', () => calBtn.setFillStyle(PALETTE.lampYellow.num));
    calBtn.on('pointerout', () => calBtn.setFillStyle(PALETTE.oldPaper.num));
    calBtn.on('pointerdown', () => {
      this.dismissShopkeeperBanner();
      audio.unlock();
      audio.playSfx('button_click');
      const liveSave: SaveData = {
        ...this.save,
        day: this.state.day,
        money: this.state.money,
        reputation: this.state.reputation,
        deck: [...this.state.deck],
        redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
        chapter: cloneChapterState(this.save.chapter),
      };
      this.scene.pause('PawnshopScene');
      this.scene.launch('CalendarMapScene', {
        returnTo: 'PawnshopScene',
        save: liveSave,
        seed: this.seed,
      });
      this.scene.bringToTop('CalendarMapScene');
    });
  }

  private updateHud(): void {
    this.hudMoneyText.setText(`${this.state.money}`);
    this.hudRepText.setText(`${this.state.reputation}`);
    this.hudDeckText.setText(`${this.state.deck.length}`);
    this.hudDayText.setText(`第${this.state.day}天`);

    if (this.state.phase === 'boss_preview') {
      this.hudProgressText.setText('封门预告');
    } else if (this.state.phase === 'pact') {
      this.hudProgressText.setText('掌柜契约');
    } else if (this.state.phase === 'trim_deck') {
      this.hudProgressText.setText('整理柜台');
    } else if (this.state.phase === 'redemption') {
      this.hudProgressText.setText('旧客赎当');
    } else if (this.state.phase === 'side_quest') {
      this.hudProgressText.setText('偏巷暗当');
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

    if (this.state.phase === 'boss_preview') {
      this.renderBossPreview();
    } else if (this.state.phase === 'pact') {
      this.renderPact();
    } else if (this.state.phase === 'trim_deck') {
      this.renderTrimDeck();
    } else if (this.state.phase === 'redemption') {
      this.renderRedemption();
    } else if (this.state.phase === 'negotiating') {
      this.renderNegotiating();
    } else if (this.state.phase === 'feedback') {
      this.renderFeedback();
    } else if (this.state.phase === 'side_quest') {
      this.renderSideQuest();
    } else {
      this.renderSummary();
    }

    this.tutorial = syncTutorialForPawnshop(this.tutorial, this.state.phase);
    this.renderTutorialBubble();
    this.maybeShowShopkeeperOpeningBanner();
  }

  private maybeShowShopkeeperOpeningBanner(): void {
    if (
      this.state.day !== 1 ||
      this.state.phase !== 'negotiating' ||
      this.state.customerIndex !== 0 ||
      this.shopkeeperBannerDismissed ||
      this.shopkeeperBanner ||
      (this.tutorial.active && this.tutorial.currentStep !== null)
    ) {
      return;
    }

    // 掌柜交代横幅置于当客卡片下方空档（y=167..227），任何时刻不遮挡当客卡片、教程气泡与按钮
    const centerX = Math.floor(BASE_WIDTH / 2);
    const banner = this.add.container(0, 0).setDepth(95);
    const bg = this.add
      .rectangle(centerX, 197, 576, 60, PALETTE.nightBlack.num)
      .setStrokeStyle(2, PALETTE.lampYellow.num)
      .setInteractive({ useHandCursor: true });
    const line1 = addPixelText(this, centerX, 182, SHOPKEEPER_OPENING_NOTE_LINES[0], {
      color: PALETTE.candle.hex,
      origin: 0.5,
    });
    const line2 = addPixelText(this, centerX, 211, SHOPKEEPER_OPENING_NOTE_LINES[1], {
      color: PALETTE.lampYellow.hex,
      origin: 0.5,
    });
    bg.on('pointerdown', () => this.dismissShopkeeperBanner());
    banner.add([bg, line1, line2]);
    this.shopkeeperBanner = banner;
    this.shopkeeperBannerTimer = this.time.delayedCall(3800, () => {
      this.dismissShopkeeperBanner();
    });
  }

  private dismissShopkeeperBanner(): void {
    this.shopkeeperBannerDismissed = true;
    if (this.shopkeeperBannerTimer) {
      this.shopkeeperBannerTimer.remove(false);
      this.shopkeeperBannerTimer = undefined;
    }
    if (this.shopkeeperBanner) {
      this.shopkeeperBanner.destroy();
      this.shopkeeperBanner = undefined;
    }
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
        this.dismissShopkeeperBanner();
        this.tutorial = advanceTutorialStep(this.tutorial);
        this.renderTutorialBubble();
      },
      onSkip: () => {
        this.dismissShopkeeperBanner();
        this.tutorial = skipTutorial(this.tutorial);
        saveTutorialDone(true);
        this.renderTutorialBubble();
      },
    });
  }

  private getComposedBossPreview(): ComposedBossResult {
    return composeBoss(this.state.deck, this.save.chapter.pactChoice);
  }

  private enterPostBossPreviewEvents(): void {
    const pawnPrices = this.state.pawnPrices ?? loadPawnPrices();
    const fatherOffer = createFatherOverdueRedemptionOffer(
      this.save.chapter.dayInChapter,
      this.state.deck,
      pawnPrices,
      Boolean(this.save.chapter.day7FatherRedemptionDone),
      ITEMS,
    );

    const redeemMultiplier = getRedemptionMultiplier(
      this.save.chapter.pactChoice,
      this.save.chapter.currentChapter,
    );
    const redeemRng = mulberry32(deriveRedemptionSeed(this.seed, this.save.day));
    const randomOffer =
      fatherOffer ??
      createRedemptionOffer(
        this.state.deck,
        this.state.redeemTickets ?? this.save.redeemTickets,
        pawnPrices,
        redeemRng,
        ITEMS,
        redeemMultiplier,
      );

    this.state = {
      ...this.state,
      phase: randomOffer ? 'redemption' : 'negotiating',
      redemptionOffer: randomOffer,
    };
    this.renderCurrentPhase();
  }

  private renderBossPreview(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const composed = this.getComposedBossPreview();

    // 封门预告底板（y=42..348，居中 608×306）
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 195, BASE_WIDTH - 32, 306, PALETTE.nightBlack.num)
        .setStrokeStyle(2, PALETTE.vermilion.num),
    );
    this.contentLayer.add(this.add.rectangle(centerX, 60, BASE_WIDTH - 36, 34, PALETTE.deepWood.num));
    this.contentLayer.add(
      addPixelText(this, centerX, 60, '第7天 · 封门预告（今夜大心魔）', {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    );

    // 血量明细（含上限48与“已到顶”注明，深底高对比）
    this.contentLayer.add(
      addPixelText(this, centerX, 94, formatBossPreviewHpLine(composed), {
        color: composed.hpCapped ? PALETTE.lampYellow.hex : PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
    );

    // 封门打断阈值（10 或 14）与开局盾
    const shieldPart = composed.r1Shield > 0 ? ` · 开局盾+${composed.r1Shield}` : '';
    this.contentLayer.add(
      addPixelText(
        this,
        centerX,
        124,
        `封门打断阈值:${composed.chargeThreshold}(R2累伤打断返+1情)${shieldPart}`,
        {
          color: composed.chargeThreshold > 10 ? PALETTE.lampYellow.hex : PALETTE.brass.hex,
          origin: 0.5,
        },
      ),
    );

    this.contentLayer.add(this.add.rectangle(centerX, 142, BASE_WIDTH - 56, 2, PALETTE.deepWood.num));

    // 组件构成列表（0 块素体 vs 1–6 块两列网格）
    if (composed.isBare) {
      this.contentLayer.add(
        addPixelText(this, centerX, 184, '柜子空了，债主只身前来', {
          color: PALETTE.candle.hex,
          origin: 0.5,
        }),
      );
      this.contentLayer.add(
        addPixelText(this, centerX, 220, '当前无旧物执念加成，保持素体形态', {
          color: PALETTE.silverBlue.hex,
          origin: 0.5,
        }),
      );
    } else {
      const colXs = [28, 322];
      const rowYs = [154, 188, 222];
      composed.activeComponents.forEach((comp, idx) => {
        const col = idx % 2;
        const row = Math.floor(idx / 2);
        const x = colXs[col];
        const y = rowYs[row] ?? 222;
        this.contentLayer.add(
          addPixelText(this, x, y, `${comp.fragmentName}:${comp.effectText}`, {
            color: PALETTE.candle.hex,
            origin: [0, 0],
          }),
        );
      });
    }

    this.contentLayer.add(
      addPixelText(this, centerX, 268, '今日白天收当/赎当仍可改变今夜Boss构成', {
        color: PALETTE.silverBlue.hex,
        origin: 0.5,
      }),
    );

    this.addActionButton(
      BOSS_PREVIEW_CONFIRM_BUTTON.x,
      BOSS_PREVIEW_CONFIRM_BUTTON.y,
      BOSS_PREVIEW_CONFIRM_BUTTON.width,
      BOSS_PREVIEW_CONFIRM_BUTTON.height,
      '知道了·开门',
      null,
      () => {
        if (this.state.phase !== 'boss_preview') {
          return;
        }
        audio.unlock();
        audio.playSfx('button_click');
        this.enterPostBossPreviewEvents();
      },
      false,
      PALETTE.candle.num,
      PALETTE.lampYellow.num,
    );
  }

  private showToast(message: string): void {
    this.clearToast(false);
    this.lastToast = message;

    // 轻提示置于右侧空档（x=498..626, y=182..214），位于跳过当客钮上方、远离 1/6 与 2/6 教程气泡
    const toastY = 198;
    const width = Math.max(128, message.length * 24 + 28);
    const height = 32;
    const toastX = BASE_WIDTH - 14 - Math.floor(width / 2);

    const container = this.add.container(0, 0).setDepth(120);
    const bg = this.add
      .rectangle(toastX, toastY, width, height, PALETTE.ink.num)
      .setStrokeStyle(2, PALETTE.vermilion.num);
    const text = addPixelText(this, toastX, toastY, message, {
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

  private enterPostDay4Events(): void {
    const pawnPrices = this.state.pawnPrices ?? loadPawnPrices();
    const redeemMultiplier = getRedemptionMultiplier(
      this.save.chapter.pactChoice,
      this.save.chapter.currentChapter,
    );
    const redeemRng = mulberry32(deriveRedemptionSeed(this.seed, this.save.day));
    const redemptionOffer = createRedemptionOffer(
      this.state.deck,
      this.state.redeemTickets ?? this.save.redeemTickets,
      pawnPrices,
      redeemRng,
      ITEMS,
      redeemMultiplier,
    );

    this.state = {
      ...this.state,
      phase: redemptionOffer ? 'redemption' : 'negotiating',
      redemptionOffer,
    };
    this.renderCurrentPhase();
  }

  private renderPact(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const chapterCfg = getChapterConfig(this.save.chapter.currentChapter);

    this.contentLayer.add(
      this.add
        .rectangle(centerX, 64, BASE_WIDTH - 32, 34, PALETTE.deepWood.num)
        .setStrokeStyle(2, PALETTE.brass.num),
    );
    this.contentLayer.add(
      addPixelText(this, centerX, 64, '第4天集市 · 掌柜契约(三选一)', {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    );

    const formatPactTwoLines = (text: string): string => {
      if (text === '赎当倍率1.2变1.5') return '赎当倍率\n1.2变1.5';
      if (text === '跳过当客口碑-1') return '跳过当客\n口碑-1';
      if (text === '第7夜Boss血量+6') return '第7夜Boss\n血量+6';
      if (text === '无额外代价') return '无额外\n代价';
      return wrapCjkText(text, 6);
    };

    chapterCfg.day4Pacts.forEach((pact, idx) => {
      const slot = PACT_OPTION_BUTTONS[idx];
      if (!slot) {
        return;
      }

      const bg = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, PALETTE.candle.num)
        .setStrokeStyle(2, PALETTE.ink.num)
        .setInteractive({ useHandCursor: true });

      const header = this.add.rectangle(slot.x, slot.y - 101, slot.width - 4, 34, PALETTE.deepWood.num);
      const title = addPixelText(this, slot.x, slot.y - 101, pact.name, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      });

      const benefitTitle = addPixelText(this, slot.x, slot.y - 68, '收益', {
        color: PALETTE.ink.hex,
        origin: 0.5,
      });
      const benefitBody = addPixelText(this, slot.x, slot.y - 30, formatPactTwoLines(pact.benefit), {
        color: PALETTE.ink.hex,
        origin: 0.5,
        lineSpacing: 1,
      });

      const divider = this.add.rectangle(slot.x, slot.y - 2, slot.width - 24, 2, PALETTE.oldPaper.num);

      const costTitle = addPixelText(this, slot.x, slot.y + 14, '代价', {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
      });
      const costBody = addPixelText(this, slot.x, slot.y + 49, formatPactTwoLines(pact.cost), {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
        lineSpacing: 1,
      });

      const ctaBg = this.add
        .rectangle(slot.x, slot.y + 98, slot.width - 20, 28, PALETTE.oldPaper.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      const ctaText = addPixelText(this, slot.x, slot.y + 98, '选此契约', {
        color: PALETTE.ink.hex,
        origin: 0.5,
      });

      bg.on('pointerover', () => {
        bg.setFillStyle(PALETTE.paperWhite.num);
        ctaBg.setFillStyle(PALETTE.lampYellow.num);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(PALETTE.candle.num);
        ctaBg.setFillStyle(PALETTE.oldPaper.num);
      });
      bg.on('pointerdown', () => this.handlePactChoice(pact.id));

      this.contentLayer.add([
        bg,
        header,
        title,
        benefitTitle,
        benefitBody,
        divider,
        costTitle,
        costBody,
        ctaBg,
        ctaText,
      ]);
    });
  }

  private handlePactChoice(pactId: PactId): void {
    if (this.state.phase !== 'pact') {
      return;
    }
    audio.unlock();
    audio.playSfx('deal_closed');

    const updated = applyPactToSave(
      {
        ...this.save,
        money: this.state.money,
        reputation: this.state.reputation,
        deck: [...this.state.deck],
      },
      pactId,
    );
    this.save = updated;
    this.state = {
      ...this.state,
      money: updated.money,
      reputation: updated.reputation,
      deck: [...updated.deck],
    };
    saveGame(this.save);

    if (this.state.deck.length > 0 && !this.save.chapter.day4TrimDone) {
      this.trimPage = 0;
      this.state = { ...this.state, phase: 'trim_deck' };
      this.renderCurrentPhase();
      return;
    }

    this.save.chapter.day4TrimDone = true;
    saveGame(this.save);
    this.enterPostDay4Events();
  }

  private renderTrimDeck(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const pageSize = TRIM_CARD_SLOTS.length;
    const totalPages = Math.max(1, Math.ceil(this.state.deck.length / pageSize));
    if (this.trimPage >= totalPages) {
      this.trimPage = totalPages - 1;
    }

    this.contentLayer.add(
      this.add
        .rectangle(centerX, 64, BASE_WIDTH - 32, 34, PALETTE.deepWood.num)
        .setStrokeStyle(2, PALETTE.brass.num),
    );
    this.contentLayer.add(
      addPixelText(
        this,
        centerX,
        64,
        `整理柜台 · 免费删1张牌(${this.trimPage + 1}/${totalPages})`,
        {
          color: PALETTE.lampYellow.hex,
          origin: 0.5,
        },
      ),
    );

    const startIdx = this.trimPage * pageSize;
    const pageCards = this.state.deck.slice(startIdx, startIdx + pageSize);

    pageCards.forEach((cardName, slotIdx) => {
      const slot = TRIM_CARD_SLOTS[slotIdx];
      const deckIdx = startIdx + slotIdx;
      const cardDef = CARDS_BY_NAME.get(cardName);
      const stripColor = cardDef?.color ? parseHexColor(cardDef.color) : PALETTE.brass.num;
      const costStr = cardDef ? `${cardDef.cost}费` : '';
      const shortEff = cardDef ? formatEffectShort(cardDef) : '';

      const bg = this.add
        .rectangle(slot.x, slot.y, slot.width, slot.height, PALETTE.paperWhite.num)
        .setStrokeStyle(2, PALETTE.ink.num)
        .setInteractive({ useHandCursor: true });
      const strip = this.add.rectangle(slot.x, slot.y - 30, slot.width - 4, 6, stripColor);
      const nameTxt = addPixelText(this, slot.x, slot.y - 8, `${cardName} ${costStr}`, {
        color: PALETTE.ink.hex,
        origin: 0.5,
      });
      const effTxt = addPixelText(this, slot.x, slot.y + 16, shortEff, {
        color: PALETTE.deepWood.hex,
        origin: 0.5,
      });

      bg.on('pointerover', () => {
        bg.setFillStyle(PALETTE.candle.num);
        bg.setStrokeStyle(2, PALETTE.vermilion.num);
      });
      bg.on('pointerout', () => {
        bg.setFillStyle(PALETTE.paperWhite.num);
        bg.setStrokeStyle(2, PALETTE.ink.num);
      });
      bg.on('pointerdown', () => this.handleTrimCard(deckIdx));

      this.contentLayer.add([bg, strip, nameTxt, effTxt]);
    });

    if (totalPages > 1) {
      this.addActionButton(
        PAWNSHOP_TRIM_PREV_BUTTON.x,
        PAWNSHOP_TRIM_PREV_BUTTON.y,
        PAWNSHOP_TRIM_PREV_BUTTON.width,
        PAWNSHOP_TRIM_PREV_BUTTON.height,
        '上一页',
        null,
        () => {
          audio.unlock();
          audio.playSfx('button_click');
          this.trimPage = (this.trimPage - 1 + totalPages) % totalPages;
          this.renderCurrentPhase();
        },
        false,
        PALETTE.oldPaper.num,
      );
      this.addActionButton(
        PAWNSHOP_TRIM_NEXT_BUTTON.x,
        PAWNSHOP_TRIM_NEXT_BUTTON.y,
        PAWNSHOP_TRIM_NEXT_BUTTON.width,
        PAWNSHOP_TRIM_NEXT_BUTTON.height,
        '下一页',
        null,
        () => {
          audio.unlock();
          audio.playSfx('button_click');
          this.trimPage = (this.trimPage + 1) % totalPages;
          this.renderCurrentPhase();
        },
        false,
        PALETTE.oldPaper.num,
      );
    }

    this.addActionButton(
      TRIM_SKIP_BUTTON.x,
      TRIM_SKIP_BUTTON.y,
      TRIM_SKIP_BUTTON.width,
      TRIM_SKIP_BUTTON.height,
      '暂不删牌',
      null,
      () => this.handleSkipTrim(),
      false,
      PALETTE.oldPaper.num,
    );
  }

  private handleTrimCard(deckIndex: number): void {
    if (this.state.phase !== 'trim_deck') {
      return;
    }
    audio.unlock();
    audio.playSfx('button_click');
    const nextDeck = removeCardAtIndex(this.state.deck, deckIndex);
    this.state = { ...this.state, deck: nextDeck };
    this.save = {
      ...this.save,
      deck: [...nextDeck],
      chapter: {
        ...cloneChapterState(this.save.chapter),
        day4TrimDone: true,
      },
    };
    saveGame(this.save);
    this.enterPostDay4Events();
  }

  private handleSkipTrim(): void {
    if (this.state.phase !== 'trim_deck') {
      return;
    }
    audio.unlock();
    audio.playSfx('button_click');
    this.save = {
      ...this.save,
      chapter: {
        ...cloneChapterState(this.save.chapter),
        day4TrimDone: true,
      },
    };
    saveGame(this.save);
    this.enterPostDay4Events();
  }

  private maybeTriggerDay6SideQuestOrSummary(): void {
    if (
      this.save.chapter.dayInChapter === 6 &&
      !this.save.chapter.day6SideQuestDone &&
      this.state.phase === 'summary'
    ) {
      const sqRng = mulberry32(
        deriveSideQuestSeed(this.seed, this.save.chapter.currentChapter, this.save.chapter.dayInChapter),
      );
      const extraItem = pickSideQuestItem(this.state.deck, ITEMS, sqRng);
      if (extraItem) {
        this.pendingSideQuestItem = extraItem;
        this.state = { ...this.state, phase: 'side_quest' };
      }
    }
  }

  private renderSideQuest(): void {
    const item = this.pendingSideQuestItem;
    if (!item) {
      this.state = { ...this.state, phase: 'summary' };
      this.renderCurrentPhase();
      return;
    }
    const chapterCfg = getChapterConfig(this.save.chapter.currentChapter);

    this.addTicketPanel(item, 146, 220, 66, 114);

    this.contentLayer.add(
      addPixelText(this, 124, 48, `${chapterCfg.day6SideQuest.name}（可选支线）`, {
        color: PALETTE.vermilion.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(366, 76, 480, 2, PALETTE.oldPaper.num));

    this.contentLayer.add(
      addPixelText(this, 124, 86, `旧物「${item.name}」牌:${item.cardName}(${item.cardCost}费)`, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 124, 120, '接受：多收1件未拥有旧物(三档报价)', {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 124, 154, chapterCfg.day6SideQuest.costText, {
        color: PALETTE.vermilion.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 124, 194, '拒绝：无任何变化，直接结束白天', {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
      }),
    );

    this.addActionButton(
      SIDE_QUEST_ACCEPT_BUTTON.x,
      SIDE_QUEST_ACCEPT_BUTTON.y,
      SIDE_QUEST_ACCEPT_BUTTON.width,
      SIDE_QUEST_ACCEPT_BUTTON.height,
      '接受暗当',
      '多收1件/心魔+4血',
      () => this.handleSideQuest(true),
      false,
      PALETTE.candle.num,
      PALETTE.lampYellow.num,
    );

    this.addActionButton(
      SIDE_QUEST_REJECT_BUTTON.x,
      SIDE_QUEST_REJECT_BUTTON.y,
      SIDE_QUEST_REJECT_BUTTON.width,
      SIDE_QUEST_REJECT_BUTTON.height,
      '拒绝暗当',
      '无任何变化',
      () => this.handleSideQuest(false),
      false,
      PALETTE.oldPaper.num,
      PALETTE.lampYellow.num,
    );
  }

  private handleSideQuest(accept: boolean): void {
    if (this.state.phase !== 'side_quest') {
      return;
    }
    audio.unlock();
    audio.playSfx(accept ? 'deal_closed' : 'button_click');

    this.save = {
      ...this.save,
      chapter: {
        ...cloneChapterState(this.save.chapter),
        sideQuestChoice: accept ? 'accepted' : 'rejected',
        day6SideQuestDone: true,
      },
    };
    saveGame(this.save);

    if (accept && this.pendingSideQuestItem) {
      const nextItems = [...this.state.items, { ...this.pendingSideQuestItem }];
      this.state = {
        ...this.state,
        phase: 'negotiating',
        items: nextItems,
        customerIndex: nextItems.length - 1,
      };
      this.pendingSideQuestItem = null;
      this.renderCurrentPhase();
      return;
    }

    this.pendingSideQuestItem = null;
    this.state = { ...this.state, phase: 'summary' };
    this.renderCurrentPhase();
  }

  private renderRedemption(): void {
    const offer = this.state.redemptionOffer;
    if (!offer) {
      return;
    }

    this.addTicketPanel(offer.item, 146, 220, 66, 114);

    if (offer.isBrideScripted) {
      this.contentLayer.add(
        addPixelText(this, 124, 46, '旧客回门 · 新娘来赎婚戒', {
          color: PALETTE.vermilion.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, BASE_WIDTH - 24, 46, '故事事件', {
          color: PALETTE.deepWood.hex,
          origin: [1, 0],
        }),
      );

      this.contentLayer.add(this.add.rectangle(366, 74, 480, 2, PALETTE.oldPaper.num));

      this.contentLayer.add(
        addPixelText(this, 124, 82, '「掌柜，我凑钱来赎婚戒了，能还我吗？」', {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 114, '提醒：赎走戒指，今晚少张挡伤牌(守诺盾5)', {
          color: PALETTE.vermilion.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 150, `接受：守诺离库 钱+${offer.payout} 口碑+1(不耗券)`, {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 186, '拒绝：留着守诺 口碑-1(她失望而去)', {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );

      this.addActionButton(
        REDEMPTION_ACCEPT_BUTTON.x,
        REDEMPTION_ACCEPT_BUTTON.y,
        REDEMPTION_ACCEPT_BUTTON.width,
        REDEMPTION_ACCEPT_BUTTON.height,
        '还她婚戒',
        `钱+${offer.payout} 碑+1`,
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
        '留着婚戒',
        '留守诺 碑-1',
        () => this.handleRedemption(false),
        false,
        PALETTE.oldPaper.num,
        PALETTE.lampYellow.num,
      );
      return;
    }

    if (offer.isFatherOverdueScripted) {
      this.contentLayer.add(
        addPixelText(this, 124, 46, '过赎期回门 · 父亲来问旧手表', {
          color: PALETTE.vermilion.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, BASE_WIDTH - 24, 46, '故事事件', {
          color: PALETTE.deepWood.hex,
          origin: [1, 0],
        }),
      );

      this.contentLayer.add(this.add.rectangle(366, 74, 480, 2, PALETTE.oldPaper.num));

      this.contentLayer.add(
        addPixelText(this, 124, 82, '「以为表早卖了…若肯破例，我欠你人情。」', {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 114, '破例(过赎期本不该赎):少倒转,Boss弱1块', {
          color: PALETTE.vermilion.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 150, `破例收益:钱+${offer.payout} 口碑+1(不耗券)`, {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );

      this.contentLayer.add(
        addPixelText(this, 124, 186, '留下:留倒转 口碑-1(Boss仍攥手表执念)', {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );

      this.addActionButton(
        REDEMPTION_ACCEPT_BUTTON.x,
        REDEMPTION_ACCEPT_BUTTON.y,
        REDEMPTION_ACCEPT_BUTTON.width,
        REDEMPTION_ACCEPT_BUTTON.height,
        '破例赎回',
        `钱+${offer.payout} 碑+1`,
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
        '留下手表',
        '留倒转 碑-1',
        () => this.handleRedemption(false),
        false,
        PALETTE.oldPaper.num,
        PALETTE.lampYellow.num,
      );
      return;
    }

    const tickets = this.state.redeemTickets ?? this.save.redeemTickets;
    this.contentLayer.add(
      addPixelText(this, 124, 46, '有人回来赎当！', {
        color: PALETTE.vermilion.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 24, 46, `赎当券:${tickets}`, {
        color: PALETTE.deepWood.hex,
        origin: [1, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(366, 74, 480, 2, PALETTE.oldPaper.num));

    this.contentLayer.add(
      addPixelText(this, 124, 82, `赎回「${offer.item.name}」（牌：${offer.cardName}）`, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, 124, 112, wrapCjkText(offer.item.story, STORY_WRAP_CHARS), {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
        lineSpacing: 2,
      }),
    );

    this.contentLayer.add(
      addPixelText(
        this,
        124,
        178,
        `接受:牌离库 钱+${offer.payout} 口碑+1 券-1`,
        {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        },
      ),
    );

    this.contentLayer.add(
      addPixelText(this, 124, 210, '拒绝:牌与赎当券均保留', {
        color: PALETTE.deepWood.hex,
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

    const currentOffer = this.state.redemptionOffer;
    const wasBride = Boolean(currentOffer?.isBrideScripted);
    const wasFather = Boolean(currentOffer?.isFatherOverdueScripted);
    const redeemedItemId = currentOffer?.item.id;
    audio.unlock();
    audio.playSfx(accept ? 'redeem_deal' : 'button_click');
    this.state = resolveRedemption(this.state, accept);

    const nextChapter = cloneChapterState(this.save.chapter);
    if (wasBride) {
      nextChapter.day2BrideRedemptionDone = true;
    }
    if (wasFather) {
      nextChapter.day7FatherRedemptionDone = true;
    }
    if (accept && redeemedItemId) {
      nextChapter.redeemedDayByItem = {
        ...(nextChapter.redeemedDayByItem ?? {}),
        [redeemedItemId]: this.state.day,
      };
    }

    // D1 + D2：若当日早晨赎当生效（尚未进入第 1 位当客），同步更新当日当客池避免刚赎出又出现
    if (accept && redeemedItemId && this.state.customerIndex === 0) {
      const shuffleRng = mulberry32(deriveDaySeed(this.seed, this.state.day));
      const lostNight1 =
        this.state.day === 2 &&
        nextChapter.daysVisited.includes(1) &&
        !nextChapter.daysCleared.includes(1);
      const refreshedItems = pickDailyItems(ITEMS, this.state.day, shuffleRng, DAILY_CUSTOMER_COUNT, {
        deck: this.state.deck,
        redeemedDayByItem: nextChapter.redeemedDayByItem,
        cooldownDays: REDEMPTION_COOLDOWN_DAYS,
        ...(lostNight1
          ? {
              recoverDamageAfterDay1Loss: {
                money: this.state.money,
                deck: this.state.deck,
              },
            }
          : {}),
      });
      this.state = {
        ...this.state,
        items: refreshedItems,
      };
    }

    this.save = {
      ...this.save,
      money: this.state.money,
      reputation: this.state.reputation,
      deck: [...this.state.deck],
      redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
      chapter: nextChapter,
    };
    saveGame(this.save);
    if (this.state.pawnPrices) {
      savePawnPrices(this.state.pawnPrices);
    }

    // P10 子项 4 & P11 子项 2②：新娘/父亲故事事件不占当日随机赎当名额；结束后照常检查当日随机赎当（不改动 createRedemptionOffer）
    if (wasBride || wasFather) {
      const redeemMultiplier = getRedemptionMultiplier(
        this.save.chapter.pactChoice,
        this.save.chapter.currentChapter,
      );
      const redeemRng = mulberry32(deriveRedemptionSeed(this.seed, this.save.day));
      const excludedCard = wasFather ? FATHER_WATCH_CARD_NAME : BRIDE_RING_CARD_NAME;
      const candidateDeck = accept
        ? this.state.deck
        : this.state.deck.map((card) => (card === excludedCard ? '' : card));
      const randomOffer = createRedemptionOffer(
        candidateDeck,
        this.state.redeemTickets ?? this.save.redeemTickets,
        this.state.pawnPrices ?? loadPawnPrices(),
        redeemRng,
        ITEMS,
        redeemMultiplier,
      );
      if (randomOffer) {
        this.state = {
          ...this.state,
          phase: 'redemption',
          redemptionOffer: randomOffer,
        };
      }
    }

    this.renderCurrentPhase();
  }

  private renderNegotiating(): void {
    const item = this.state.items[this.state.customerIndex];
    if (!item) {
      return;
    }

    this.addTicketPanel(item, NEGOTIATING_PANEL_CENTER_Y, NEGOTIATING_PANEL_HEIGHT, 60, 97);

    // 物品名、性格像素徽章（P7）与对应牌信息（y=40..64）
    this.contentLayer.add(
      addPixelText(this, 116, 40, item.name, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    const tempLabel = getTemperamentLabel(item.temperament);
    if (tempLabel && item.temperament) {
      const badgeW = tempLabel.length * 24 + 12;
      const badgeX = 116 + item.name.length * 24 + 8 + Math.floor(badgeW / 2);
      const badgeY = 52;
      const badgeFill =
        item.temperament === 'urgent'
          ? PALETTE.vermilion.num
          : item.temperament === 'proud'
            ? PALETTE.deepBlue.num
            : PALETTE.jade.num;
      const badgeTextColor =
        item.temperament === 'proud' ? PALETTE.lampYellow.hex : PALETTE.paperWhite.hex;

      this.contentLayer.add(
        this.add
          .rectangle(badgeX, badgeY, badgeW, 26, badgeFill)
          .setStrokeStyle(2, PALETTE.ink.num),
      );
      this.contentLayer.add(
        addPixelText(this, badgeX, badgeY, tempLabel, {
          color: badgeTextColor,
          origin: 0.5,
        }),
      );
    }

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 24, 40, `牌:${item.cardName}(${item.cardCost}费)`, {
        color: PALETTE.ink.hex,
        origin: [1, 0],
      }),
    );

    this.contentLayer.add(this.add.rectangle(362, 67, 492, 2, PALETTE.oldPaper.num));

    // 当客故事（C2：谈价期间完整可见，位于 y=71..121，严守面板 y=36..158 内）
    this.contentLayer.add(
      addPixelText(this, 116, 71, wrapCjkText(item.story, STORY_WRAP_CHARS), {
        color: PALETTE.deepWood.hex,
        origin: [0, 0],
        lineSpacing: 1,
      }),
    );

    // 卡牌效果说明（C1 + P10 子项 2：浅底深木字高对比，位于 y=127..151）
    const cardDef = CARDS_BY_NAME.get(item.cardName);
    if (cardDef) {
      this.contentLayer.add(
        addPixelText(this, 116, 127, `效果:${formatEffectDescription(cardDef)}`, {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );
    }

    // 右侧独立空档：跳过当客按钮（与 1/6、2/6 气泡水平拉开 12px）
    const noneAffordable = !hasAnyAffordableTier(this.state.money, item.trueValue);
    this.addActionButton(
      PAWNSHOP_SKIP_BUTTON.x,
      PAWNSHOP_SKIP_BUTTON.y,
      PAWNSHOP_SKIP_BUTTON.width,
      PAWNSHOP_SKIP_BUTTON.height,
      '跳过当客',
      null,
      () => this.handleSkip(),
      false,
      noneAffordable ? PALETTE.lampYellow.num : PALETTE.oldPaper.num,
      noneAffordable ? PALETTE.paperWhite.num : PALETTE.lampYellow.num,
    );

    // 报价区顶部：口碑接受率修正提示条（y=274..298，彻底移出 1/6 气泡区域）
    const centerX = Math.floor(BASE_WIDTH / 2);
    const repFill = this.state.reputation < 0 ? PALETTE.vermilion.num : PALETTE.deepWood.num;
    const repColor =
      this.state.reputation > 0
        ? PALETTE.lampYellow.hex
        : this.state.reputation < 0
          ? PALETTE.paperWhite.hex
          : PALETTE.candle.hex;
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 286, 560, 24, repFill)
        .setStrokeStyle(2, PALETTE.ink.num),
    );
    this.contentLayer.add(
      addPixelText(this, centerX, 286, formatReputationHint(this.state.reputation, BALANCE, item.temperament), {
        color: repColor,
        origin: 0.5,
      }),
    );

    // 三档报价按钮：低价 / 平价 / 高价
    TIER_ORDER.forEach((tier) => {
      const btnRect = PAWNSHOP_TIER_BUTTONS[tier];
      const tierConfig = BALANCE.tiers[tier];
      const price = quotePrice(item.trueValue, tier);
      const affordable = canAffordTier(this.state.money, item.trueValue, tier);

      this.addActionButton(
        btnRect.x,
        btnRect.y,
        btnRect.width,
        btnRect.height,
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

    // 独立成交/没谈成反馈面板（y=40..176），确保 3/6 教程气泡（y=184..272）与底部按钮完全不遮挡结算内容
    this.addTicketPanel(outcome.item, FEEDBACK_PANEL_CENTER_Y, FEEDBACK_PANEL_HEIGHT, 64, 108);

    const headlineColor = outcome.accepted ? PALETTE.ink.hex : PALETTE.vermilion.hex;
    const headline = outcome.accepted ? `成交！收下${outcome.item.name}` : '没谈成';
    this.contentLayer.add(
      addPixelText(this, 118, 44, headline, {
        color: headlineColor,
        origin: [0, 0],
      }),
    );

    if (outcome.accepted) {
      this.contentLayer.add(
        addPixelText(
          this,
          BASE_WIDTH - 24,
          44,
          `${outcome.price}元 口碑${formatSignedDelta(outcome.reputationDelta)}`,
          {
            color: PALETTE.ink.hex,
            origin: [1, 0],
          },
        ),
      );
    }

    this.contentLayer.add(this.add.rectangle(364, 71, 496, 2, PALETTE.oldPaper.num));

    // P7：当客同源白话还价反馈台词（y=75..99）
    this.contentLayer.add(
      addPixelText(this, 118, 75, `「${outcome.message}」`, {
        color: outcome.accepted ? PALETTE.ink.hex : PALETTE.vermilion.hex,
        origin: [0, 0],
      }),
    );

    if (outcome.accepted) {
      // C1 + P10 子项 2：收当结算显示卡牌效果说明（y=100..124）
      const cardDef = CARDS_BY_NAME.get(outcome.item.cardName);
      const effectDesc = cardDef ? formatEffectDescription(cardDef) : '';
      this.contentLayer.add(
        addPixelText(this, 118, 100, `${outcome.item.cardName}:${effectDesc}`, {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );

      // C2 + P8：成交后结算折行展示完整故事（y=125..173，至多两行，严格位于面板 y=40..176 内）
      this.contentLayer.add(
        addPixelText(
          this,
          118,
          125,
          wrapCjkText(`你收下了：${outcome.item.story}`, FEEDBACK_STORY_WRAP_CHARS),
          {
            color: PALETTE.deepWood.hex,
            origin: [0, 0],
            lineSpacing: 0,
          },
        ),
      );
    } else {
      this.contentLayer.add(
        addPixelText(this, 118, 110, '钱、口碑、牌组均无变化', {
          color: PALETTE.ink.hex,
          origin: [0, 0],
        }),
      );
      this.contentLayer.add(
        addPixelText(this, 118, 138, `未收下${outcome.item.name}`, {
          color: PALETTE.deepWood.hex,
          origin: [0, 0],
        }),
      );
    }

    const isLastCustomer = this.state.customerIndex >= this.state.items.length - 1;
    const nextLabel = isLastCustomer ? '白天结束' : '下一位';

    this.addActionButton(
      PAWNSHOP_FEEDBACK_NEXT_BUTTON.x,
      PAWNSHOP_FEEDBACK_NEXT_BUTTON.y,
      PAWNSHOP_FEEDBACK_NEXT_BUTTON.width,
      PAWNSHOP_FEEDBACK_NEXT_BUTTON.height,
      nextLabel,
      null,
      () => {
        audio.unlock();
        audio.playSfx('button_click');
        this.state = advanceCustomer(this.state);
        this.maybeTriggerDay6SideQuestOrSummary();
        this.renderCurrentPhase();
      },
    );
  }

  private renderSummary(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);
    const cardWidth = BASE_WIDTH - 64;

    // 结算主卡片（y=48..344）
    this.contentLayer.add(
      this.add
        .rectangle(centerX, 196, cardWidth, 296, PALETTE.candle.num)
        .setStrokeStyle(2, PALETTE.ink.num),
    );

    const chapterCfg = getChapterConfig(this.save.chapter.currentChapter);
    const isDay3Rumor = this.save.chapter.dayInChapter === 3;

    // 标题条
    const titleY = isDay3Rumor ? 64 : 76;
    const titleH = isDay3Rumor ? 32 : 40;
    this.contentLayer.add(this.add.rectangle(centerX, titleY, cardWidth, titleH, PALETTE.deepWood.num));
    this.contentLayer.add(
      addPixelText(this, centerX, titleY, `第${this.state.day}天 · 白天结束`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    );

    // 钱与口碑摘要条
    const statsY = isDay3Rumor ? 98 : 124;
    const statsH = isDay3Rumor ? 28 : 36;
    this.contentLayer.add(
      this.add
        .rectangle(centerX, statsY, cardWidth - 36, statsH, PALETTE.deepWood.num)
        .setStrokeStyle(2, PALETTE.ink.num),
    );

    this.contentLayer.add(
      addPixelText(this, 68, statsY, '钱:', {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
    );
    this.contentLayer.add(
      addPixelText(this, 108, statsY, `${this.state.money}`, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    this.contentLayer.add(
      addPixelText(this, centerX + 16, statsY, '口碑:', {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
    );
    this.contentLayer.add(
      addPixelText(this, centerX + 84, statsY, `${this.state.reputation}`, {
        color: PALETTE.brass.hex,
        origin: [0, 0.5],
      }),
    );

    // 牌组列表
    this.contentLayer.add(
      addPixelText(this, 56, isDay3Rumor ? 116 : 156, `当前牌组（${this.state.deck.length}张）：`, {
        color: PALETTE.ink.hex,
        origin: [0, 0],
      }),
    );

    if (this.state.deck.length === 0) {
      this.contentLayer.add(
        addPixelText(this, centerX, isDay3Rumor ? 174 : 212, '今日未收到新牌', {
          color: PALETTE.deepWood.hex,
          origin: 0.5,
        }),
      );
    } else if (this.state.deck.length <= 3) {
      const slotXs = [144, centerX, BASE_WIDTH - 144];
      const slotY = isDay3Rumor ? 174 : 212;
      const slotH = isDay3Rumor ? 36 : 42;
      this.state.deck.forEach((cardName, index) => {
        const x = slotXs[index] ?? centerX;
        const matchedItem = ITEMS.find((item) => item.cardName === cardName);
        const stripColor = matchedItem ? parseHexColor(matchedItem.color) : PALETTE.brass.num;

        this.contentLayer.add(
          this.add
            .rectangle(x, slotY, 164, slotH, PALETTE.paperWhite.num)
            .setStrokeStyle(2, PALETTE.ink.num),
        );
        this.contentLayer.add(
          this.add.rectangle(x, slotY - Math.floor(slotH / 2) + 4, 160, 4, stripColor),
        );
        this.contentLayer.add(
          addPixelText(this, x, slotY + 2, cardName, {
            color: PALETTE.ink.hex,
            origin: 0.5,
          }),
        );
      });
    } else {
      // 多天累计牌组超过 3 张时，分两行紧凑展示，防止重叠
      const slotXs = [144, centerX, BASE_WIDTH - 144];
      const maxSlots = 6;
      const visible = this.state.deck.slice(0, this.state.deck.length > maxSlots ? 5 : maxSlots);
      visible.forEach((cardName, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const x = slotXs[col];
        const y = isDay3Rumor ? (row === 0 ? 158 : 192) : row === 0 ? 196 : 236;
        const boxH = isDay3Rumor ? 28 : 30;
        const matchedItem = ITEMS.find((item) => item.cardName === cardName);
        const stripColor = matchedItem ? parseHexColor(matchedItem.color) : PALETTE.brass.num;

        this.contentLayer.add(
          this.add
            .rectangle(x, y, 164, boxH, PALETTE.paperWhite.num)
            .setStrokeStyle(2, PALETTE.ink.num),
        );
        this.contentLayer.add(
          this.add.rectangle(x, y - Math.floor(boxH / 2) + 2, 160, 2, stripColor),
        );
        this.contentLayer.add(
          addPixelText(this, x, y + 2, cardName, {
            color: PALETTE.ink.hex,
            origin: 0.5,
          }),
        );
      });
      if (this.state.deck.length > maxSlots) {
        this.contentLayer.add(
          addPixelText(this, slotXs[2], isDay3Rumor ? 192 : 236, `等${this.state.deck.length}张`, {
            color: PALETTE.deepWood.hex,
            origin: 0.5,
          }),
        );
      }
    }

    if (isDay3Rumor) {
      // P10 子项 6 修 1：day3Rumor 使用 wrapCjkText 折行，文案一字不改、完整显示在面板内（y=214..274）
      this.contentLayer.add(
        this.add
          .rectangle(centerX, 244, cardWidth - 24, 58, PALETTE.deepWood.num)
          .setStrokeStyle(2, PALETTE.brass.num),
      );
      this.contentLayer.add(
        addPixelText(this, centerX, 244, formatDay3Rumor(chapterCfg.day3Rumor), {
          color: PALETTE.lampYellow.hex,
          origin: 0.5,
          align: 1,
          lineSpacing: 0,
        }),
      );
    }

    // 进入夜里牌局按钮（经 6 帧拉灯转场）+ 返回标题按钮
    const nightDemonId = selectDemonForChapterDay(
      this.save.chapter.currentChapter,
      this.save.chapter.dayInChapter,
      this.seed,
    );
    const bossDay = isBossDay(this.save.chapter.currentChapter, this.save.chapter.dayInChapter);
    const enterLabel = bossDay ? '迎战大心魔' : '进入夜里牌局';

    this.addActionButton(
      PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON.x,
      PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON.y,
      PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON.width,
      PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON.height,
      enterLabel,
      null,
      () => {
        audio.unlock();
        audio.playSfx('button_click');
        const nextChapter = cloneChapterState(this.save.chapter);
        nextChapter.bossBattleActive = bossDay;
        const updatedSave: SaveData = {
          ...this.save,
          day: this.state.day,
          money: this.state.money,
          reputation: this.state.reputation,
          deck: [...this.state.deck],
          redeemTickets: this.state.redeemTickets ?? this.save.redeemTickets,
          chapter: nextChapter,
        };
        const demonHpBonus = bossDay ? 0 : getNightDemonHpBonus(nextChapter);

        this.scene.start('TransitionScene', {
          next: 'CardBattleScene',
          payload: {
            deck: [...this.state.deck],
            demonId: nightDemonId,
            demonHpBonus,
            maxRenqing: maxRenqingForLevel(updatedSave.shopLevel),
            save: updatedSave,
            tutorial: cloneTutorialState(this.tutorial),
          },
        });
      },
    );

    this.addActionButton(
      PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON.x,
      PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON.y,
      PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON.width,
      PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON.height,
      '返回标题',
      null,
      () => {
        audio.unlock();
        audio.playSfx('button_click');
        this.scene.start('TitleScene');
      },
    );
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
        .rectangle(centerX, panelCenterY, BASE_WIDTH - 32, panelHeight, PALETTE.candle.num)
        .setStrokeStyle(2, PALETTE.ink.num),
    );

    // 左侧旧物 32×32 真像素插画（2×2 渲染为 64×64，框 80×80）
    this.contentLayer.add(
      this.add
        .rectangle(boxX, boxY, 80, 80, PALETTE.paperWhite.num)
        .setStrokeStyle(2, PALETTE.ink.num),
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
    // A3 + WCAG 对比度审计：买不起的档位采用深木灰显样式（深木底 + 木棕边 + 旧纸字 CR 6.81:1），
    // 点击时绝不触发成交/扣钱/RNG，仅给出“钱不够”轻提示。
    const textColor = disabled ? PALETTE.oldPaper.hex : PALETTE.ink.hex;
    if (disabled) {
      const bg = this.add
        .rectangle(x, y, width, height, PALETTE.deepWood.num)
        .setStrokeStyle(2, PALETTE.woodBrown.num);
      if (onDisabledClick) {
        bg.setInteractive({ useHandCursor: false });
        bg.on('pointerdown', onDisabledClick);
      }
      this.contentLayer.add(bg);
    } else {
      const bg = this.add
        .rectangle(x, y, width, height, fillColor)
        .setStrokeStyle(2, PALETTE.ink.num)
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
      addPixelText(this, x, y - 13, topText, {
        color: textColor,
        origin: 0.5,
      }),
    );

    this.contentLayer.add(
      addPixelText(this, x, y + 13, bottomText, {
        color: textColor,
        origin: 0.5,
      }),
    );
  }

  private handleUnaffordableClick(): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }
    this.dismissShopkeeperBanner();
    audio.unlock();
    audio.playSfx('insufficient_funds');
    this.showToast('钱不够');
  }

  private handleSkip(): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }

    this.dismissShopkeeperBanner();
    audio.unlock();
    audio.playSfx('button_click');
    const skipRepDelta = getSkipCustomerReputationDelta(
      this.save.chapter.pactChoice,
      this.save.chapter.currentChapter,
    );
    this.state = skipCustomer(this.state, { reputationDelta: skipRepDelta });
    this.maybeTriggerDay6SideQuestOrSummary();
    this.renderCurrentPhase();
  }

  private handleOffer(tier: OfferTier): void {
    if (this.state.phase !== 'negotiating') {
      return;
    }

    this.dismissShopkeeperBanner();

    // 钱不能变负数：买不起的档位直接 return（并提示“钱不够”），且必须在 resolveOffer 之前，
    // 否则会消耗 RNG、固定种子下的接受序列会漂移。
    const item = this.state.items[this.state.customerIndex];
    if (!item || !canAffordTier(this.state.money, item.trueValue, tier)) {
      audio.unlock();
      audio.playSfx('insufficient_funds');
      this.showToast('钱不够');
      return;
    }

    audio.unlock();
    // C3 + P7：口碑与性格共同修正低价与平价接受率，高价 100% 不变
    const rate = getEffectiveAcceptRate(tier, this.state.reputation, BALANCE, item.temperament);
    const accepted = resolveOffer(rate, this.rng);
    this.state = settle(this.state, tier, accepted);
    if (accepted) {
      this.save.chapter.pawnsCollected += 1;
      const existingPawned = this.save.chapter.pawnedItemIds ?? [];
      if (!existingPawned.includes(item.id)) {
        this.save.chapter.pawnedItemIds = [...existingPawned, item.id];
      }
      if (this.state.day === 1 && item.id === BRIDE_RING_ITEM_ID) {
        this.save.chapter.day1RingPawned = true;
      }
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
      audio.playSfx('offer_rejected');
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
      this.dismissShopkeeperBanner();
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
