import Phaser from 'phaser';
import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import { CARD_PIXEL_ART, DEMON_PIXEL_ART } from '../data/pixelart';
import { audio, installAudioDebugHook } from '../game/audio';
import {
  cancelPendingChoice,
  canPlayCard,
  createBattle,
  endTurn,
  formatEffectDescription,
  formatEffectShort,
  getIntent,
  playCard,
  resolvePendingChoice,
  toBattleDebugSnapshot,
  type BattleBalanceConfig,
  type BattleEvent,
  type BattleState,
  type CardDef,
  type DemonDef,
} from '../game/battle';
import {
  composeBoss,
  resolveDemonNarrative,
  type ComposedBossResult,
} from '../game/bossComposition';
import { TEST_DECK } from '../game/montecarlo';
import { ITEMS, PALETTE, parseHexColor, wrapCjkText } from '../game/pawnshop';
import { pixelRowsToTexture } from '../game/pixelart';
import { addPixelText } from '../game/pixelFont';
import { loadTutorialDone, maxRenqingForLevel, saveTutorialDone, type SaveData } from '../game/save';
import { cloneChapterState } from '../game/chapters';
import {
  advanceTutorialStep,
  cloneTutorialState,
  createTutorialState,
  getTutorialCopy,
  skipTutorial,
  syncTutorialForBattle,
  type TutorialState,
} from '../game/tutorial';
import { createTutorialBubble } from '../game/tutorialBubble';
import {
  BATTLE_CARD_HEIGHT,
  BATTLE_CARD_WIDTH,
  BATTLE_DETAIL_TOGGLE_BUTTON,
  BATTLE_EMPTY_RETURN_BUTTON,
  BATTLE_END_TURN_BUTTON,
  BATTLE_HAND_Y,
  computeHandCardX,
  DEMON_HP_BAR_RECT,
  DEMON_INTRO_BANNER_RECT,
} from '../game/layout';
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';
import type { ResultSceneData } from './ResultScene';

export {
  BATTLE_DETAIL_TOGGLE_BUTTON,
  computeHandCardX,
  DEMON_HP_BAR_RECT,
  DEMON_INTRO_BANNER_RECT,
} from '../game/layout';

export interface CardBattleSceneData {
  deck?: string[];
  demonId?: string;
  demonHpBonus?: number;
  maxRenqing?: number;
  save?: SaveData;
  tutorial?: TutorialState;
}

interface HandSlotView {
  slotIndex: number;
  currentHandIndex: number;
  card: CardDef;
  x: number;
  y: number;
  container: Phaser.GameObjects.Container;
  frame: Phaser.GameObjects.Rectangle;
  artImage: Phaser.GameObjects.Image;
  costText: Phaser.GameObjects.BitmapText;
  nameText: Phaser.GameObjects.BitmapText;
  effectText: Phaser.GameObjects.BitmapText;
  consumed: boolean;
  queued: boolean;
}

const HUD_HEIGHT = 36;
const DEMON_X = 148;
const DEMON_Y = 84;
const CARD_WIDTH = BATTLE_CARD_WIDTH;
const CARD_HEIGHT = BATTLE_CARD_HEIGHT;
const HAND_Y = BATTLE_HAND_Y;
const END_TURN_X = BATTLE_END_TURN_BUTTON.x;
const END_TURN_Y = BATTLE_END_TURN_BUTTON.y;
const END_TURN_W = BATTLE_END_TURN_BUTTON.width;
const END_TURN_H = BATTLE_END_TURN_BUTTON.height;
const FLY_DURATION_MS = 240;
const AFTERIMAGE_MS = 83;
const SHATTER_DURATION_MS = 380;
const DEMON_ACT_MS = 180;
const INTRO_BANNER_MS = 2400;

const CARDS: readonly CardDef[] = cardsJson as CardDef[];
const DEMONS: readonly DemonDef[] = demonsJson as DemonDef[];
const BASE_BATTLE_BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

const NIGHT_BACKDROP_RECTS: readonly [number, number, number, number, number, number?][] = [
  [Math.floor(BASE_WIDTH / 2), Math.floor(BASE_HEIGHT / 2), BASE_WIDTH, BASE_HEIGHT, PALETTE.deepBlue.num],
  [52, 88, 76, 68, PALETTE.nightBlack.num, PALETTE.nightBlue.num],
  [36, 72, 10, 10, PALETTE.silverBlue.num],
  [40, 72, 6, 6, PALETTE.nightBlack.num],
  [68, 68, 4, 4, PALETTE.silverBlue.num],
  [62, 84, 4, 4, PALETTE.mistBlue.num],
  [52, 88, 4, 68, PALETTE.nightBlue.num],
  [52, 88, 76, 4, PALETTE.nightBlue.num],
  [584, 112, 52, 28, PALETTE.nightBlue.num],
  [584, 96, 32, 8, PALETTE.lampYellow.num],
  [584, 104, 40, 6, PALETTE.brass.num],
  [584, 78, 40, 20, PALETTE.brass.num, PALETTE.nightBlack.num],
  [584, 72, 24, 6, PALETTE.lampYellow.num],
  [584, 108, 8, 28, PALETTE.nightBlack.num],
  [584, 124, 32, 8, PALETTE.brass.num],
  [Math.floor(BASE_WIDTH / 2), 130, BASE_WIDTH, 4, PALETTE.nightBlue.num],
  [Math.floor(BASE_WIDTH / 2), 218, BASE_WIDTH, 2, PALETTE.nightBlue.num],
  [Math.floor(BASE_WIDTH / 2), 356, BASE_WIDTH, 8, PALETTE.nightBlack.num],
];

export class CardBattleScene extends Phaser.Scene {
  private state!: BattleState;
  private save?: SaveData;
  private tutorial!: TutorialState;
  private originalDeck: string[] = [];
  private isAnimating = false;
  private isEmptyDeck = false;
  private composedBoss: ComposedBossResult | null = null;
  private isDemonLinked = false;
  private feedbackMessage = '';
  private inspectedCardName: string | null = null;
  private detailMode: 'effect' | 'story' = 'effect';

  private handSlots: HandSlotView[] = [];
  private playQueue: number[] = [];
  private inFlightSlotIndex: number | null = null;
  private queuedEndTurn = false;

