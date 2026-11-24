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

const HUD_HEIGHT = 21;
const DEMON_X = 96;
const DEMON_Y = 53;
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

  private hudLayer!: Phaser.GameObjects.Container;
  private demonLayer!: Phaser.GameObjects.Container;
  private handLayer!: Phaser.GameObjects.Container;
  private fxLayer!: Phaser.GameObjects.Container;
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
        ...toBattleDebugSnapshot(this.state, this.isAnimating),
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
    this.handLayer = this.add.container(0, 0);
    this.fxLayer = this.add.container(0, 0);

    this.createActionStrip();
    this.renderBattle();
    this.renderTutorialBubble();
    this.syncInputBounds();
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
      .rectangle(36, 48, 44, 38, PALETTE.nightBlack.num)
      .setStrokeStyle(1, PALETTE.nightBlue.num);
    this.add.rectangle(26, 39, 6, 6, PALETTE.silverBlue.num);
    this.add.rectangle(28, 39, 4, 4, PALETTE.nightBlack.num);
    this.add.rectangle(46, 36, 2, 2, PALETTE.silverBlue.num);
    this.add.rectangle(42, 46, 2, 2, PALETTE.mistBlue.num);
    this.add.rectangle(36, 48, 2, 38, PALETTE.nightBlue.num);
    this.add.rectangle(36, 48, 44, 2, PALETTE.nightBlue.num);

    // 右侧牌桌台灯（唯一暖色光源：黄铜灯罩 + 灯黄硬边色块光晕）
    this.add.rectangle(288, 66, 28, 16, PALETTE.nightBlue.num);
    this.add.rectangle(288, 56, 16, 4, PALETTE.lampYellow.num);
    this.add.rectangle(288, 61, 22, 3, PALETTE.brass.num);
    this.add
      .rectangle(288, 47, 22, 11, PALETTE.brass.num)
      .setStrokeStyle(1, PALETTE.nightBlack.num);
    this.add.rectangle(288, 44, 14, 3, PALETTE.lampYellow.num);
    this.add.rectangle(288, 64, 4, 18, PALETTE.nightBlack.num);
    this.add.rectangle(288, 74, 16, 4, PALETTE.brass.num);

    // 牌桌桌面（冷色深蓝/夜蓝/夜黑）
    this.add.rectangle(centerX, 83, BASE_WIDTH, 3, PALETTE.nightBlue.num);
    this.add.rectangle(centerX, 85, BASE_WIDTH, 1, PALETTE.nightBlack.num);
    this.add.rectangle(centerX, 133, BASE_WIDTH, 94, PALETTE.deepBlue.num);
    this.add.rectangle(centerX, 108, BASE_WIDTH, 1, PALETTE.nightBlue.num);
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
    this.feedbackText = addPixelText(this, 6, END_TURN_Y, '', {
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
    this.feedbackText.setText(this.feedbackMessage);

    const canEnd = !this.isAnimating && this.state.phase === 'play' && this.state.result === 'ongoing';
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

    // 心魔 32×32 真像素插画框（48x48，1 像素夜黑描边）
    this.demonLayer.add(
      this.add
        .rectangle(DEMON_X, DEMON_Y, 48, 48, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.nightBlue.num),
    );

    const demonRows = DEMON_PIXEL_ART[this.state.demonId] ?? DEMON_PIXEL_ART.a;
    const demonTexKey = pixelRowsToTexture(this, `demon-art-${this.state.demonId}`, demonRows);
    this.demonLayer.add(this.add.image(DEMON_X, DEMON_Y, demonTexKey).setOrigin(0.5));

    // 心魔信息与意图面板
    const panelX = 190;
    const panelY = 53;
    this.demonLayer.add(
      this.add
        .rectangle(panelX, panelY, 128, 56, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.nightBlue.num),
    );

    this.demonLayer.add(
      addPixelText(this, 130, 29, `心魔:${this.state.demonName}`, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0],
      }),
    );

    this.demonLayer.add(
      addPixelText(this, 250, 29, `血${this.state.demonHp}/${this.state.demonMaxHp}`, {
        color: PALETTE.lampYellow.hex,
        origin: [1, 0],
      }),
    );

    // 心魔血条
    const barW = 118;
    const barRatio = this.state.demonMaxHp > 0 ? this.state.demonHp / this.state.demonMaxHp : 0;
    const fillW = Math.max(0, Math.round(barW * barRatio));
    this.demonLayer.add(this.add.rectangle(190, 45, barW, 4, PALETTE.deepBlue.num));
    if (fillW > 0) {
      this.demonLayer.add(
        this.add.rectangle(131 + Math.floor(fillW / 2), 45, fillW, 4, PALETTE.vermilion.num),
      );
    }

    // 本回合意图（朱红 = 危险技能，雾蓝 = 普通攻击）
    const intent = getIntent(this.state);
    if (intent.current) {
      const isDanger = Boolean(intent.current.skill);
      const currentLabel = intent.current.skill
        ? `意图:${intent.current.skill}${intent.current.damage}伤`
        : `意图:攻击${intent.current.damage}伤`;
      this.demonLayer.add(
        addPixelText(this, 130, 50, currentLabel, {
          color: isDanger ? PALETTE.vermilion.hex : PALETTE.mistBlue.hex,
          origin: [0, 0],
        }),
      );
    }

    // 提前提示（车票第 3 回合“远行” 或 收音机 reveal）
    if (intent.upcomingSkill) {
      this.demonLayer.add(
        addPixelText(this, 130, 65, `下回:${intent.upcomingSkill.skill}${intent.upcomingSkill.damage}伤`, {
          color: PALETTE.vermilion.hex,
          origin: [0, 0],
        }),
      );
    } else if (intent.next) {
      const nextLabel = intent.next.skill
        ? `下回:${intent.next.skill}${intent.next.damage}伤`
        : `下回:攻击${intent.next.damage}伤`;
      this.demonLayer.add(
        addPixelText(this, 130, 65, nextLabel, {
          color: intent.next.skill ? PALETTE.vermilion.hex : PALETTE.mistBlue.hex,
          origin: [0, 0],
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
          addPixelText(this, 130, 65, `状态:${badges.join(' ')}`, {
            color: PALETTE.jade.hex,
            origin: [0, 0],
          }),
        );
      }
    }
  }

  private renderHand(): void {
    this.handLayer.removeAll(true);

    const count = this.state.hand.length;
    this.state.hand.forEach((cardName, index) => {
      const card = this.state.cardsByName.get(cardName);
      if (!card) {
        return;
      }

      const x = computeHandCardX(index, count);
      const y = HAND_Y;
      const playable = !this.isAnimating && canPlayCard(this.state, index);
      const stripColor = card.color ? parseHexColor(card.color) : PALETTE.brass.num;

      const cardContainer = this.add.container(x, y);
      const bgColor = playable ? PALETTE.paperWhite.num : PALETTE.mistBlue.num;
      const borderColor = playable ? PALETTE.ink.num : PALETTE.nightBlack.num;

      const frame = this.add
        .rectangle(0, 0, CARD_WIDTH, CARD_HEIGHT, bgColor)
        .setStrokeStyle(1, borderColor);

      // 顶部 2px 旧物主色条
      const strip = this.add.rectangle(0, -30, CARD_WIDTH - 2, 2, stripColor);

      // 32×32 手绘像素插画（居中偏上，位于牌框 48×64 内）
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

      // 下方牌名与效果文字区（12px 位图字体）
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

      if (playable) {
        frame.setInteractive({ useHandCursor: true });
        frame.on('pointerover', () => {
          if (!this.isAnimating) {
            cardContainer.y = HAND_Y - 4;
            frame.setStrokeStyle(1, PALETTE.lampYellow.num);
          }
        });
        frame.on('pointerout', () => {
          cardContainer.y = HAND_Y;
          frame.setStrokeStyle(1, PALETTE.ink.num);
        });
        frame.on('pointerdown', () => {
          this.handlePlayCard(index, x, y, card);
        });
      }

      this.handLayer.add(cardContainer);
    });
  }

  private handlePlayCard(index: number, fromX: number, fromY: number, card: CardDef): void {
    if (this.isAnimating || !canPlayCard(this.state, index)) {
      return;
    }

    audio.unlock();
    audio.playSfx('play_card');
    this.isAnimating = true;
    this.renderBattle();

    // 1 帧“残影牌”色块（旧纸色实心，无半透明，符合 ART_STYLE.md）
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
        this.state = playCard(this.state, index);
        this.feedbackMessage = `打出 ${card.name}（${formatEffectShort(card)}）`;

        if (this.state.result === 'win') {
          this.renderHud();
          this.renderHand();
          this.feedbackText.setText(`击败心魔「${this.state.demonName}」！`);
          this.playDemonShatterAndFinish();
          return;
        }

        this.isAnimating = false;
        this.renderBattle();
      },
    });
  }

  private handleEndTurn(): void {
    if (this.isAnimating || this.state.phase !== 'play' || this.state.result !== 'ongoing') {
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
    const flash = this.add.rectangle(DEMON_X, DEMON_Y, 48, 48, flashColor);
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
      if (this.handleWindowResize) {
        window.removeEventListener('resize', this.handleWindowResize);
        this.handleWindowResize = undefined;
      }
    });
  }
}
