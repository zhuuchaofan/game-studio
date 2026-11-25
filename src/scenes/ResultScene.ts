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
import { cloneChapterState, getChapterConfig } from '../game/chapters';
import { PALETTE, wrapCjkText } from '../game/pawnshop';
import { addPixelText } from '../game/pixelFont';
import {
  applyDayResult,
  clearPawnPrices,
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
export const DIARY_CONTINUE_BUTTON = { x: 160, y: 158, width: 116, height: 22 } as const;
export const ENDING_RESTART_BUTTON = { x: 96, y: 152, width: 116, height: 24 } as const;
export const ENDING_TITLE_BUTTON = { x: 224, y: 152, width: 116, height: 24 } as const;
export const CHAPTER_FAIL_TITLE_BUTTON = { x: 160, y: 148, width: 120, height: 24 } as const;

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
  private contentLayer!: Phaser.GameObjects.Container;
  private resultView: 'normal' | 'diary' | 'ending' | 'chapter_failed' = 'normal';
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
    const isBossBattle = Boolean(demonDef?.isBoss);
    const demonName = data?.demonName || demonDef?.name || '';
    const victoryLine = result === 'win' ? (demonDef?.victoryLine ?? null) : null;
    const aftermathLine = result === 'win' ? (demonDef?.aftermathLine ?? null) : null;
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

    // 胜负结算后立即自动存档（A1 时机 + P9 章节完成/失败）
    const currentSave: SaveData = data?.save
      ? {
          ...data.save,
          deck: [...data.save.deck],
          chapter: cloneChapterState(data.save.chapter),
        }
      : { ...createNewGame(), deck: [...deck] };

    const nextSave = applyDayResult(currentSave, {
      outcome: result === 'win' ? 'win' : 'lose',
      reward,
      isBossBattle,
    });
    saveGame(nextSave);

    this.resultView = isBossBattle
      ? result === 'win'
        ? 'diary'
        : 'chapter_failed'
      : 'normal';

    const incomingTutorial = data?.tutorial
      ? cloneTutorialState(data.tutorial)
      : createTutorialState({
          day: currentSave.day,
          tutorialDone: true,
        });
    const settlementOutcome = result === 'win' ? 'win' : 'lose';
    this.tutorial = isBossBattle
      ? createTutorialState({ day: currentSave.day, tutorialDone: true })
      : syncTutorialForResult(incomingTutorial, settlementOutcome);

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
        maxRounds,
        playerHp,
        shield: 0,
        renqing: 0,
        demonHp: result === 'win' ? 0 : 1,
        isBoss: isBossBattle,
        hand: [],
        deckCount: nextSave.deck.length,
        discardCount: 0,
        result,
        resultView: this.resultView,
        demonId,
        demonName,
        demonCustomerLink: demonDef?.customerLink ?? '',
        victoryLine,
        aftermathLine,
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
        tutorialCopy: getTutorialCopy(this.tutorial.currentStep, this.tutorial.settlementOutcome),
      }),
    };

    this.contentLayer = this.add.container(0, 0);

    if (this.resultView === 'diary') {
      this.renderDiaryPage(nextSave);
    } else if (this.resultView === 'chapter_failed') {
      this.renderChapterFailed(demonName, loseReason ?? '');
    } else {
      this.renderNormalResult(
        result,
        demonName,
        victoryLine,
        aftermathLine,
        reward,
        loseReason,
        currentSave,
        nextSave,
      );
    }

    this.renderTutorialBubble();
    this.syncInputBounds();
  }

  private renderDiaryPage(nextSave: SaveData): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const chapterCfg = getChapterConfig(nextSave.chapter.currentChapter);

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num),
      this.add
        .rectangle(centerX, 78, 296, 128, PALETTE.candle.num)
        .setStrokeStyle(2, PALETTE.brass.num),
      this.add.rectangle(centerX, 24, 292, 18, PALETTE.deepWood.num),
      addPixelText(this, centerX, 24, `周日休市 · 《${chapterCfg.diary.title}》`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 42, chapterCfg.diary.subtitle, {
        color: PALETTE.copperBrown.hex,
        origin: 0.5,
      }),
      this.add.rectangle(centerX, 52, 260, 1, PALETTE.oldPaper.num),
      addPixelText(this, 24, 58, wrapCjkText(chapterCfg.diary.body, 22), {
        color: PALETTE.ink.hex,
        origin: [0, 0],
        lineSpacing: 3,
      }),
    ]);

    this.createResultButton(
      DIARY_CONTINUE_BUTTON.x,
      DIARY_CONTINUE_BUTTON.y,
      DIARY_CONTINUE_BUTTON.width,
      DIARY_CONTINUE_BUTTON.height,
      '翻到结局',
      () => {
        this.resultView = 'ending';
        this.renderEndingScreen(nextSave);
      },
    );
  }

  private renderEndingScreen(nextSave: SaveData): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const chapterCfg = getChapterConfig(nextSave.chapter.currentChapter);

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 20, BASE_HEIGHT - 12, PALETTE.deepBlue.num)
        .setStrokeStyle(2, PALETTE.brass.num),
      this.add.rectangle(centerX, 20, BASE_WIDTH - 24, 20, PALETTE.nightBlack.num),
      addPixelText(this, centerX, 20, `第${chapterCfg.id}章 · 完成`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 40, `「${chapterCfg.name}」圆满收官`, {
        color: PALETTE.jade.hex,
        origin: 0.5,
      }),
      this.add
        .rectangle(centerX, 88, 260, 74, PALETTE.nightBlack.num)
        .setStrokeStyle(1, PALETTE.mistBlue.num),
      addPixelText(this, 42, 62, `本章天数: ${chapterCfg.days}天`, {
        color: PALETTE.paperWhite.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 174, 62, `剩余钱: ${nextSave.money}元`, {
        color: PALETTE.lampYellow.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 42, 86, `最终口碑: ${nextSave.reputation}`, {
        color: PALETTE.brass.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 174, 86, `收当件数: ${nextSave.chapter.pawnsCollected}件`, {
        color: PALETTE.candle.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 42, 110, `打赢心魔: ${nextSave.chapter.demonsDefeated}次`, {
        color: PALETTE.jade.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, 174, 110, `终局牌组: ${nextSave.deck.length}张`, {
        color: PALETTE.silverBlue.hex,
        origin: [0, 0.5],
      }),
    ]);

    this.createResultButton(
      ENDING_RESTART_BUTTON.x,
      ENDING_RESTART_BUTTON.y,
      ENDING_RESTART_BUTTON.width,
      ENDING_RESTART_BUTTON.height,
      '再开一局',
      () => {
        const fresh = createNewGame(undefined, nextSave.chapter);
        clearPawnPrices();
        saveGame(fresh);
        this.scene.start('PawnshopScene', { save: fresh });
      },
    );

    this.createResultButton(
      ENDING_TITLE_BUTTON.x,
      ENDING_TITLE_BUTTON.y,
      ENDING_TITLE_BUTTON.width,
      ENDING_TITLE_BUTTON.height,
      '回到标题',
      () => {
        this.scene.start('TitleScene');
      },
    );
  }

  private renderChapterFailed(demonName: string, loseReason: string): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 20, BASE_HEIGHT - 12, PALETTE.deepBlue.num)
        .setStrokeStyle(2, PALETTE.vermilion.num),
      this.add.rectangle(centerX, 20, BASE_WIDTH - 24, 20, PALETTE.nightBlack.num),
      addPixelText(this, centerX, 20, '章节失败 · 第1章未通关', {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 54, `大心魔「${demonName}」未能击退`, {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 78, `失败原因：${loseReason}`, {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 106, '钱与牌组未扣除，可回标题重开第1章', {
        color: PALETTE.silverBlue.hex,
        origin: 0.5,
      }),
    ]);

    this.createResultButton(
      CHAPTER_FAIL_TITLE_BUTTON.x,
      CHAPTER_FAIL_TITLE_BUTTON.y,
      CHAPTER_FAIL_TITLE_BUTTON.width,
      CHAPTER_FAIL_TITLE_BUTTON.height,
      '回到标题',
      () => {
        this.scene.start('TitleScene');
      },
    );
  }

  private renderNormalResult(
    result: 'win' | 'lose_hp' | 'lose_timeout',
    demonName: string,
    victoryLine: string | null,
    aftermathLine: string | null,
    reward: WinReward | null,
    loseReason: string | null,
    currentSave: SaveData,
    nextSave: SaveData,
  ): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 夜里深蓝结算背景与卡片
    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 20, BASE_HEIGHT - 12, PALETTE.deepBlue.num)
        .setStrokeStyle(1, result === 'win' ? PALETTE.brass.num : PALETTE.mistBlue.num),
      // 顶部紧凑标题条（y=8..22，所有结算、C5 胜利叙事与 P10 白天变化排布在 y=8..87，避开 6/6 气泡 y=90..134）
      this.add.rectangle(centerX, 15, BASE_WIDTH - 22, 14, PALETTE.nightBlack.num),
      addPixelText(this, 18, 15, result === 'win' ? '赢了！' : '心魔还在……', {
        color: result === 'win' ? PALETTE.lampYellow.hex : PALETTE.vermilion.hex,
        origin: [0, 0.5],
      }),
      addPixelText(this, BASE_WIDTH - 18, 15, `第${currentSave.day}天 · 当铺Lv.${nextSave.shopLevel}`, {
        color: PALETTE.silverBlue.hex,
        origin: [1, 0.5],
      }),
    ]);

    if (result === 'win' && reward) {
      const moneyTag = reward.allOwnedBonus
        ? `得钱+${reward.money}(全牌加赠)`
        : `得钱:+${reward.money}`;
      this.contentLayer.add([
        addPixelText(this, 20, 29, `击败心魔「${demonName}」`, {
          color: PALETTE.jade.hex,
          origin: [0, 0.5],
        }),
        addPixelText(this, BASE_WIDTH - 20, 29, moneyTag, {
          color: PALETTE.lampYellow.hex,
          origin: [1, 0.5],
        }),
        addPixelText(this, 20, 41, reward.cardName ? `得牌:${reward.cardName}` : '全牌已集齐', {
          color: PALETTE.paperWhite.hex,
          origin: [0, 0.5],
        }),
        addPixelText(this, BASE_WIDTH - 20, 41, `赎当券×${reward.redeemTicket}`, {
          color: PALETTE.brass.hex,
          origin: [1, 0.5],
        }),
        this.add.rectangle(centerX, 49, BASE_WIDTH - 36, 1, PALETTE.nightBlue.num),
      ]);

      // C5 + P10 子项 5：按心魔显示胜利叙事句 + 白天世界实情（不报喜不报忧），置于 y=51..87，完全避开 6/6 气泡 y=90..134
      if (victoryLine) {
        const [line1, line2] = splitVictoryNarrative(victoryLine);
        this.contentLayer.add(
          addPixelText(this, centerX, 57, line1, {
            color: PALETTE.candle.hex,
            origin: 0.5,
          }),
        );
        if (line2) {
          this.contentLayer.add(
            addPixelText(this, centerX, 69, line2, {
              color: PALETTE.paperWhite.hex,
              origin: 0.5,
            }),
          );
        }
      }
      if (aftermathLine) {
        this.contentLayer.add(
          addPixelText(this, centerX, 81, aftermathLine, {
            color: PALETTE.silverBlue.hex,
            origin: 0.5,
          }),
        );
      }
    } else {
      this.contentLayer.add([
        addPixelText(this, centerX, 42, `心魔「${demonName}」未能平息`, {
          color: PALETTE.silverBlue.hex,
          origin: 0.5,
        }),
        addPixelText(this, centerX, 62, `失败原因：${loseReason ?? ''}`, {
          color: PALETTE.vermilion.hex,
          origin: 0.5,
        }),
      ]);
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
  }

  private renderTutorialBubble(): void {
    if (this.tutorialBubble) {
      this.tutorialBubble.destroy();
      this.tutorialBubble = undefined;
    }

    if (!this.tutorial.active || !this.tutorial.currentStep) {
      return;
    }

    this.tutorialBubble = createTutorialBubble(
      this,
      this.tutorial.currentStep,
      {
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
      },
      { settlementOutcome: this.tutorial.settlementOutcome },
    );
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

    const txt = addPixelText(this, x, y, label, {
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

    this.contentLayer.add([btn, txt]);
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