  private hudLayer!: Phaser.GameObjects.Container;
  private demonLayer!: Phaser.GameObjects.Container;
  private detailLayer!: Phaser.GameObjects.Container;
  private handLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
  private introBanner?: Phaser.GameObjects.Container;
  private introBannerTimer?: Phaser.Time.TimerEvent;
  private tutorialBubble?: Phaser.GameObjects.Container;
  private feedbackText!: Phaser.GameObjects.BitmapText;
  private endTurnBg!: Phaser.GameObjects.Rectangle;
  private endTurnLabel!: Phaser.GameObjects.BitmapText;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'CardBattleScene' });
  }

  create(data?: CardBattleSceneData): void {
    this.isAnimating = false;
    this.isEmptyDeck = false;
    this.composedBoss = null;
    this.isDemonLinked = false;
    this.feedbackMessage = '';
    this.inspectedCardName = null;
    this.detailMode = 'effect';
    this.handSlots = [];
    this.playQueue = [];
    this.inFlightSlotIndex = null;
    this.queuedEndTurn = false;
    this.introBanner = undefined;
    this.introBannerTimer = undefined;
    this.tutorialBubble = undefined;
    this.save = data?.save
      ? {
          ...data.save,
          deck: [...data.save.deck],
          chapter: cloneChapterState(data.save.chapter),
        }
      : undefined;
    this.tutorial = data?.tutorial
      ? cloneTutorialState(data.tutorial)
      : createTutorialState({ day: this.save?.day ?? 1, tutorialDone: true });

    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const demonParam = params.get('demon');
    const deckParam = params.get('deck');
    const resolvedDemonId =
      demonParam && DEMONS.some((d) => d.id === demonParam)
        ? demonParam
        : (data?.demonId ?? 'a');
    const resolvedDeck =
      deckParam === 'test' ? [...TEST_DECK] : data?.deck ? [...data.deck] : [];

    const resolvedMaxRenqing =
      data?.maxRenqing ??
      (this.save ? maxRenqingForLevel(this.save.shopLevel) : BASE_BATTLE_BALANCE.maxRenqing);
    const battleBalance: BattleBalanceConfig = {
      ...BASE_BATTLE_BALANCE,
      startingRenqing: resolvedMaxRenqing,
      maxRenqing: resolvedMaxRenqing,
    };

    this.originalDeck = [...resolvedDeck];
    installAudioDebugHook(audio);
    audio.playBgm('night');

    for (const [x, y, w, h, fill, stroke] of NIGHT_BACKDROP_RECTS) {
      const rect = this.add.rectangle(x, y, w, h, fill);
      if (stroke !== undefined) {
        rect.setStrokeStyle(2, stroke);
      }
    }

    if (resolvedDeck.length === 0) {
      this.isEmptyDeck = true;
      this.tutorial = syncTutorialForBattle(this.tutorial, 'empty_deck');
      this.renderEmptyDeckView(resolvedDemonId, battleBalance);
      this.syncInputBounds();
      return;
    }

    const { rng } = createRngFromUrl();
    const baseDemon = DEMONS.find((d) => d.id === resolvedDemonId) ?? DEMONS[0];
    let createOpts: { demonHpBonus?: number; demonOverride?: DemonDef } = {
      demonHpBonus: data?.demonHpBonus ?? 0,
    };

    if (baseDemon?.isBoss && baseDemon.composition) {
      const composed = composeBoss(resolvedDeck, this.save?.chapter.pactChoice ?? null, baseDemon);
      this.composedBoss = composed;
      if (this.save) {
        this.save.chapter.bossComponentItemIds = composed.activeComponents.map((c) => c.itemId);
      }
      createOpts = { demonOverride: composed.bossDef };
    } else if (baseDemon) {
      const narrative = resolveDemonNarrative(
        baseDemon,
        resolvedDeck,
        this.save?.chapter.pawnedItemIds ?? [],
        ITEMS,
      );
      this.isDemonLinked = narrative.isLinked;
      createOpts = {
        demonHpBonus: data?.demonHpBonus ?? 0,
        demonOverride: {
          ...baseDemon,
          customerLink: narrative.customerLink,
          aftermathLine: narrative.aftermathLine,
        },
      };
    }

    this.state = createBattle(
      resolvedDeck,
      resolvedDemonId,
      rng,
      CARDS,
      DEMONS,
      battleBalance,
      undefined,
      createOpts,
    );
    this.tutorial = syncTutorialForBattle(this.tutorial, 'play');

    window.__BATTLE_DEBUG__ = {
      getState: () => ({
        ...toBattleDebugSnapshot(this.state, this.isAnimating || this.playQueue.length > 0),
        demonIntroBannerText: this.buildDemonIntroBannerText(),
        detailMode: this.detailMode,
        queuedCount: this.playQueue.length,
        day: this.save?.day ?? 1,
        shopLevel: this.save?.shopLevel ?? 1,
        bossComponentCount: this.composedBoss?.componentCount,
        bossComposedChargeThreshold: this.composedBoss?.chargeThreshold,
        bossFragmentNames: this.composedBoss ? [...this.composedBoss.fragmentNames] : undefined,
        bossContributionLines: this.composedBoss
          ? [...this.composedBoss.contributionLines]
          : undefined,
        tutorialActive: this.tutorial.active,
        currentStep: this.tutorial.currentStep,
        tutorialDone: this.tutorial.done || loadTutorialDone(),
        tutorialCopy: getTutorialCopy(this.tutorial.currentStep),
      }),
    };

    this.hudLayer = this.add.container(0, 0);
    this.demonLayer = this.add.container(0, 0);
    this.detailLayer = this.add.container(0, 0);
    this.handLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0).setDepth(50);

    this.createActionStrip();
    this.renderBattle();
    this.showDemonIntroBanner();
    this.renderTutorialBubble();
    this.syncInputBounds();
  }

  private formatBossBannerLines(composed: ComposedBossResult): string[] {
    if (composed.isBare) {
      return [composed.introSummary];
    }
    const frags = composed.fragmentNames;
    if (frags.length <= 2) {
      return [frags.join('·'), composed.introSummary];
    }
    // 3–6 个碎片按字数均衡分两行（每行 <= 18 字 = 216px），确保在 228px 横幅内左右留白
    if (frags.length === 6) {
      const lineA = [frags[0], frags[2], frags[3]].join('·'); // 表·书·车 (18字)
      const lineB = [frags[1], frags[4], frags[5]].join('·'); // 戒·琴·邮 (18字)
      return [lineA, lineB, composed.introSummary];
    }
    const splitAt = Math.ceil(frags.length / 2);
    const row1 = frags.slice(0, splitAt).join('·');
    const row2 = frags.slice(splitAt).join('·');
    return [row1, row2, composed.introSummary];
  }

  private buildDemonIntroBannerText(): string {
    if (this.composedBoss) {
      const header = `${this.state.demonName} 现身`;
      return [header, ...this.formatBossBannerLines(this.composedBoss)].join('\n');
    }
    const parts: string[] = [`心魔「${this.state.demonName}」现身`];
    if (this.state.demonCustomerLink) {
      parts.push(this.state.demonCustomerLink);
    }
    if (this.state.demonIntroLine) {
      parts.push(this.state.demonIntroLine);
    }
    return parts.join('\n');
  }

  private showDemonIntroBanner(): void {
    this.dismissIntroBanner();
    if (!this.composedBoss && !this.state.demonIntroLine && !this.state.demonCustomerLink) {
      return;
    }
    // 五区制中部带（常规 y=132..214，Boss 2 行 y=131..215，Boss 3 行 y=126..222），
    // 全程非阻塞、不遮挡上方心魔血条（y=72..80）、下方手牌（y=224..352）、左侧[故]钮与右侧结束回合按钮
    const isBoss3Line = Boolean(
      this.composedBoss && !this.composedBoss.isBare && this.composedBoss.fragmentNames.length > 2,
    );
    const isBoss2Line = Boolean(
      this.composedBoss && !this.composedBoss.isBare && this.composedBoss.fragmentNames.length <= 2,
    );
    const bannerH = isBoss3Line ? 104 : isBoss2Line ? 84 : DEMON_INTRO_BANNER_RECT.height;
    const bannerW = this.composedBoss ? 452 : DEMON_INTRO_BANNER_RECT.width;
    const cx = Math.floor(DEMON_INTRO_BANNER_RECT.x + DEMON_INTRO_BANNER_RECT.width / 2);
    const cy = isBoss3Line
      ? 171
      : Math.floor(DEMON_INTRO_BANNER_RECT.y + DEMON_INTRO_BANNER_RECT.height / 2);
    const topY = cy - Math.floor(bannerH / 2);
    const banner = this.add.container(0, 0).setDepth(90);
    const bg = this.add
      .rectangle(cx, cy, bannerW, bannerH, PALETTE.nightBlack.num)
      .setStrokeStyle(4, PALETTE.vermilion.num);

    if (this.composedBoss) {
      const lines = this.formatBossBannerLines(this.composedBoss);
      const children: Phaser.GameObjects.GameObject[] = [
        bg,
        addPixelText(this, cx, isBoss2Line ? topY + 16 : topY + 15, `${this.state.demonName} 现身`, {
          color: PALETTE.lampYellow.hex,
          origin: 0.5,
        }),
      ];
      if (this.composedBoss.isBare) {
        children.push(
          addPixelText(this, cx, topY + 48, lines[0], {
            color: PALETTE.paperWhite.hex,
            origin: 0.5,
          }),
        );
      } else if (lines.length === 2) {
        children.push(
          addPixelText(this, cx, topY + 42, lines[0], {
            color: PALETTE.oldPaper.hex,
            origin: 0.5,
          }),
          addPixelText(this, cx, topY + 68, lines[1], {
            color: PALETTE.paperWhite.hex,
            origin: 0.5,
          }),
        );
      } else {
        children.push(
          addPixelText(this, cx, topY + 37, lines[0], {
            color: PALETTE.oldPaper.hex,
            origin: 0.5,
          }),
          addPixelText(this, cx, topY + 59, lines[1], {
            color: PALETTE.oldPaper.hex,
            origin: 0.5,
          }),
          addPixelText(this, cx, topY + 83, lines[2], {
            color: PALETTE.paperWhite.hex,
            origin: 0.5,
          }),
        );
      }
      banner.add(children);
      this.introBanner = banner;
      this.introBannerTimer = this.time.delayedCall(INTRO_BANNER_MS, () => this.dismissIntroBanner());
      return;
    }

    const children: Phaser.GameObjects.GameObject[] = [
      bg,
      addPixelText(this, cx, DEMON_INTRO_BANNER_RECT.y + 16, `心魔「${this.state.demonName}」现身`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    ];
    if (this.state.demonCustomerLink) {
      children.push(
        addPixelText(this, cx, DEMON_INTRO_BANNER_RECT.y + 42, this.state.demonCustomerLink, {
          color: PALETTE.silverBlue.hex,
          origin: 0.5,
        }),
      );
    }
    if (this.state.demonIntroLine) {
      children.push(
        addPixelText(
          this,
          cx,
          this.state.demonCustomerLink ? DEMON_INTRO_BANNER_RECT.y + 66 : DEMON_INTRO_BANNER_RECT.y + 48,
          this.state.demonIntroLine,
          {
            color: PALETTE.paperWhite.hex,
            origin: 0.5,
          },
        ),
      );
    }
    banner.add(children);
    this.introBanner = banner;
    this.introBannerTimer = this.time.delayedCall(INTRO_BANNER_MS, () => this.dismissIntroBanner());
  }

  private dismissIntroBanner(): void {
    this.introBannerTimer?.remove(false);
    this.introBannerTimer = undefined;
    this.introBanner?.destroy();
    this.introBanner = undefined;
  }

  private renderTutorialBubble(): void {
    this.tutorialBubble?.destroy();
    this.tutorialBubble = undefined;
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

  private renderEmptyDeckView(demonId: string, battleBalance: BattleBalanceConfig): void {
    const demon = DEMONS.find((d) => d.id === demonId) ?? DEMONS[0];
    window.__BATTLE_DEBUG__ = {
      getState: () => ({
        phase: 'empty_deck',
        round: 0,
        playerHp: battleBalance.startingHp,
        shield: 0,
        renqing: battleBalance.startingRenqing,
        maxRenqing: battleBalance.maxRenqing,
        demonHp: demon?.hp ?? 0,
        hand: [],
        deckCount: 0,
        discardCount: 0,
        pendingChoice: null,
        result: 'empty_deck',
        demonId: demon?.id ?? demonId,
        demonName: demon?.name ?? '',
        demonIntroLine: demon?.introLine ?? '',
        intent: { current: null, next: null, upcomingSkill: null },
        isAnimating: false,
        day: this.save?.day ?? 1,
        shopLevel: this.save?.shopLevel ?? 1,
        tutorialActive: this.tutorial.active,
        currentStep: this.tutorial.currentStep,
        tutorialDone: this.tutorial.done || loadTutorialDone(),
        tutorialCopy: getTutorialCopy(this.tutorial.currentStep),
      }),
    };

    const cx = Math.floor(BASE_WIDTH / 2);
    this.add.rectangle(cx, 180, 440, 192, PALETTE.nightBlack.num).setStrokeStyle(2, PALETTE.mistBlue.num);
    addPixelText(this, cx, 136, '没有牌可打', { color: PALETTE.paperWhite.hex, origin: 0.5 });
    addPixelText(this, cx, 176, '白天未收到旧物纸牌', { color: PALETTE.silverBlue.hex, origin: 0.5 });

    const btn = this.add
      .rectangle(
        BATTLE_EMPTY_RETURN_BUTTON.x,
        BATTLE_EMPTY_RETURN_BUTTON.y,
        BATTLE_EMPTY_RETURN_BUTTON.width,
        BATTLE_EMPTY_RETURN_BUTTON.height,
        PALETTE.deepBlue.num,
      )
      .setStrokeStyle(2, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });
    addPixelText(this, BATTLE_EMPTY_RETURN_BUTTON.x, BATTLE_EMPTY_RETURN_BUTTON.y, '返回标题', {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });
    btn.on('pointerover', () => btn.setFillStyle(PALETTE.nightBlue.num));
    btn.on('pointerout', () => btn.setFillStyle(PALETTE.deepBlue.num));
    btn.on('pointerdown', () => {
      audio.unlock();
      audio.playSfx('button_click');
      this.scene.start('TitleScene');
    });
  }

  private createActionStrip(): void {
    this.feedbackText = addPixelText(this, 12, 204, '', {
      color: PALETTE.silverBlue.hex,
      origin: [0, 0.5],
    });
    this.endTurnBg = this.add
      .rectangle(END_TURN_X, END_TURN_Y, END_TURN_W, END_TURN_H, PALETTE.nightBlack.num)
      .setStrokeStyle(2, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });
    this.endTurnLabel = addPixelText(this, END_TURN_X, END_TURN_Y, '结束回合', {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });
    this.endTurnBg.on('pointerover', () => {
      if (!this.isAnimating && this.state.phase === 'play') {
        this.endTurnBg.setFillStyle(PALETTE.nightBlue.num);
      }
    });
    this.endTurnBg.on('pointerout', () => this.endTurnBg.setFillStyle(PALETTE.nightBlack.num));
    this.endTurnBg.on('pointerdown', () => {
      if (this.state.pendingChoice) {
        this.handleCancelChoice();
      } else {
        this.handleEndTurn();
      }
    });
  }

  private renderBattle(): void {
    if (this.isEmptyDeck) {
      return;
    }
    this.renderHud();
    this.renderDemonArea();
    this.renderHand();
    this.renderCardDetailPanel();

    const choice = this.state.pendingChoice;
    this.feedbackText.setText(choice ? `${choice.sourceCardName}：${choice.prompt}` : this.feedbackMessage);
    this.feedbackText.setTint(choice ? PALETTE.lampYellow.num : PALETTE.silverBlue.num);

    const canAct =
      !this.isAnimating &&
      this.playQueue.length === 0 &&
      this.state.phase === 'play' &&
      this.state.result === 'ongoing';
    this.endTurnLabel.setText(choice ? '取消选牌' : '结束回合');
    this.endTurnBg.setFillStyle(canAct ? PALETTE.nightBlack.num : PALETTE.deepBlue.num);
    this.endTurnLabel.setTint(canAct ? PALETTE.paperWhite.num : PALETTE.mistBlue.num);
  }

  private renderHud(): void {
    this.hudLayer.removeAll(true);
    const cx = Math.floor(BASE_WIDTH / 2);
    const hudY = Math.floor(HUD_HEIGHT / 2);
    const hpText =
      this.state.shield > 0
        ? `命${this.state.playerHp} 盾${this.state.shield}`
        : `命${this.state.playerHp}/${this.state.maxPlayerHp}`;

    this.hudLayer.add([
      this.add.rectangle(cx, hudY, BASE_WIDTH, HUD_HEIGHT, PALETTE.nightBlack.num),
      this.add.rectangle(cx, HUD_HEIGHT, BASE_WIDTH, 2, PALETTE.nightBlue.num),
      addPixelText(this, 12, hudY, hpText, { color: PALETTE.lampYellow.hex, origin: [0, 0.5] }),
      addPixelText(this, 180, hudY, `人情${this.state.renqing}/${this.state.maxRenqing}`, {
        color: PALETTE.brass.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 340, hudY, `第${this.state.round}/${this.state.maxRounds}回`, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0.5],
      }),
      addPixelText(
        this,
        BASE_WIDTH - 12,
        hudY,
        `抽${this.state.drawPile.length} 弃${this.state.discardPile.length}`,
        { color: PALETTE.silverBlue.hex, origin: [1, 0.5] },
      ),
    ]);
  }

  private renderDemonArea(): void {
    this.demonLayer.removeAll(true);
    const demonRows = DEMON_PIXEL_ART[this.state.demonId] ?? DEMON_PIXEL_ART.a;
    const demonTexKey = pixelRowsToTexture(this, `demon-art-${this.state.demonId}`, demonRows);

    const barW = DEMON_HP_BAR_RECT.width;
    const fillW = Math.max(
      0,
      Math.round(barW * (this.state.demonMaxHp > 0 ? this.state.demonHp / this.state.demonMaxHp : 0)),
    );

    const demonTitle = this.state.isBoss ? this.state.demonName : `心魔:${this.state.demonName}`;
    const hpLabel =
      this.state.demonShield > 0
        ? `血${this.state.demonHp}/${this.state.demonMaxHp} 盾${this.state.demonShield}`
        : `血${this.state.demonHp}/${this.state.demonMaxHp}`;

    this.demonLayer.add([
      this.add
        .rectangle(DEMON_X, DEMON_Y, 80, 80, PALETTE.nightBlack.num)
        .setStrokeStyle(2, this.state.isBoss ? PALETTE.vermilion.num : PALETTE.nightBlue.num),
      this.add.image(DEMON_X, DEMON_Y, demonTexKey).setOrigin(0.5),
      this.add
        .rectangle(370, 84, 340, 84, PALETTE.nightBlack.num)
        .setStrokeStyle(2, this.state.isBoss ? PALETTE.vermilion.num : PALETTE.nightBlue.num),
      addPixelText(this, 212, 46, demonTitle, {
        color: this.state.isBoss ? PALETTE.lampYellow.hex : PALETTE.paperWhite.hex,
        origin: [0, 0],
      }),
      addPixelText(this, 528, 46, hpLabel, {
        color: this.state.demonShield > 0 ? PALETTE.silverBlue.hex : PALETTE.lampYellow.hex,
        origin: [1, 0],
      }),
      this.add.rectangle(
        DEMON_HP_BAR_RECT.x + Math.floor(barW / 2),
        DEMON_HP_BAR_RECT.y,
        barW,
        DEMON_HP_BAR_RECT.height,
        PALETTE.deepBlue.num,
      ),
    ]);

    if (fillW > 0) {
      this.demonLayer.add(
        this.add.rectangle(
          DEMON_HP_BAR_RECT.x + Math.floor(fillW / 2),
          DEMON_HP_BAR_RECT.y,
          fillW,
          DEMON_HP_BAR_RECT.height,
          PALETTE.vermilion.num,
        ),
      );
    }

    const intent = getIntent(this.state);
    if (intent.current) {
      let label: string;
      let labelColor: string;
      if (this.state.bossCharging) {
        label = `蓄力:${this.state.bossChargeSkill ?? '封门'}+${this.state.demonShield}盾`;
        labelColor = PALETTE.lampYellow.hex;
      } else if (
        this.state.bossChargeInterrupted &&
        this.state.round === this.state.bossChargeRound
      ) {
        label = '封门已打断!';
        labelColor = PALETTE.candle.hex;
      } else if (intent.current.skill) {
        label = `意图:${intent.current.skill}${intent.current.damage}伤`;
        labelColor = this.state.bossChargeInterrupted ? PALETTE.candle.hex : PALETTE.oldPaper.hex;
      } else {
        // 对比度审计：夜黑底意图字用银蓝(7.24:1)替雾蓝(3.60:1)
        label = `意图:攻${intent.current.damage}伤`;
        labelColor = PALETTE.silverBlue.hex;
      }
      this.demonLayer.add(
        addPixelText(this, 212, 92, label, {
          color: labelColor,
          origin: [0, 0],
        }),
      );
    }

    const nextIntent = intent.upcomingSkill ?? intent.next;
    if (nextIntent) {
      const nextLabel = nextIntent.skill ? `下回:${nextIntent.skill}${nextIntent.damage}` : `下回:攻${nextIntent.damage}`;
      this.demonLayer.add(
        addPixelText(this, 528, 92, nextLabel, {
          color:
            this.state.bossChargeInterrupted && nextIntent.round === 3
              ? PALETTE.candle.hex
              : nextIntent.skill
                ? PALETTE.oldPaper.hex
                : PALETTE.silverBlue.hex,
          origin: [1, 0],
        }),
      );
    } else {
      const badges: string[] = [];
      if (this.state.reflectNextDamage) badges.push('反伤');
      if (this.state.illuminateNextDraw) badges.push('照亮');
      if (this.state.nextRoundRenqingBonus > 0) badges.push(`下回+${this.state.nextRoundRenqingBonus}情`);
      if (badges.length > 0) {
        this.demonLayer.add(addPixelText(this, 528, 92, badges.join(' '), { color: PALETTE.candle.hex, origin: [1, 0] }));
      }
    }
  }

  private formatSingleLineCardEffect(card: CardDef): string {
    if (card.id === 'rewind') {
      return `${card.name}:${formatEffectDescription(card)}`;
    }
    if (card.id === 'tin_frog') {
      return `${card.name}(${card.cost}费):造成3伤，敌行动后改6伤`;
    }
    return `${card.name}(${card.cost}费):${formatEffectDescription(card)}`;
  }

  /**
   * P9 方案 C：中部双行详情条合并瘦身为单行详情条（y=81..95），净腾出 y=66..79 徽章带；
   * 左侧 [故]/[效] 像素钮原地切换故事与效果，故事/效果/费用均不丢失不溢出，
   * 保留 P8 在 y=95 与 feedbackText (y=97..109) 之间的 >=2px 清晰间隙。
   */
  private renderCardDetailPanel(): void {
    this.detailLayer.removeAll(true);
    let cardName = this.inspectedCardName;
    if (!cardName || !this.state.hand.includes(cardName)) {
      cardName = this.state.hand[0] ?? null;
      this.inspectedCardName = cardName;
    }
    const card = cardName ? this.state.cardsByName.get(cardName) : undefined;
    const cx = Math.floor(BASE_WIDTH / 2);

    // y=131..157 徽章与心魔关联带
    if (this.detailMode === 'effect') {
      if (this.state.bossCharging) {
        this.detailLayer.add([
          this.add
            .rectangle(cx, 144, BASE_WIDTH - 16, 26, PALETTE.nightBlack.num)
            .setStrokeStyle(2, PALETTE.vermilion.num),
          addPixelText(
            this,
            cx,
            144,
            `蓄力「${this.state.bossChargeSkill ?? '封门'}」打断:${this.state.bossChargeDamage}/${this.state.bossChargeThreshold} (返+${this.state.bossChargeRefundRenqing}情)`,
            {
              color: PALETTE.lampYellow.hex,
              origin: 0.5,
            },
          ),
        ]);
      } else if (
        this.state.bossChargeInterrupted &&
        this.state.round === this.state.bossChargeRound
      ) {
        this.detailLayer.add([
          this.add
            .rectangle(cx, 144, BASE_WIDTH - 16, 26, PALETTE.jade.num)
            .setStrokeStyle(2, PALETTE.paperWhite.num),
          addPixelText(
            this,
            cx,
            144,
            `已打断「${this.state.bossChargeSkill ?? '封门'}」！返还+${this.state.bossChargeRefundRenqing}人情，下回仅${this.state.bossInterruptedNextDamage ?? 3}伤`,
            {
              color: PALETTE.paperWhite.hex,
              origin: 0.5,
            },
          ),
        ]);
      } else if (this.composedBoss) {
        const badgeText = this.composedBoss.isBare
          ? '素体 · 柜子空了，债主只身前来'
          : this.composedBoss.componentCount <= 3
            ? `执念:${this.composedBoss.fragmentNames.join('·')}`
            : `执念(${this.composedBoss.componentCount}块):${this.composedBoss.activeComponents.map((c) => c.shortLabel).join('·')} 阈${this.composedBoss.chargeThreshold}`;
        this.detailLayer.add([
          this.add
            .rectangle(cx, 144, BASE_WIDTH - 16, 26, PALETTE.nightBlack.num)
            .setStrokeStyle(2, PALETTE.vermilion.num),
          addPixelText(this, cx, 144, badgeText, {
            color: PALETTE.silverBlue.hex,
            origin: 0.5,
          }),
        ]);
      } else if (this.state.demonCustomerLink) {
        const linkText = this.isDemonLinked
          ? `这是${this.state.demonCustomerLink}`
          : this.state.demonCustomerLink;
        this.detailLayer.add([
          this.add
            .rectangle(cx, 144, BASE_WIDTH - 16, 26, PALETTE.nightBlack.num)
            .setStrokeStyle(2, PALETTE.nightBlue.num),
          addPixelText(this, cx, 144, linkText, {
            color: PALETTE.silverBlue.hex,
            origin: 0.5,
          }),
        ]);
      }
    }

    if (!card) {
      return;
    }

    const isStory = this.detailMode === 'story';

    if (isStory) {
      // 故事模式：点击 [故] 展开完整折行故事（x=44..496, y=135..191，完全避开 [故] 钮 x=8..40）
      this.detailLayer.add([
        this.add
          .rectangle(270, 163, 452, 56, PALETTE.nightBlack.num)
          .setStrokeStyle(2, PALETTE.brass.num),
        addPixelText(
          this,
          54,
          139,
          wrapCjkText(`${card.name}(${card.cost}费)：${card.story}`, 18),
          {
            color: PALETTE.candle.hex,
            origin: [0, 0],
            lineSpacing: 1,
          },
        ),
      ]);
    } else {
      // 默认单行详情条（x=44..496, y=163..191）
      this.detailLayer.add([
        this.add
          .rectangle(270, 177, 452, 28, PALETTE.nightBlack.num)
          .setStrokeStyle(2, PALETTE.brass.num),
        addPixelText(this, 54, 177, this.formatSingleLineCardEffect(card), {
          color: PALETTE.lampYellow.hex,
          origin: [0, 0.5],
        }),
      ]);
    }

    // 左侧切换小钮 [故] / [效]
    const toggleBtn = this.add
      .rectangle(
        BATTLE_DETAIL_TOGGLE_BUTTON.x,
        BATTLE_DETAIL_TOGGLE_BUTTON.y,
        BATTLE_DETAIL_TOGGLE_BUTTON.width,
        BATTLE_DETAIL_TOGGLE_BUTTON.height,
        isStory ? PALETTE.brass.num : PALETTE.deepBlue.num,
      )
      .setStrokeStyle(2, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });

    const toggleLabel = addPixelText(
      this,
      BATTLE_DETAIL_TOGGLE_BUTTON.x,
      BATTLE_DETAIL_TOGGLE_BUTTON.y,
      isStory ? '效' : '故',
      {
        color: isStory ? PALETTE.ink.hex : PALETTE.candle.hex,
        origin: 0.5,
      },
    );

    toggleBtn.on('pointerdown', () => {
      this.dismissIntroBanner();
      audio.unlock();
      audio.playSfx('button_click');
      this.detailMode = this.detailMode === 'effect' ? 'story' : 'effect';
      this.renderCardDetailPanel();
    });

    this.detailLayer.add([toggleBtn, toggleLabel]);
  }

  private renderHand(): void {
    this.handLayer.removeAll(true);
    this.handSlots = [];

    const count = this.state.hand.length;
    const isChoiceMode = this.state.pendingChoice !== null;

    this.state.hand.forEach((cardName, index) => {
      const card = this.state.cardsByName.get(cardName);
      if (!card) {
        return;
      }

      const x = computeHandCardX(index, count);
      const y = isChoiceMode ? HAND_Y - 6 : HAND_Y;
      const selectable = isChoiceMode || canPlayCard(this.state, index);
      const stripColor = card.color ? parseHexColor(card.color) : PALETTE.brass.num;

      const cardContainer = this.add.container(x, y);
      // P10 子项 2：不可出牌改银蓝底+夜黑字（CR 7.24 vs 原雾蓝 3.60），费用徽章与效果字均为最高对比度
      const bgColor = isChoiceMode
        ? PALETTE.candle.num
        : selectable
          ? PALETTE.paperWhite.num
          : PALETTE.silverBlue.num;
      const borderColor = isChoiceMode
        ? PALETTE.lampYellow.num
        : selectable
          ? PALETTE.ink.num
          : PALETTE.nightBlack.num;

      const frame = this.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, bgColor).setStrokeStyle(2, borderColor);
      const strip = this.add.rectangle(0, -60, CARD_WIDTH - 4, 4, stripColor);
      const artKey = pixelRowsToTexture(this, `card-art-${card.id}`, CARD_PIXEL_ART[card.id] ?? CARD_PIXEL_ART.old_book);
      const artImage = this.add.image(0, -22, artKey).setOrigin(0.5);
      if (!selectable) {
        artImage.setTint(PALETTE.silverBlue.num);
      }

      const costBg = this.add
        .rectangle(-34, -48, 24, 24, card.cost === 0 ? PALETTE.jade.num : PALETTE.lampYellow.num)
        .setStrokeStyle(2, PALETTE.ink.num);
      const textHex = selectable ? PALETTE.ink.hex : PALETTE.nightBlack.hex;
      const costTextHex = card.cost === 0 ? PALETTE.paperWhite.hex : textHex;
      const costText = addPixelText(this, -34, -48, `${card.cost}`, { color: costTextHex, origin: 0.5 });
      const nameText = addPixelText(this, 0, 24, card.name, { color: textHex, origin: 0.5 });
      const effectText = addPixelText(this, 0, 48, formatEffectShort(card), {
        color: textHex,
        origin: 0.5,
      });

      cardContainer.add([frame, strip, artImage, costBg, costText, nameText, effectText]);

      const slotView: HandSlotView = {
        slotIndex: index,
        currentHandIndex: index,
        card,
        x,
        y,
        container: cardContainer,
        frame,
        artImage,
        costText,
        nameText,
        effectText,
        consumed: false,
        queued: false,
      };
      this.handSlots.push(slotView);

      frame.setInteractive({ useHandCursor: selectable });
      frame.on('pointerover', () => {
        if (slotView.consumed) return;
        this.inspectedCardName = card.name;
        this.renderCardDetailPanel();
        if (this.state.pendingChoice) {
          cardContainer.y = HAND_Y - 12;
          frame.setStrokeStyle(2, PALETTE.vermilion.num);
        } else if (!slotView.queued && this.canQueueOrPlaySlot(slotView)) {
          cardContainer.y = HAND_Y - 8;
          frame.setStrokeStyle(2, PALETTE.lampYellow.num);
        }
      });
      frame.on('pointerout', () => {
        if (slotView.consumed || slotView.queued) return;
        if (this.state.pendingChoice) {
          cardContainer.y = HAND_Y - 6;
          frame.setStrokeStyle(2, PALETTE.lampYellow.num);
          return;
        }
        cardContainer.y = HAND_Y;
        frame.setStrokeStyle(2, this.canQueueOrPlaySlot(slotView) ? PALETTE.ink.num : PALETTE.nightBlack.num);
      });
      frame.on('pointerdown', () => this.handleSlotClick(slotView.slotIndex));

      this.handLayer.add(cardContainer);
    });
  }

  private getProjectedResources(): { renqing: number; handCount: number } {
    let renqing = this.state.renqing;
    let handCount = this.state.hand.length;
    const pending = [
      ...(this.inFlightSlotIndex !== null ? [this.inFlightSlotIndex] : []),
      ...this.playQueue,
    ];
    for (const idx of pending) {
      const slot = this.handSlots[idx];
      if (!slot) continue;
      renqing -= slot.card.cost;
      handCount -= 1;
      for (const eff of slot.card.effects) {
        if (eff.type === 'renqing') renqing += eff.value ?? 0;
        else if (eff.type === 'discard_for_renqing') {
          renqing += eff.value ?? 0;
          handCount -= 1;
        } else if (eff.type === 'draw') handCount += eff.value ?? 0;
      }
    }
    return { renqing, handCount };
  }

  private canQueueOrPlaySlot(slot: HandSlotView): boolean {
    if (slot.consumed || slot.queued || slot.currentHandIndex < 0) return false;
    if (this.state.phase !== 'play' || this.state.result !== 'ongoing' || this.state.pendingChoice) {
      return false;
    }
    if (!this.isAnimating) {
      return canPlayCard(this.state, slot.currentHandIndex);
    }
    const projected = this.getProjectedResources();
    if (projected.renqing < slot.card.cost) return false;
    if (slot.card.effects.some((e) => e.type === 'discard_for_renqing') && projected.handCount < 2) {
      return false;
    }
    return true;
  }

  private refreshHandSlotsInPlace(): void {
    for (const slot of this.handSlots) {
      if (slot.consumed) {
        slot.container.setVisible(false);
        continue;
      }
      if (slot.queued) {
        slot.container.y = HAND_Y - 10;
        slot.frame.setFillStyle(PALETTE.candle.num);
        slot.frame.setStrokeStyle(2, PALETTE.lampYellow.num);
        continue;
      }
      const playable = this.canQueueOrPlaySlot(slot);
      slot.container.y = HAND_Y;
      slot.frame.setFillStyle(playable ? PALETTE.paperWhite.num : PALETTE.silverBlue.num);
      slot.frame.setStrokeStyle(2, playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
      if (playable) slot.artImage.clearTint();
      else slot.artImage.setTint(PALETTE.silverBlue.num);
      slot.costText.setTint(
        slot.card.cost === 0
          ? PALETTE.paperWhite.num
          : playable
            ? PALETTE.ink.num
            : PALETTE.nightBlack.num,
      );
      slot.nameText.setTint(playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
      slot.effectText.setTint(playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
    }
  }

  private handleSlotClick(slotIndex: number): void {
    const slot = this.handSlots[slotIndex];
    if (!slot || slot.consumed || slot.queued) return;

    this.dismissIntroBanner();
    this.inspectedCardName = slot.card.name;
    this.renderCardDetailPanel();

    // PendingChoice 选牌弃置模式：玩家点选具体要弃的手牌
    if (this.state.pendingChoice && !this.isAnimating) {
      audio.unlock();
      audio.playSfx('button_click');
      const { state, events } = resolvePendingChoice(this.state, slot.currentHandIndex);
      this.state = state;
      this.presentBattleEvents(events, slot.x, slot.y);
      if (this.state.result === 'win') {
        this.renderHud();
        this.renderHand();
        this.feedbackText.setText(`击败心魔「${this.state.demonName}」！`);
        this.playDemonShatterAndFinish();
        return;
      }
      this.renderBattle();
      return;
    }

    if (!this.canQueueOrPlaySlot(slot)) return;

    if (this.isAnimating) {
      slot.queued = true;
      this.playQueue.push(slotIndex);
      audio.unlock();
      audio.playSfx('button_click');
      this.refreshHandSlotsInPlace();
      return;
    }

    this.launchSlotAnimation(slotIndex);
  }

  private handleCancelChoice(): void {
    if (!this.state.pendingChoice || this.isAnimating) return;
    audio.unlock();
    audio.playSfx('button_click');
    const { state } = cancelPendingChoice(this.state);
    this.state = state;
    this.feedbackMessage = '已取消出牌';
    this.renderBattle();
  }

  private launchSlotAnimation(slotIndex: number): void {
    const slot = this.handSlots[slotIndex];
    if (!slot || slot.currentHandIndex < 0 || !canPlayCard(this.state, slot.currentHandIndex)) {
      this.drainNextQueuedPlay();
      return;
    }

    const { card, x: fromX, y: fromY } = slot;
    audio.unlock();
    audio.playSfx('play_card');
    this.isAnimating = true;
    this.inFlightSlotIndex = slotIndex;
    slot.consumed = true;
    slot.queued = false;
    slot.container.setVisible(false);

    this.refreshHandSlotsInPlace();
    this.endTurnBg.setFillStyle(PALETTE.deepBlue.num);
    this.endTurnLabel.setTint(PALETTE.mistBlue.num);

    const afterimage = this.add
      .rectangle(fromX, fromY, CARD_WIDTH, CARD_HEIGHT, PALETTE.oldPaper.num)
      .setStrokeStyle(2, PALETTE.ink.num);
    this.fxLayer.add(afterimage);
    this.time.delayedCall(AFTERIMAGE_MS, () => afterimage.destroy());

    const flyingCard = this.add.container(fromX, fromY);
    const artKey = pixelRowsToTexture(this, `card-art-${card.id}`, CARD_PIXEL_ART[card.id] ?? CARD_PIXEL_ART.old_book);
    flyingCard.add([
      this.add.rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, PALETTE.paperWhite.num).setStrokeStyle(2, PALETTE.lampYellow.num),
      this.add.image(0, -20, artKey).setOrigin(0.5),
      addPixelText(this, 0, 36, card.name, { color: PALETTE.ink.hex, origin: 0.5 }),
    ]);
    this.fxLayer.add(flyingCard);

    this.tweens.add({
      targets: flyingCard,
      x: DEMON_X,
      y: DEMON_Y,
      duration: FLY_DURATION_MS,
      ease: 'Linear',
      onComplete: () => {
        flyingCard.destroy();
        this.inFlightSlotIndex = null;

        const actualIndex = slot.currentHandIndex;
        let events: BattleEvent[] = [];
        if (actualIndex >= 0 && canPlayCard(this.state, actualIndex)) {
          const result = playCard(this.state, actualIndex);
          this.state = result.state;
          events = result.events;
          for (const s of this.handSlots) {
            if (s.slotIndex === slotIndex) s.currentHandIndex = -1;
            else if (s.currentHandIndex > actualIndex) s.currentHandIndex -= 1;
          }
          this.feedbackMessage = `打出 ${card.name}（${formatEffectShort(card)}）`;
          this.presentBattleEvents(events, DEMON_X, DEMON_Y);
        }

        // 若进入 PendingChoice，立即暂停队列等待玩家点选要弃的手牌
        if (this.state.pendingChoice) {
          this.playQueue = [];
          this.queuedEndTurn = false;
          this.isAnimating = false;
          this.renderBattle();
          return;
        }

        if (events.some((e) => e.type === 'BATTLE_ENDED' && e.result === 'win')) {
          this.playQueue = [];
          this.queuedEndTurn = false;
          this.renderHud();
          this.renderHand();
          this.feedbackText.setText(`击败心魔「${this.state.demonName}」！`);
          this.playDemonShatterAndFinish();
          return;
        }

        this.drainNextQueuedPlay();
      },
    });
  }

  /**
   * Event-driven presentation: turns structured BattleEvent[] into floating text,
   * flashes, micro camera shake, and ZzFX/WebAudio SFX without diffing BattleState.
   */
  private presentBattleEvents(events: readonly BattleEvent[], anchorX: number, anchorY: number): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'DAMAGE_DEALT':
          if (ev.target === 'demon' && ev.amount > 0) {
            audio.playSfx('hit_demon');
            this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.vermilion.num, 110);
            this.spawnFloatText(DEMON_X, DEMON_Y - 24, `-${ev.amount}`, PALETTE.vermilion.hex);
            this.cameras.main.shake(90, 0.008);
          }
          break;
        case 'SHIELD_GAINED':
          if (ev.amount > 0) {
            audio.playSfx('shield_block');
            this.spawnFloatText(112, 52, `+${ev.amount}盾`, PALETTE.silverBlue.hex);
          }
          break;
        case 'REFLECT_TRIGGERED':
          audio.playSfx('hit_demon');
          this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.jade.num, 150);
          this.spawnFloatText(DEMON_X, DEMON_Y - 24, `反伤-${ev.damage}`, PALETTE.jade.hex);
          this.feedbackMessage = `铜镜反弹 ${ev.damage} 点伤害！`;
          break;
        case 'REWIND_APPLIED':
          this.flashRect(Math.floor(BASE_WIDTH / 2), 88, 480, 88, PALETTE.silverBlue.num, 130);
          this.spawnFloatText(DEMON_X, DEMON_Y - 28, '倒转', PALETTE.lampYellow.hex);
          break;
        case 'CARD_DISCARDED':
          this.spawnFloatText(anchorX, anchorY - 28, `弃:${ev.cardName}`, PALETTE.oldPaper.hex);
          this.feedbackMessage = `弃置 ${ev.cardName}`;
          break;
        case 'RENQING_GAINED':
          if (ev.amount > 0) {
            this.spawnFloatText(240, 52, `人情+${ev.amount}`, PALETTE.lampYellow.hex);
          }
          break;
        case 'BOSS_CHARGE_STARTED':
          audio.playSfx('shield_block');
          this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.brass.num, 150);
          this.spawnFloatText(DEMON_X, DEMON_Y - 24, `蓄力+${ev.shieldGained}盾`, PALETTE.lampYellow.hex);
          this.feedbackMessage = `蓄力「${ev.skill}」获${ev.shieldGained}盾！累伤${ev.threshold}打断`;
          break;
        case 'BOSS_CHARGE_INTERRUPTED':
          audio.playSfx('demon_defeated');
          this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.lampYellow.num, 180);
          this.cameras.main.shake(120, 0.012);
          this.spawnFloatText(DEMON_X, DEMON_Y - 8, `打断${ev.skill}!`, PALETTE.lampYellow.hex);
          this.spawnFloatText(284, 72, `人情+${ev.refundRenqing}`, PALETTE.jade.hex);
          this.feedbackMessage = `打断「${ev.skill}」！返还+${ev.refundRenqing}人情，下回仅${ev.reducedNextDamage}伤`;
          break;
        case 'DEMON_ACT':
          if (ev.reflected) {
            break;
          }
          if (ev.hpDamage > 0) {
            audio.playSfx('player_hurt');
            this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.vermilion.num, DEMON_ACT_MS);
            this.spawnFloatText(96, 56, `-${ev.hpDamage}`, PALETTE.vermilion.hex);
            this.cameras.main.shake(110, 0.01);
            this.feedbackMessage = `心魔攻击，受到 ${ev.hpDamage} 点伤害`;
          } else if (ev.absorbed > 0) {
            audio.playSfx('shield_block');
            this.flashRect(DEMON_X, DEMON_Y, 80, 80, PALETTE.silverBlue.num, DEMON_ACT_MS);
            this.spawnFloatText(96, 56, '格挡', PALETTE.silverBlue.hex);
            this.feedbackMessage = '护盾挡住了心魔攻击';
          }
          break;
        default:
          break;
      }
    }
  }

  private flashRect(x: number, y: number, w: number, h: number, color: number, durationMs: number): void {
    const rect = this.add.rectangle(x, y, w, h, color);
    this.fxLayer.add(rect);
    this.time.delayedCall(durationMs, () => rect.destroy());
  }

  private spawnFloatText(x: number, y: number, label: string, colorHex: string): void {
    const txt = addPixelText(this, x, y, label, { color: colorHex, origin: 0.5 });
    this.fxLayer.add(txt);
    this.tweens.add({
      targets: txt,
      y: y - 28,
      duration: 360,
      ease: 'Linear',
      onComplete: () => txt.destroy(),
    });
  }

  private drainNextQueuedPlay(): void {
    while (this.playQueue.length > 0 && this.state.result === 'ongoing' && !this.state.pendingChoice) {
      const nextSlotIndex = this.playQueue.shift()!;
      const nextSlot = this.handSlots[nextSlotIndex];
      if (nextSlot && nextSlot.currentHandIndex >= 0 && canPlayCard(this.state, nextSlot.currentHandIndex)) {
        this.renderHud();
        this.renderDemonArea();
        this.feedbackText.setText(this.feedbackMessage);
        this.launchSlotAnimation(nextSlotIndex);
        return;
      }
    }

    this.isAnimating = false;
    if (this.queuedEndTurn && this.state.phase === 'play' && this.state.result === 'ongoing') {
      this.queuedEndTurn = false;
      this.renderBattle();
      this.handleEndTurn();
      return;
    }

    this.renderBattle();
  }

  private handleEndTurn(): void {
    if (this.state.phase !== 'play' || this.state.result !== 'ongoing' || this.state.pendingChoice) {
      return;
    }

    this.dismissIntroBanner();
    if (this.isAnimating) {
      this.queuedEndTurn = true;
      return;
    }

    audio.unlock();
    audio.playSfx('button_click');
    this.isAnimating = true;

    const { state: nextState, events } = endTurn(this.state);
    this.presentBattleEvents(events, DEMON_X, DEMON_Y);

    this.time.delayedCall(DEMON_ACT_MS, () => {
      this.state = nextState;

      const endEv = events.find((e) => e.type === 'BATTLE_ENDED');
      if (endEv && endEv.type === 'BATTLE_ENDED') {
        if (endEv.result === 'win') {
          this.renderHud();
          this.renderHand();
          this.feedbackText.setText(`击败心魔「${this.state.demonName}」！`);
          this.playDemonShatterAndFinish();
          return;
        }
        this.isAnimating = false;
        this.renderBattle();
        this.time.delayedCall(DEMON_ACT_MS, () => this.transitionToResult());
        return;
      }

      this.isAnimating = false;
      this.renderBattle();
    });
  }

  private playDemonShatterAndFinish(): void {
    this.dismissIntroBanner();
    audio.playSfx('demon_defeated');
    this.demonLayer.removeAll(true);

    const shardColors = [
      PALETTE.nightBlue.num,
      PALETTE.mistBlue.num,
      PALETTE.silverBlue.num,
      PALETTE.vermilion.num,
    ];
    const shards: Phaser.GameObjects.Rectangle[] = [];
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 4; col += 1) {
        const sx = DEMON_X - 24 + col * 16;
        const sy = DEMON_Y - 24 + row * 16;
        const shard = this.add.rectangle(sx, sy, 16, 16, shardColors[(row + col) % shardColors.length]);
        this.fxLayer.add(shard);
        shards.push(shard);
        this.tweens.add({
          targets: shard,
          x: sx + (col - 1.5) * 36,
          y: sy + (row - 1.5) * 28,
          scaleX: 0,
          scaleY: 0,
          duration: SHATTER_DURATION_MS,
          ease: 'Linear',
        });
      }
    }

    this.time.delayedCall(SHATTER_DURATION_MS + 40, () => {
      for (const shard of shards) shard.destroy();
      this.isAnimating = false;
      this.transitionToResult();
    });
  }

  private transitionToResult(): void {
    if (this.state.result === 'ongoing') return;
    const payload: ResultSceneData = {
      result: this.state.result,
      deck: [...this.originalDeck],
      demonId: this.state.demonId,
      demonName: this.state.demonName,
      playerHp: this.state.playerHp,
      round: this.state.round,
      maxRounds: this.state.maxRounds,
      save: this.save,
      tutorial: cloneTutorialState(this.tutorial),
      ...(this.composedBoss
        ? { bossContributionLines: [...this.composedBoss.contributionLines] }
        : {}),
    };
    this.scene.start('ResultScene', payload);
  }

  private syncInputBounds(): void {
    const refresh = (): void => {
      if (this.scene.isActive()) this.scale.refresh();
    };
    refresh();
    requestAnimationFrame(refresh);
    this.handleWindowResize = refresh;
    window.addEventListener('resize', refresh);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.dismissIntroBanner();
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
