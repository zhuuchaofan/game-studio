import Phaser from 'phaser';
import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import { CARD_PIXEL_ART, DEMON_PIXEL_ART } from '../data/pixelart';
import { audio, installAudioDebugHook } from '../game/audio';
import {
  canPlayCard,
  createBattle,
  endTurn,
  formatEffectDescription,
  formatEffectShort,
  getIntent,
  playCard,
  toBattleDebugSnapshot,
  type BattleBalanceConfig,
  type BattleState,
  type CardDef,
  type DemonDef,
} from '../game/battle';
import { TEST_DECK } from '../game/montecarlo';
import { PALETTE, parseHexColor } from '../game/pawnshop';
import { pixelRowsToTexture } from '../game/pixelart';
import { addPixelText } from '../game/pixelFont';
import { loadTutorialDone, maxRenqingForLevel, saveTutorialDone, type SaveData } from '../game/save';
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
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';
import type { ResultSceneData } from './ResultScene';

export interface CardBattleSceneData {
  deck?: string[];
  demonId?: string;
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

const HUD_HEIGHT = 20;
const DEMON_X = 76;
const DEMON_Y = 44;
const CARD_WIDTH = 48;
const CARD_HEIGHT = 64;
const HAND_Y = 144;
const HAND_MARGIN_X = 6;
const CARD_GAP = 4;
const END_TURN_X = 283;
const END_TURN_Y = 95;
const END_TURN_W = 62;
const END_TURN_H = 21;
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

export function computeHandCardX(index: number, count: number): number {
  if (count <= 0) {
    return Math.floor(BASE_WIDTH / 2);
  }
  const availableWidth = BASE_WIDTH - HAND_MARGIN_X * 2;
  const naturalStep = CARD_WIDTH + CARD_GAP;
  const maxWidth = CARD_WIDTH + (count - 1) * naturalStep;
  const step =
    maxWidth <= availableWidth || count === 1
      ? naturalStep
      : Math.floor((availableWidth - CARD_WIDTH) / (count - 1));
  const totalWidth = CARD_WIDTH + (count - 1) * step;
  const startCenterX = Math.floor((BASE_WIDTH - totalWidth) / 2) + Math.floor(CARD_WIDTH / 2);
  return startCenterX + index * step;
}

export class CardBattleScene extends Phaser.Scene {
  private state!: BattleState;
  private save?: SaveData;
  private tutorial!: TutorialState;
  private originalDeck: string[] = [];
  private isAnimating = false;
  private isEmptyDeck = false;
  private feedbackMessage = '';
  private inspectedCardName: string | null = null;

  // A4：稳定手牌槽位与连点排队执行（动画期间手牌不移位、第二次点击进队不吞输入）
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
    this.feedbackMessage = '';
    this.inspectedCardName = null;
    this.handSlots = [];
    this.playQueue = [];
    this.inFlightSlotIndex = null;
    this.queuedEndTurn = false;
    this.introBanner = undefined;
    this.introBannerTimer = undefined;
    this.tutorialBubble = undefined;
    this.save = data?.save ? { ...data.save, deck: [...data.save.deck] } : undefined;
    this.tutorial = data?.tutorial
      ? cloneTutorialState(data.tutorial)
      : createTutorialState({
          day: this.save?.day ?? 1,
          tutorialDone: true,
        });

    const params = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
    const demonParam = params.get('demon');
    const deckParam = params.get('deck');

    const resolvedDemonId =
      demonParam === 'a' || demonParam === 'b' || demonParam === 'c' || demonParam === 'd'
        ? demonParam
        : (data?.demonId ?? 'a');
    const resolvedDeck =
      deckParam === 'test' ? [...TEST_DECK] : data?.deck ? [...data.deck] : [];

    // 人情上限优先取场景 data 传入值，否则按存档等级计算，向后兼容 P2 默认 balance.json.maxRenqing
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

    this.drawNightBackdrop();

