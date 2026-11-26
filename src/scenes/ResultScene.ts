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
import {
  buildEndingLedger,
  buildMonthEndEpilogueLines,
  MONTH_END_EPILOGUE_TITLE,
  resolveDemonNarrative,
  type EndingLedgerSummary,
} from '../game/bossComposition';
import { cloneChapterState, getChapterConfig } from '../game/chapters';
import { ITEMS, PALETTE, wrapCjkText } from '../game/pawnshop';
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
import {
  CHAPTER_FAIL_TITLE_BUTTON,
  DIARY_CONTINUE_BUTTON,
  ENDING_EPILOGUE_BUTTON,
  ENDING_RESTART_BUTTON,
  ENDING_TITLE_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  RESULT_RETURN_BUTTON,
} from '../game/layout';
import { createRngFromUrl } from '../utils/rng';
import { BASE_HEIGHT, BASE_WIDTH } from '../utils/scale';

export {
  CHAPTER_FAIL_TITLE_BUTTON,
  DIARY_CONTINUE_BUTTON,
  ENDING_EPILOGUE_BUTTON,
  ENDING_RESTART_BUTTON,
  ENDING_TITLE_BUTTON,
  RESULT_NEXT_DAY_BUTTON,
  RESULT_RETURN_BUTTON,
} from '../game/layout';

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
  bossContributionLines?: string[];
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
  private resultView: 'normal' | 'diary' | 'ending' | 'epilogue' | 'chapter_failed' = 'normal';
  private bossContributionLines: string[] = [];
  private endingLedger: EndingLedgerSummary | null = null;
  private epilogueLines: string[] | null = null;
  private chapterFailHint: string | null = null;
  private normalFailHint: string | null = null;
  private normalFailContinueLine: string | null = null;
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data?: ResultSceneData): void {
    this.tutorialBubble = undefined;
    this.bossContributionLines = data?.bossContributionLines ? [...data.bossContributionLines] : [];
    this.endingLedger = null;
    this.epilogueLines = null;
    this.chapterFailHint = null;
    this.normalFailHint = null;
    this.normalFailContinueLine = null;
    const result = data?.result ?? 'lose_timeout';
    const deck = data?.deck ?? [];
    const demonId = data?.demonId ?? 'a';
    const demonDef = DEMONS.find((d) => d.id === demonId) ?? DEMONS[0];
    const isBossBattle = Boolean(demonDef?.isBoss);
    const demonName = data?.demonName || demonDef?.name || '';
    const currentSavePreview: SaveData = data?.save
      ? {
          ...data.save,
          deck: [...data.save.deck],
          chapter: cloneChapterState(data.save.chapter),
        }
      : { ...createNewGame(), deck: [...deck] };
    const resolvedNarrative =
      !isBossBattle && demonDef
        ? resolveDemonNarrative(
            demonDef,
            deck,
            currentSavePreview.chapter.pawnedItemIds ?? [],
            ITEMS,
          )
        : null;
    const victoryLine = result === 'win' ? (demonDef?.victoryLine ?? null) : null;
    const aftermathLine =
      result === 'win'
        ? (resolvedNarrative?.aftermathLine ?? demonDef?.aftermathLine ?? null)
        : null;
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
    const currentSave: SaveData = currentSavePreview;

    const nextSave = applyDayResult(currentSave, {
      outcome: result === 'win' ? 'win' : 'lose',
      reward,
      isBossBattle,
    });
    saveGame(nextSave);

    if (isBossBattle && result === 'win') {
      this.endingLedger = buildEndingLedger(nextSave.deck, nextSave.chapter, ITEMS);
      this.epilogueLines =
        nextSave.chapter.currentChapter >= 3
          ? buildMonthEndEpilogueLines(this.endingLedger, nextSave.chapter.currentChapter)
          : null;
    }

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
        demonCustomerLink: resolvedNarrative?.customerLink ?? demonDef?.customerLink ?? '',
        victoryLine,
        aftermathLine,
        intent: { current: null, next: null, upcomingSkill: null },
        isAnimating: false,
        reward,
        loseReason,
        chapterFailHint: this.chapterFailHint,
        normalFailHint: this.normalFailHint,
        normalFailContinueLine: this.normalFailContinueLine,
        day: currentSave.day,
        shopLevel: nextSave.shopLevel,
        savedData: nextSave,
        bossContributionLines: this.bossContributionLines.length > 0 ? [...this.bossContributionLines] : undefined,
        endingLedger: this.endingLedger,
        epilogueLines: this.epilogueLines,
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
      this.renderChapterFailed(demonName, loseReason ?? '', result);
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
        .rectangle(centerX, 160, 592, 264, PALETTE.candle.num)
        .setStrokeStyle(4, PALETTE.brass.num),
      this.add.rectangle(centerX, 50, 584, 34, PALETTE.deepWood.num),
      addPixelText(this, centerX, 50, `周日休市 · 《${chapterCfg.diary.title}》`, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 82, chapterCfg.diary.subtitle, {
        color: PALETTE.deepWood.hex,
        origin: 0.5,
      }),
      this.add.rectangle(centerX, 100, 520, 2, PALETTE.oldPaper.num),
      addPixelText(this, 48, 112, wrapCjkText(chapterCfg.diary.body, 22), {
        color: PALETTE.ink.hex,
        origin: [0, 0],
        lineSpacing: 3,
      }),
    ]);

    const ledger = this.endingLedger ?? buildEndingLedger(nextSave.deck, nextSave.chapter, ITEMS);
    const diaryObsessionSummary =
      ledger.bossFragmentItems.length > 0
        ? `本战执念(${ledger.bossFragmentItems.length}块):${ledger.bossFragmentItems.join('·')}`
        : '本战执念:素体(债主只身前来)';
    this.contentLayer.add(
      addPixelText(this, centerX, 258, wrapCjkText(diaryObsessionSummary, 22), {
        color: PALETTE.vermilion.hex,
        origin: 0.5,
        align: 1,
        lineSpacing: 1,
      }),
    );

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
    const ledger = this.endingLedger ?? buildEndingLedger(nextSave.deck, nextSave.chapter, ITEMS);
    this.endingLedger = ledger;

    const chapterId = nextSave.chapter.currentChapter;
    const endingTitle =
      chapterId === chapterCfg.id
        ? `第${chapterCfg.id}章「${chapterCfg.name}」· 结局翻账本`
        : `第${chapterId}章 · 结局翻账本`;

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 40, BASE_HEIGHT - 24, PALETTE.deepBlue.num)
        .setStrokeStyle(4, PALETTE.brass.num),
      this.add.rectangle(centerX, 34, BASE_WIDTH - 48, 34, PALETTE.nightBlack.num),
      addPixelText(this, centerX, 34, endingTitle, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
      addPixelText(
        this,
        centerX,
        68,
        `${chapterCfg.days}天 · 钱${nextSave.money} · 碑${nextSave.reputation} · 收${nextSave.chapter.pawnsCollected} · 胜${nextSave.chapter.demonsDefeated} · ${nextSave.deck.length}牌`,
        {
          color: PALETTE.candle.hex,
          origin: 0.5,
        },
      ),
      this.add
        .rectangle(centerX, 178, 568, 180, PALETTE.nightBlack.num)
        .setStrokeStyle(2, PALETTE.mistBlue.num),
    ]);

    // 逐件点名账本（物归原主 / 留柜未赎 / 化作执念），按实际行数推进 Y，零写死、零溢出、WCAG>=4.5:1
    let cursorY = 98;
    const lineColors = [PALETTE.candle.hex, PALETTE.lampYellow.hex, PALETTE.oldPaper.hex];
    ledger.lines.forEach((rawLine, idx) => {
      const wrapped = wrapCjkText(rawLine, 21);
      const lineCount = wrapped.split('\n').length;
      this.contentLayer.add(
        addPixelText(this, 48, cursorY, wrapped, {
          color: lineColors[idx] ?? PALETTE.paperWhite.hex,
          origin: [0, 0],
          lineSpacing: 1,
        }),
      );
      cursorY += lineCount * 26 + 6;
    });

    if (nextSave.chapter.currentChapter >= 3) {
      this.createResultButton(
        ENDING_EPILOGUE_BUTTON.x,
        ENDING_EPILOGUE_BUTTON.y,
        ENDING_EPILOGUE_BUTTON.width,
        ENDING_EPILOGUE_BUTTON.height,
        '月末结算',
        () => {
          this.resultView = 'epilogue';
          this.renderMonthEndEpilogue(nextSave);
        },
      );
      return;
    }

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

  private renderMonthEndEpilogue(nextSave: SaveData): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const ledger = this.endingLedger ?? buildEndingLedger(nextSave.deck, nextSave.chapter, ITEMS);
    const epilogueLines =
      this.epilogueLines ?? buildMonthEndEpilogueLines(ledger, nextSave.chapter.currentChapter);
    this.epilogueLines = epilogueLines;

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.ink.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 40, BASE_HEIGHT - 24, PALETTE.candle.num)
        .setStrokeStyle(4, PALETTE.brass.num),
      this.add.rectangle(centerX, 36, BASE_WIDTH - 48, 34, PALETTE.deepWood.num),
      addPixelText(this, centerX, 36, MONTH_END_EPILOGUE_TITLE, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
    ]);

    let cursorY = 68;
    epilogueLines.forEach((rawLine, idx) => {
      const wrapped = wrapCjkText(rawLine, 22);
      const lineCount = wrapped.split('\n').length;
      const color =
        idx === 0 || idx === epilogueLines.length - 1 ? PALETTE.ink.hex : PALETTE.deepWood.hex;
      this.contentLayer.add(
        addPixelText(this, 44, cursorY, wrapped, {
          color,
          origin: [0, 0],
          lineSpacing: 1,
        }),
      );
      cursorY += lineCount * 26 + 6;
    });

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

  private renderChapterFailed(
    demonName: string,
    loseReason: string,
    result: 'win' | 'lose_hp' | 'lose_timeout',
  ): void {
    this.contentLayer.removeAll(true);
    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);
    const hintText =
      result === 'lose_hp'
        ? '提醒：先攒护盾牌，顶住前两回合'
        : '提醒：试试多攒伤害牌来打断封门';
    this.chapterFailHint = hintText;

    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 40, BASE_HEIGHT - 24, PALETTE.deepBlue.num)
        .setStrokeStyle(4, PALETTE.vermilion.num),
      this.add.rectangle(centerX, 38, BASE_WIDTH - 48, 36, PALETTE.vermilion.num),
      addPixelText(this, centerX, 38, '章节失败 · 第1章未通关', {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 92, `大心魔「${demonName}」未能击退`, {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
      this.add
        .rectangle(centerX, 138, 400, 34, PALETTE.vermilion.num)
        .setStrokeStyle(2, PALETTE.ink.num),
      addPixelText(this, centerX, 138, `失败原因：${loseReason}`, {
        color: PALETTE.paperWhite.hex,
        origin: 0.5,
      }),
      this.add
        .rectangle(centerX, 192, 520, 36, PALETTE.nightBlack.num)
        .setStrokeStyle(2, PALETTE.brass.num),
      addPixelText(this, centerX, 192, hintText, {
        color: PALETTE.lampYellow.hex,
        origin: 0.5,
      }),
      addPixelText(this, centerX, 242, '钱与牌组未扣除，可回标题重开第1章', {
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

    // 夜里深蓝结算背景与卡片（所有正文排布在 y=16..180，严格避开 6/6 气泡 y=186..274 与底部按钮 y=286..334）
    this.contentLayer.add([
      this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num),
      this.add
        .rectangle(centerX, centerY, BASE_WIDTH - 40, BASE_HEIGHT - 24, PALETTE.deepBlue.num)
        .setStrokeStyle(2, result === 'win' ? PALETTE.brass.num : PALETTE.mistBlue.num),
      this.add.rectangle(centerX, 30, BASE_WIDTH - 44, 28, PALETTE.nightBlack.num),
    ]);

    if (result === 'win') {
      this.contentLayer.add(
        addPixelText(this, 36, 30, '赢了！', {
          color: PALETTE.lampYellow.hex,
          origin: [0, 0.5],
        }),
      );
    } else {
      this.contentLayer.add([
        this.add.rectangle(108, 30, 152, 24, PALETTE.vermilion.num),
        addPixelText(this, 108, 30, '心魔还在……', {
          color: PALETTE.paperWhite.hex,
          origin: 0.5,
        }),
      ]);
    }

    this.contentLayer.add(
      addPixelText(this, BASE_WIDTH - 36, 30, `第${currentSave.day}天 · 当铺Lv.${nextSave.shopLevel}`, {
        color: PALETTE.silverBlue.hex,
        origin: [1, 0.5],
      }),
    );

    if (result === 'win' && reward) {
      const moneyTag = reward.allOwnedBonus
        ? `得钱+${reward.money}(全牌加赠)`
        : `得钱:+${reward.money}`;
      this.contentLayer.add([
        addPixelText(this, 40, 58, `击败心魔「${demonName}」`, {
          color: PALETTE.candle.hex,
          origin: [0, 0.5],
        }),
        addPixelText(this, BASE_WIDTH - 40, 58, moneyTag, {
          color: PALETTE.lampYellow.hex,
          origin: [1, 0.5],
        }),
        addPixelText(this, 40, 82, reward.cardName ? `得牌:${reward.cardName}` : '全牌已集齐', {
          color: PALETTE.paperWhite.hex,
          origin: [0, 0.5],
        }),
        addPixelText(this, BASE_WIDTH - 40, 82, `赎当券×${reward.redeemTicket}`, {
          color: PALETTE.brass.hex,
          origin: [1, 0.5],
        }),
        this.add.rectangle(centerX, 98, BASE_WIDTH - 72, 2, PALETTE.nightBlue.num),
      ]);

      // C5 + P10 子项 5：胜利叙事句 + 白天世界实情，置于 y=114..174，完全避开 6/6 气泡 y=186..274
      if (victoryLine) {
        const [line1, line2] = splitVictoryNarrative(victoryLine);
        this.contentLayer.add(
          addPixelText(this, centerX, 114, line1, {
            color: PALETTE.candle.hex,
            origin: 0.5,
          }),
        );
        if (line2) {
          this.contentLayer.add(
            addPixelText(this, centerX, 138, line2, {
              color: PALETTE.paperWhite.hex,
              origin: 0.5,
            }),
          );
        }
      }
      if (aftermathLine) {
        this.contentLayer.add(
          addPixelText(this, centerX, 162, aftermathLine, {
            color: PALETTE.silverBlue.hex,
            origin: 0.5,
          }),
        );
      }
    } else {
      const hintText =
        result === 'lose_hp'
          ? '提醒：先攒护盾牌，顶住前两回合'
          : '提醒：伤害牌太少，试试多收带伤的旧物';
      const continueLine = '输了这一夜没事，钱与牌都在，明天继续';
      this.normalFailHint = hintText;
      this.normalFailContinueLine = continueLine;

      this.contentLayer.add([
        addPixelText(this, centerX, 66, `心魔「${demonName}」未能平息`, {
          color: PALETTE.silverBlue.hex,
          origin: 0.5,
        }),
        this.add
          .rectangle(centerX, 102, 360, 32, PALETTE.vermilion.num)
          .setStrokeStyle(2, PALETTE.ink.num),
        addPixelText(this, centerX, 102, `失败原因：${loseReason ?? ''}`, {
          color: PALETTE.paperWhite.hex,
          origin: 0.5,
        }),
        this.add
          .rectangle(centerX, 140, 460, 28, PALETTE.nightBlack.num)
          .setStrokeStyle(2, PALETTE.brass.num),
        addPixelText(this, centerX, 140, hintText, {
          color: PALETTE.lampYellow.hex,
          origin: 0.5,
        }),
        addPixelText(this, centerX, 171, continueLine, {
          color: PALETTE.silverBlue.hex,
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
      .setStrokeStyle(2, PALETTE.brass.num)
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
