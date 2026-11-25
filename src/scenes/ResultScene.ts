import Phaser from 'phaser';
import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import { audio, installAudioDebugHook } from '../game/audio';
import {
  resolveWinReward,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
  type WinReward,
} from '../game/battle';
import { PALETTE } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import {
  applyDayResult,
  createNewGame,
  loadTutorialDone,
  saveGame,
  saveTutorialDone,
  type SaveData,
} from '../game/save';
import {
  advanceTutorialStep,
  cloneTutorialState,
  createTutorialState,
  finishTutorialOnDayEnd,
  getTutorialCopy,
  skipTutorial,
  syncTutorialForResult,
  type TutorialState,
} from '../game/tutorial';
import { createTutorialBubble } from '../game/tutorialBubble';
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export interface ResultSceneData {
  result: 'win' | 'lose_hp' | 'lose_timeout';
  deck: string[];
  demonId: string;
  demonName: string;
  playerHp: number;
  round: number;
  maxRounds: number;
  save?: SaveData;
  tutorial?: TutorialState;
}

const CARDS: readonly CardDef[] = cardsJson as CardDef[];
const DEMONS: readonly DemonDef[] = demonsJson as DemonDef[];
const RESULT_BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

// 保留 (160, 148) 在“返回标题”命中区内，兼容 P2 既有 E2E 测试
export const RESULT_NEXT_DAY_BUTTON = { x: 88, y: 148, width: 116, height: 24 } as const;
export const RESULT_RETURN_BUTTON = { x: 222, y: 148, width: 136, height: 24 } as const;

function splitVictoryNarrative(line: string): [string, string] {
  const firstPeriod = line.indexOf('。');
  if (firstPeriod >= 0 && firstPeriod < line.length - 1) {
    return [line.slice(0, firstPeriod + 1), line.slice(firstPeriod + 1)];
  }
  return [line, ''];
}