    if (resolvedDeck.length === 0) {
      this.isEmptyDeck = true;
      this.tutorial = syncTutorialForBattle(this.tutorial, 'empty_deck');
      this.renderEmptyDeckView(resolvedDemonId, battleBalance);
      this.syncInputBounds();
      return;
    }

    const { rng } = createRngFromUrl();
    this.state = createBattle(
      resolvedDeck,
      resolvedDemonId,
      rng,
      CARDS,
      DEMONS,
      battleBalance,
    );

    this.tutorial = syncTutorialForBattle(this.tutorial, 'play');

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__BATTLE_DEBUG__ = {
      getState: () => ({
        ...toBattleDebugSnapshot(this.state, this.isAnimating || this.playQueue.length > 0),
        queuedCount: this.playQueue.length,
        day: this.save?.day ?? 1,
        shopLevel: this.save?.shopLevel ?? 1,
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

  private showDemonIntroBanner(): void {
    this.dismissIntroBanner();
    if (!this.state.demonIntroLine) {
      return;
    }

    const centerX = Math.floor(BASE_WIDTH / 2);
    const bannerY = 44;
    const banner = this.add.container(0, 0).setDepth(90);

    const bg = this.add
      .rectangle(centerX, bannerY, 292, 36, PALETTE.nightBlack.num)
      .setStrokeStyle(2, PALETTE.vermilion.num)
      .setInteractive({ useHandCursor: true });
    const title = addPixelText(this, centerX, bannerY - 8, `心魔「${this.state.demonName}」现身`, {
      color: PALETTE.vermilion.hex,
      origin: 0.5,
    });
    const line = addPixelText(this, centerX, bannerY + 8, this.state.demonIntroLine, {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });

    bg.on('pointerdown', () => this.dismissIntroBanner());
    banner.add([bg, title, line]);
    this.introBanner = banner;

    this.introBannerTimer = this.time.delayedCall(INTRO_BANNER_MS, () => {
      this.dismissIntroBanner();
    });
  }

  private dismissIntroBanner(): void {
    if (this.introBannerTimer) {
      this.introBannerTimer.remove(false);
      this.introBannerTimer = undefined;
    }
    if (this.introBanner) {
      this.introBanner.destroy();
      this.introBanner = undefined;
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

  private drawNightBackdrop(): void {
    const centerX = Math.floor(BASE_WIDTH / 2);

    // 夜里牌局深蓝墙面（冷色 8-12 为主）
    this.add.rectangle(centerX, Math.floor(BASE_HEIGHT / 2), BASE_WIDTH, BASE_HEIGHT, PALETTE.deepBlue.num);

    // 左侧窗外夜色（夜黑 + 银蓝星月 + 夜蓝窗框）
    this.add
      .rectangle(26, 44, 38, 34, PALETTE.nightBlack.num)
      .setStrokeStyle(1, PALETTE.nightBlue.num);
    this.add.rectangle(18, 36, 5, 5, PALETTE.silverBlue.num);
    this.add.rectangle(20, 36, 3, 3, PALETTE.nightBlack.num);
    this.add.rectangle(34, 34, 2, 2, PALETTE.silverBlue.num);
    this.add.rectangle(31, 42, 2, 2, PALETTE.mistBlue.num);
    this.add.rectangle(26, 44, 2, 34, PALETTE.nightBlue.num);
    this.add.rectangle(26, 44, 38, 2, PALETTE.nightBlue.num);

    // 右侧牌桌台灯（唯一暖色光源：黄铜灯罩 + 灯黄硬边色块光晕）
    this.add.rectangle(292, 56, 26, 14, PALETTE.nightBlue.num);
    this.add.rectangle(292, 48, 16, 4, PALETTE.lampYellow.num);
    this.add.rectangle(292, 52, 20, 3, PALETTE.brass.num);
    this.add
      .rectangle(292, 39, 20, 10, PALETTE.brass.num)
      .setStrokeStyle(1, PALETTE.nightBlack.num);
    this.add.rectangle(292, 36, 12, 3, PALETTE.lampYellow.num);
    this.add.rectangle(292, 54, 4, 14, PALETTE.nightBlack.num);
    this.add.rectangle(292, 62, 16, 4, PALETTE.brass.num);

    // 牌桌桌面（冷色深蓝/夜蓝/夜黑）
    this.add.rectangle(centerX, 66, BASE_WIDTH, 2, PALETTE.nightBlue.num);
    this.add.rectangle(centerX, 110, BASE_WIDTH, 1, PALETTE.nightBlue.num);
    this.add.rectangle(centerX, 178, BASE_WIDTH, 4, PALETTE.nightBlack.num);
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

    const centerX = Math.floor(BASE_WIDTH / 2);
    this.add
      .rectangle(centerX, 90, 220, 96, PALETTE.nightBlack.num)
      .setStrokeStyle(1, PALETTE.mistBlue.num);

    addPixelText(this, centerX, 68, '没有牌可打', {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });

    addPixelText(this, centerX, 88, '白天未收到旧物纸牌', {
      color: PALETTE.silverBlue.hex,
      origin: 0.5,
    });

    const btn = this.add
      .rectangle(centerX, 118, 96, 24, PALETTE.deepBlue.num)
      .setStrokeStyle(1, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, centerX, 118, '返回标题', {
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
    this.feedbackText = addPixelText(this, 6, 104, '', {
      color: PALETTE.silverBlue.hex,
      origin: [0, 0.5],
    });

    this.endTurnBg = this.add
      .rectangle(END_TURN_X, END_TURN_Y, END_TURN_W, END_TURN_H, PALETTE.nightBlack.num)
      .setStrokeStyle(1, PALETTE.brass.num)
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
    this.endTurnBg.on('pointerout', () => {
      this.endTurnBg.setFillStyle(PALETTE.nightBlack.num);
    });
    this.endTurnBg.on('pointerdown', () => this.handleEndTurn());
  }

  private renderBattle(): void {
    if (this.isEmptyDeck) {
      return;
    }

    this.renderHud();
    this.renderDemonArea();
    this.renderHand();
    this.renderCardDetailPanel();
    this.feedbackText.setText(this.feedbackMessage);

    const canEnd =
      !this.isAnimating &&
      this.playQueue.length === 0 &&
      this.state.phase === 'play' &&
      this.state.result === 'ongoing';
    this.endTurnBg.setFillStyle(canEnd ? PALETTE.nightBlack.num : PALETTE.deepBlue.num);
    this.endTurnLabel.setTint(canEnd ? PALETTE.paperWhite.num : PALETTE.mistBlue.num);
  }

  private renderHud(): void {
    this.hudLayer.removeAll(true);

    const centerX = Math.floor(BASE_WIDTH / 2);
    const hudY = Math.floor(HUD_HEIGHT / 2);

    this.hudLayer.add(
      this.add.rectangle(centerX, hudY, BASE_WIDTH, HUD_HEIGHT, PALETTE.nightBlack.num),
    );
    this.hudLayer.add(
      this.add.rectangle(centerX, HUD_HEIGHT, BASE_WIDTH, 1, PALETTE.nightBlue.num),
    );

    const hpText =
      this.state.shield > 0
        ? `命${this.state.playerHp} 盾${this.state.shield}`
        : `命${this.state.playerHp}/${this.state.maxPlayerHp}`;

    this.hudLayer.add(
      addPixelText(this, 4, hudY, hpText, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );

    this.hudLayer.add(
      addPixelText(this, 88, hudY, `人情${this.state.renqing}/${this.state.maxRenqing}`, {
        color: PALETTE.brass.hex,
        origin: [0, 0.5],
      }),
    );

    this.hudLayer.add(
      addPixelText(this, 168, hudY, `第${this.state.round}/${this.state.maxRounds}回`, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0.5],
      }),
    );

    this.hudLayer.add(
      addPixelText(
        this,
        BASE_WIDTH - 4,
        hudY,
        `抽${this.state.drawPile.length} 弃${this.state.discardPile.length}`,
        {
          color: PALETTE.silverBlue.hex,
          origin: [1, 0.5],
        },
      ),
    );
  }

  private renderDemonArea(): void {
    this.demonLayer.removeAll(true);

    // 心魔 32×32 真像素插画框（40×40，1 像素夜蓝描边）
    this.demonLayer.add(
      this.add
        .rectangle(DEMON_X, DEMON_Y, 40, 40, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.nightBlue.num),
    );

    const demonRows = DEMON_PIXEL_ART[this.state.demonId] ?? DEMON_PIXEL_ART.a;
    const demonTexKey = pixelRowsToTexture(this, `demon-art-${this.state.demonId}`, demonRows);
    this.demonLayer.add(this.add.image(DEMON_X, DEMON_Y, demonTexKey).setOrigin(0.5));

    // 心魔信息与意图面板（紧凑布局 y=23..65，为下方卡面故事与效果区留足空间）
    const panelX = 186;
    const panelY = 44;
    this.demonLayer.add(
      this.add
        .rectangle(panelX, panelY, 166, 42, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.nightBlue.num),
    );

    this.demonLayer.add(
      addPixelText(this, 108, 25, `心魔:${this.state.demonName}`, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0],
      }),
    );

    this.demonLayer.add(
      addPixelText(this, 264, 25, `血${this.state.demonHp}/${this.state.demonMaxHp}`, {
        color: PALETTE.lampYellow.hex,
        origin: [1, 0],
      }),
    );

    // 心魔血条
    const barW = 156;
    const barRatio = this.state.demonMaxHp > 0 ? this.state.demonHp / this.state.demonMaxHp : 0;
    const fillW = Math.max(0, Math.round(barW * barRatio));
    this.demonLayer.add(this.add.rectangle(186, 39, barW, 3, PALETTE.deepBlue.num));
    if (fillW > 0) {
      this.demonLayer.add(
        this.add.rectangle(108 + Math.floor(fillW / 2), 39, fillW, 3, PALETTE.vermilion.num),
      );
    }

    // 本回合意图（左）+ 预告/状态（右）
    const intent = getIntent(this.state);
    if (intent.current) {
      const isDanger = Boolean(intent.current.skill);
      const currentLabel = intent.current.skill
        ? `意图:${intent.current.skill}${intent.current.damage}伤`
        : `意图:攻${intent.current.damage}伤`;
      this.demonLayer.add(
        addPixelText(this, 108, 45, currentLabel, {
          color: isDanger ? PALETTE.vermilion.hex : PALETTE.mistBlue.hex,
          origin: [0, 0],
        }),
      );
    }

    if (intent.upcomingSkill) {
      this.demonLayer.add(
        addPixelText(this, 264, 45, `下回:${intent.upcomingSkill.skill}${intent.upcomingSkill.damage}`, {
          color: PALETTE.vermilion.hex,
          origin: [1, 0],
        }),
      );
    } else if (intent.next) {
      const nextLabel = intent.next.skill
        ? `下回:${intent.next.skill}${intent.next.damage}`
        : `下回:攻${intent.next.damage}`;
      this.demonLayer.add(
        addPixelText(this, 264, 45, nextLabel, {
          color: intent.next.skill ? PALETTE.vermilion.hex : PALETTE.mistBlue.hex,
          origin: [1, 0],
        }),
      );
    } else {
      const badges: string[] = [];
      if (this.state.reflectNextDamage) {
        badges.push('反伤');
      }
      if (this.state.illuminateNextDraw) {
        badges.push('照亮');
      }
      if (this.state.nextRoundRenqingBonus > 0) {
        badges.push(`下回+${this.state.nextRoundRenqingBonus}情`);
      }
      if (badges.length > 0) {
        this.demonLayer.add(
          addPixelText(this, 264, 45, badges.join(' '), {
            color: PALETTE.jade.hex,
            origin: [1, 0],
          }),
        );
      }
    }
  }

  /**
   * C1：牌局卡面故事 + 效果说明区（同时显示 story 与一行完整效果说明，倒转清晰写明双方回血）。
   * 悬停任意手牌即时切换，默认展示手牌中首张（若含“倒转”优先便于一目了然）。
   */
  private renderCardDetailPanel(): void {
    this.detailLayer.removeAll(true);

    let cardName = this.inspectedCardName;
    if (!cardName || !this.state.hand.includes(cardName)) {
      cardName = this.state.hand[0] ?? null;
      this.inspectedCardName = cardName;
    }

    if (!cardName) {
      return;
    }

    const card = this.state.cardsByName.get(cardName);
    if (!card) {
      return;
    }

    // 上条（全宽 y=68..82，位于“结束回合”上方）：完整展示 story（所有 23 张均单行完整可见）
    this.detailLayer.add(
      this.add
        .rectangle(Math.floor(BASE_WIDTH / 2), 75, BASE_WIDTH - 8, 14, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.nightBlue.num),
    );
    this.detailLayer.add(
      addPixelText(this, 8, 75, card.story, {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
    );

    // 下左条（y=84..98，位于“结束回合”左侧）：牌名 + 完整效果说明
    this.detailLayer.add(
      this.add
        .rectangle(126, 91, 244, 14, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.brass.num),
    );
    this.detailLayer.add(
      addPixelText(this, 8, 91, `${card.name}:${formatEffectDescription(card)}`, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
    );
  }

  private renderHand(): void {
    this.handLayer.removeAll(true);
    this.handSlots = [];

    const count = this.state.hand.length;
    this.state.hand.forEach((cardName, index) => {
      const card = this.state.cardsByName.get(cardName);
      if (!card) {
        return;
      }

      const x = computeHandCardX(index, count);
      const y = HAND_Y;
      const playable = canPlayCard(this.state, index);
      const stripColor = card.color ? parseHexColor(card.color) : PALETTE.brass.num;

      const cardContainer = this.add.container(x, y);
      const bgColor = playable ? PALETTE.paperWhite.num : PALETTE.mistBlue.num;
      const borderColor = playable ? PALETTE.ink.num : PALETTE.nightBlack.num;

      const frame = this.add
        .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, bgColor)
        .setStrokeStyle(1, borderColor);

      // 顶部 2px 旧物主色条
      const strip = this.add.rectangle(0, -30, CARD_WIDTH - 2, 2, stripColor);

      // 32×32 手绘像素插画
      const cardRows = CARD_PIXEL_ART[card.id] ?? CARD_PIXEL_ART.old_book;
      const artKey = pixelRowsToTexture(this, `card-art-${card.id}`, cardRows);
      const artImage = this.add.image(0, -11, artKey).setOrigin(0.5);
      if (!playable) {
        artImage.setTint(PALETTE.silverBlue.num);
      }

      // 左上角费用角标
      const costBg = this.add
        .rectangle(-17, -24, 12, 12, card.cost === 0 ? PALETTE.jade.num : PALETTE.brass.num)
        .setStrokeStyle(1, PALETTE.ink.num);
      const costText = addPixelText(this, -17, -24, `${card.cost}`, {
        color: playable ? PALETTE.ink.hex : PALETTE.nightBlack.hex,
        origin: 0.5,
      });

      // 下方牌名与短效果
      const nameText = addPixelText(this, 0, 12, card.name, {
        color: playable ? PALETTE.ink.hex : PALETTE.nightBlack.hex,
        origin: 0.5,
      });

      const effectSummary = formatEffectShort(card);
      const effectText = addPixelText(this, 0, 24, effectSummary, {
        color: playable ? PALETTE.deepWood.hex : PALETTE.nightBlack.hex,
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

      // 所有手牌均响应悬停以展示故事与效果说明（C1），点击走统一稳定槽位队列（A4）
      frame.setInteractive({ useHandCursor: playable });
      frame.on('pointerover', () => {
        if (slotView.consumed) {
          return;
        }
        this.inspectedCardName = card.name;
        this.renderCardDetailPanel();
        if (!slotView.queued && this.canQueueOrPlaySlot(slotView)) {
          cardContainer.y = HAND_Y - 4;
          frame.setStrokeStyle(1, PALETTE.lampYellow.num);
        }
      });
      frame.on('pointerout', () => {
        if (slotView.consumed || slotView.queued) {
          return;
        }
        cardContainer.y = HAND_Y;
        const canUse = this.canQueueOrPlaySlot(slotView);
        frame.setStrokeStyle(1, canUse ? PALETTE.ink.num : PALETTE.nightBlack.num);
      });
      frame.on('pointerdown', () => {
        this.handleSlotClick(slotView.slotIndex);
      });

      this.handLayer.add(cardContainer);
    });
  }

  /**
   * Computes projected remaining renqing & hand size after currently in-flight + queued plays,
   * so rapid consecutive clicks are validated accurately before queuing (A4).
   */
  private getProjectedResources(): { renqing: number; handCount: number } {
    let renqing = this.state.renqing;
    let handCount = this.state.hand.length;

    const pendingIndices: number[] = [];
    if (this.inFlightSlotIndex !== null) {
      pendingIndices.push(this.inFlightSlotIndex);
    }
    for (const q of this.playQueue) {
      pendingIndices.push(q);
    }

    for (const slotIdx of pendingIndices) {
      const slot = this.handSlots[slotIdx];
      if (!slot) {
        continue;
      }
      renqing -= slot.card.cost;
      handCount -= 1;
      for (const eff of slot.card.effects) {
        if (eff.type === 'renqing') {
          renqing += eff.value ?? 0;
        } else if (eff.type === 'discard_for_renqing') {
          renqing += eff.value ?? 0;
          handCount -= 1;
        } else if (eff.type === 'draw') {
          handCount += eff.value ?? 0;
        }
      }
    }

    return { renqing, handCount };
  }

  private canQueueOrPlaySlot(slot: HandSlotView): boolean {
    if (slot.consumed || slot.queued || slot.currentHandIndex < 0) {
      return false;
    }
    if (this.state.phase !== 'play' || this.state.result !== 'ongoing') {
      return false;
    }
    if (!this.isAnimating) {
      return canPlayCard(this.state, slot.currentHandIndex);
    }
    const projected = this.getProjectedResources();
    if (projected.renqing < slot.card.cost) {
      return false;
    }
    const requiresOther = slot.card.effects.some((e) => e.type === 'discard_for_renqing');
    if (requiresOther && projected.handCount < 2) {
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
        slot.container.y = HAND_Y - 5;
        slot.frame.setFillStyle(PALETTE.candle.num);
        slot.frame.setStrokeStyle(1, PALETTE.lampYellow.num);
        continue;
      }
      const playable = this.canQueueOrPlaySlot(slot);
      slot.container.y = HAND_Y;
      slot.frame.setFillStyle(playable ? PALETTE.paperWhite.num : PALETTE.mistBlue.num);
      slot.frame.setStrokeStyle(1, playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
      if (playable) {
        slot.artImage.clearTint();
      } else {
        slot.artImage.setTint(PALETTE.silverBlue.num);
      }
      slot.costText.setTint(playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
      slot.nameText.setTint(playable ? PALETTE.ink.num : PALETTE.nightBlack.num);
      slot.effectText.setTint(playable ? PALETTE.deepWood.num : PALETTE.nightBlack.num);
    }
  }

  private handleSlotClick(slotIndex: number): void {
    const slot = this.handSlots[slotIndex];
    if (!slot || slot.consumed || slot.queued) {
      return;
    }

    this.dismissIntroBanner();
    this.inspectedCardName = slot.card.name;
    this.renderCardDetailPanel();

    if (!this.canQueueOrPlaySlot(slot)) {
      return;
    }

    if (this.isAnimating) {
      // A4：动画进行中将第二次点击排队，给出抬起 + 灯黄描边反馈，且不破坏其他手牌坐标
      slot.queued = true;
      this.playQueue.push(slotIndex);
      audio.unlock();
      audio.playSfx('button_click');
      this.refreshHandSlotsInPlace();
      return;
    }

    this.launchSlotAnimation(slotIndex);
  }

  private launchSlotAnimation(slotIndex: number): void {
    const slot = this.handSlots[slotIndex];
    if (!slot || slot.currentHandIndex < 0 || !canPlayCard(this.state, slot.currentHandIndex)) {
      this.drainNextQueuedPlay();
      return;
    }

    const card = slot.card;
    const fromX = slot.x;
    const fromY = slot.y;

    audio.unlock();
    audio.playSfx('play_card');
    this.isAnimating = true;
    this.inFlightSlotIndex = slotIndex;
    slot.consumed = true;
    slot.queued = false;
    slot.container.setVisible(false);

    // 保持其余手牌原位不动（不重排、不销毁重建，消除连点移位与 Phaser 帧末输入丢弃）
    this.refreshHandSlotsInPlace();
    this.endTurnBg.setFillStyle(PALETTE.deepBlue.num);
    this.endTurnLabel.setTint(PALETTE.mistBlue.num);

    // 1 帧“残影牌”色块（旧纸色实心，无半透明）
    const afterimage = this.add
      .rectangle(fromX, fromY, CARD_WIDTH, CARD_HEIGHT, PALETTE.oldPaper.num)
      .setStrokeStyle(1, PALETTE.ink.num);
    this.fxLayer.add(afterimage);
    this.time.delayedCall(AFTERIMAGE_MS, () => {
      afterimage.destroy();
    });

    // 飞向心魔的牌面动效（6 帧 / 12 FPS 节奏）
    const flyingCard = this.add.container(fromX, fromY);
    const flyBg = this.add
      .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, PALETTE.paperWhite.num)
      .setStrokeStyle(1, PALETTE.lampYellow.num);
    const cardRows = CARD_PIXEL_ART[card.id] ?? CARD_PIXEL_ART.old_book;
    const artKey = pixelRowsToTexture(this, `card-art-${card.id}`, cardRows);
    const flyArt = this.add.image(0, -10, artKey).setOrigin(0.5);
    const flyTitle = addPixelText(this, 0, 18, card.name, {
      color: PALETTE.ink.hex,
      origin: 0.5,
    });
    flyingCard.add([flyBg, flyArt, flyTitle]);
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
        if (actualIndex >= 0 && canPlayCard(this.state, actualIndex)) {
          const hadDiscard = card.effects.some((e) => e.type === 'discard_for_renqing');
          this.state = playCard(this.state, actualIndex);
          this.syncSlotIndicesAfterPlay(slotIndex, actualIndex, hadDiscard);
          this.feedbackMessage = `打出 ${card.name}（${formatEffectShort(card)}）`;
        }

        if (this.state.result === 'win') {
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

  private syncSlotIndicesAfterPlay(
    playedSlotIndex: number,
    playedHandIndex: number,
    hadDiscardForRenqing: boolean,
  ): void {
    for (const s of this.handSlots) {
      if (s.slotIndex === playedSlotIndex) {
        s.currentHandIndex = -1;
      } else if (s.currentHandIndex > playedHandIndex) {
        s.currentHandIndex -= 1;
      }
    }

    if (hadDiscardForRenqing) {
      // discard_for_renqing shifts hand[0] into discardPile
      for (const s of this.handSlots) {
        if (s.currentHandIndex === 0) {
          s.currentHandIndex = -1;
          s.consumed = true;
          s.queued = false;
          s.container.setVisible(false);
          this.playQueue = this.playQueue.filter((q) => q !== s.slotIndex);
        } else if (s.currentHandIndex > 0) {
          s.currentHandIndex -= 1;
        }
      }
    }
  }

  private drainNextQueuedPlay(): void {
    while (this.playQueue.length > 0 && this.state.result === 'ongoing') {
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
    if (this.state.phase !== 'play' || this.state.result !== 'ongoing') {
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
    const prevDemonHp = this.state.demonHp;
    const prevPlayerHp = this.state.playerHp;
    const wasReflecting = this.state.reflectNextDamage;
    const nextState = endTurn(this.state);

    // 简短心魔行动反馈动画
    const flashColor = wasReflecting ? PALETTE.jade.num : PALETTE.vermilion.num;
    const flash = this.add.rectangle(DEMON_X, DEMON_Y, 40, 40, flashColor);
    this.fxLayer.add(flash);

    this.time.delayedCall(DEMON_ACT_MS, () => {
      flash.destroy();
      this.state = nextState;

      if (wasReflecting && this.state.demonHp < prevDemonHp) {
        this.feedbackMessage = `铜镜反弹 ${prevDemonHp - this.state.demonHp} 点伤害！`;
      } else if (this.state.playerHp < prevPlayerHp) {
        this.feedbackMessage = `心魔攻击，受到 ${prevPlayerHp - this.state.playerHp} 点伤害`;
      } else {
        this.feedbackMessage = '护盾挡住了心魔攻击';
      }

      if (this.state.result === 'win') {
        this.renderHud();
        this.renderHand();
        this.feedbackText.setText(`击败心魔「${this.state.demonName}」！`);
        this.playDemonShatterAndFinish();
        return;
      }

      if (this.state.result === 'lose_hp' || this.state.result === 'lose_timeout') {
        this.isAnimating = false;
        this.renderBattle();
        this.time.delayedCall(DEMON_ACT_MS, () => {
          this.transitionToResult();
        });
        return;
      }

      this.isAnimating = false;
      this.renderBattle();
    });
  }

  private playDemonShatterAndFinish(): void {
    // 隐藏心魔剪影，生成 8×8 像素块在 12 帧内散开，并配清脆“叮”声（GDD 第 95 行）
    this.dismissIntroBanner();
    audio.playSfx('demon_defeated');
    this.demonLayer.removeAll(true);

    const shardColors = [
      PALETTE.nightBlue.num,
      PALETTE.mistBlue.num,
      PALETTE.silverBlue.num,
      PALETTE.vermilion.num,
    ];
    const grid = 4;
    const shardSize = 8;
    const shards: Phaser.GameObjects.Rectangle[] = [];

    for (let row = 0; row < grid; row += 1) {
      for (let col = 0; col < grid; col += 1) {
        const sx = DEMON_X - 12 + col * shardSize;
        const sy = DEMON_Y - 12 + row * shardSize;
        const color = shardColors[(row + col) % shardColors.length];
        const shard = this.add.rectangle(sx, sy, shardSize, shardSize, color);
        this.fxLayer.add(shard);
        shards.push(shard);

        const dx = (col - 1.5) * 18;
        const dy = (row - 1.5) * 14;
        this.tweens.add({
          targets: shard,
          x: sx + dx,
          y: sy + dy,
          scaleX: 0,
          scaleY: 0,
          duration: SHATTER_DURATION_MS,
          ease: 'Linear',
        });
      }
    }

    this.time.delayedCall(SHATTER_DURATION_MS + 40, () => {
      for (const shard of shards) {
        shard.destroy();
      }
      this.isAnimating = false;
      this.transitionToResult();
    });
  }

  private transitionToResult(): void {
    const result = this.state.result;
    if (result === 'ongoing') {
      return;
    }

    const payload: ResultSceneData = {
      result,
      deck: [...this.originalDeck],
      demonId: this.state.demonId,
      demonName: this.state.demonName,
      playerHp: this.state.playerHp,
      round: this.state.round,
      maxRounds: this.state.maxRounds,
      save: this.save,
      tutorial: cloneTutorialState(this.tutorial),
    };
    this.scene.start('ResultScene', payload);
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
      this.dismissIntroBanner();
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