export class ResultScene extends Phaser.Scene {
  private tutorial!: TutorialState;
  private tutorialBubble?: Phaser.GameObjects.Container;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data?: ResultSceneData): void {
    this.tutorialBubble = undefined;
    const result = data?.result ?? 'lose_timeout';
    const deck = data?.deck ?? [];
    const demonId = data?.demonId ?? 'a';
    const demonDef = DEMONS.find((d) => d.id === demonId) ?? DEMONS[0];
    const demonName = data?.demonName || demonDef?.name || '';
    const victoryLine = result === 'win' ? (demonDef?.victoryLine ?? null) : null;
    const playerHp = data?.playerHp ?? 0;
    const round = data?.round ?? 1;
    const maxRounds = data?.maxRounds ?? round;

    let reward: WinReward | null = null;
    let loseReason: string | null = null;

    if (result === 'win') {
      const { rng } = createRngFromUrl();
      reward = resolveWinReward(deck, CARDS, RESULT_BALANCE, rng);
      if (reward.cardName) {
        audio.playSfx('receive_card');
      }
    } else if (result === 'lose_hp') {
      loseReason = '被打倒';
    } else {
      loseReason = `${maxRounds} 回合未分胜负`;
    }

    // 胜负结算后立即自动存档（A1 时机）
    const currentSave: SaveData = data?.save
      ? { ...data.save, deck: [...data.save.deck] }
      : { ...createNewGame(), deck: [...deck] };

    const nextSave = applyDayResult(currentSave, {
      outcome: result === 'win' ? 'win' : 'lose',
      reward,
    });
    saveGame(nextSave);

    const incomingTutorial = data?.tutorial
      ? cloneTutorialState(data.tutorial)
      : createTutorialState({
          day: currentSave.day,
          tutorialDone: true,
        });
    this.tutorial = syncTutorialForResult(incomingTutorial);

    // 只要第 1 天打完进入结算且未处于教程气泡展示中，即落盘完成标记
    if (currentSave.day === 1 && !this.tutorial.active) {
      saveTutorialDone(true);
    }

    installAudioDebugHook(audio);

    // 测试钩子（仅供 E2E 自动化测试断言用，非正式功能）
    window.__BATTLE_DEBUG__ = {
      getState: () => ({
        phase: 'result_scene',
        round,
        playerHp,
        shield: 0,
        renqing: 0,
        demonHp: result === 'win' ? 0 : 1,
        hand: [],
        deckCount: nextSave.deck.length,
        discardCount: 0,
        result,
        demonId,
        demonName,
        victoryLine,
        intent: { current: null, next: null, upcomingSkill: null },
        isAnimating: false,
        reward,
        loseReason,
        day: currentSave.day,
        shopLevel: nextSave.shopLevel,
        savedData: nextSave,
        tutorialActive: this.tutorial.active,
        currentStep: this.tutorial.currentStep,
        tutorialDone: this.tutorial.done || loadTutorialDone(),
        tutorialCopy: getTutorialCopy(this.tutorial.currentStep),
      }),
    };

    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 夜里深蓝结算背景与卡片
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num);
    this.add
      .rectangle(centerX, centerY, BASE_WIDTH - 20, BASE_HEIGHT - 12, PALETTE.deepBlue.num)
      .setStrokeStyle(1, result === 'win' ? PALETTE.brass.num : PALETTE.mistBlue.num);

    // 顶部紧凑标题条（y=8..24，所有结算与 C5 胜利叙事排布在 y=8..82，完全避开 6/6 教程气泡 y=86..132）
    this.add.rectangle(centerX, 16, BASE_WIDTH - 22, 16, PALETTE.nightBlack.num);
    addPixelText(this, 18, 16, result === 'win' ? '赢了！' : '心魔还在……', {
      color: result === 'win' ? PALETTE.lampYellow.hex : PALETTE.vermilion.hex,
      origin: [0, 0.5],
    });
    addPixelText(this, BASE_WIDTH - 18, 16, `第${currentSave.day}天 · 当铺Lv.${nextSave.shopLevel}`, {
      color: PALETTE.silverBlue.hex,
      origin: [1, 0.5],
    });

    if (result === 'win' && reward) {
      const moneyTag = reward.allOwnedBonus
        ? `得钱+${reward.money}(全牌加赠)`
        : `得钱:+${reward.money}`;
      addPixelText(this, 20, 32, `击败心魔「${demonName}」`, {
        color: PALETTE.jade.hex,
        origin: [0, 0.5],
      });
      addPixelText(this, BASE_WIDTH - 20, 32, moneyTag, {
        color: PALETTE.lampYellow.hex,
        origin: [1, 0.5],
      });

      const cardLabel = reward.cardName ? `得牌:${reward.cardName}` : '全牌已集齐';
      addPixelText(this, 20, 46, cardLabel, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0.5],
      });
      addPixelText(this, BASE_WIDTH - 20, 46, `赎当券×${reward.redeemTicket}`, {
        color: PALETTE.brass.hex,
        origin: [1, 0.5],
      });

      this.add.rectangle(centerX, 55, BASE_WIDTH - 36, 1, PALETTE.nightBlue.num);

      // C5：按心魔显示胜利叙事句（两行居中，y=58..82，不被 6/6 气泡遮挡）
      if (victoryLine) {
        const [line1, line2] = splitVictoryNarrative(victoryLine);
        addPixelText(this, centerX, 64, line1, {
          color: PALETTE.candle.hex,
          origin: 0.5,
        });
        if (line2) {
          addPixelText(this, centerX, 77, line2, {
            color: PALETTE.paperWhite.hex,
            origin: 0.5,
          });
        }
      }
    } else {
      addPixelText(this, centerX, 42, `心魔「${demonName}」未能平息`, {
        color: PALETTE.silverBlue.hex,
        origin: 0.5,
      });

      addPixelText(this, centerX, 62, `失败原因：${loseReason ?? ''}`, {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
      });
    }

    const completeIfDayOne = (): void => {
      if (this.tutorial.active) {
        this.tutorial = finishTutorialOnDayEnd(this.tutorial);
        saveTutorialDone(true);
      } else if (currentSave.day === 1) {
        saveTutorialDone(true);
      }
    };

    // “下一天”按钮（带更新后存档进入下一天 PawnshopScene）
    this.createResultButton(
      RESULT_NEXT_DAY_BUTTON.x,
      RESULT_NEXT_DAY_BUTTON.y,
      RESULT_NEXT_DAY_BUTTON.width,
      RESULT_NEXT_DAY_BUTTON.height,
      '下一天',
      () => {
        completeIfDayOne();
        this.scene.start('PawnshopScene', { save: nextSave });
      },
    );

    // “返回标题”按钮
    this.createResultButton(
      RESULT_RETURN_BUTTON.x,
      RESULT_RETURN_BUTTON.y,
      RESULT_RETURN_BUTTON.width,
      RESULT_RETURN_BUTTON.height,
      '返回标题',
      () => {
        completeIfDayOne();
        this.scene.start('TitleScene');
      },
    );

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
        if (this.tutorial.done) {
          saveTutorialDone(true);
        }
        this.renderTutorialBubble();
      },
      onSkip: () => {
        this.tutorial = skipTutorial(this.tutorial);
        saveTutorialDone(true);
        this.renderTutorialBubble();
      },
    });
  }

  private createResultButton(
    x: number,
    y: number,
    width: number,
    height: number,
    label: string,
    onClick: () => void,
  ): void {
    const btn = this.add
      .rectangle(x, y, width, height, PALETTE.nightBlack.num)
      .setStrokeStyle(1, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });

    addPixelText(this, x, y, label, {
      color: PALETTE.paperWhite.hex,
      origin: 0.5,
    });

    btn.on('pointerover', () => btn.setFillStyle(PALETTE.nightBlue.num));
    btn.on('pointerout', () => btn.setFillStyle(PALETTE.nightBlack.num));
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
