import Phaser from 'phaser';
import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import {
  resolveWinReward,
  type BattleBalanceConfig,
  type CardDef,
  type WinReward,
} from '../game/battle';
import { PALETTE } from '../game/pawnshop';
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
}

const CARDS: readonly CardDef[] = cardsJson as CardDef[];
const RESULT_BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

export const RESULT_RETURN_BUTTON = { x: 160, y: 148, width: 108, height: 26 } as const;

export class ResultScene extends Phaser.Scene {
  private handleWindowResize?: () => void;

  constructor() {
    super({ key: 'ResultScene' });
  }

  create(data?: ResultSceneData): void {
    const result = data?.result ?? 'lose_timeout';
    const deck = data?.deck ?? [];
    const demonId = data?.demonId ?? 'a';
    const demonName = data?.demonName ?? '';
    const playerHp = data?.playerHp ?? 0;
    const round = data?.round ?? 1;
    const maxRounds = data?.maxRounds ?? round;

    let reward: WinReward | null = null;
    let loseReason: string | null = null;

    if (result === 'win') {
      const { rng } = createRngFromUrl();
      reward = resolveWinReward(deck, CARDS, RESULT_BALANCE, rng);
    } else if (result === 'lose_hp') {
      loseReason = '被打倒';
    } else {
      loseReason = `${maxRounds} 回合未分胜负`;
    }

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
        deckCount: deck.length,
        discardCount: 0,
        result,
        demonId,
        demonName,
        intent: { current: null, next: null, upcomingSkill: null },
        isAnimating: false,
        reward,
        loseReason,
      }),
    };

    const centerX = Math.floor(BASE_WIDTH / 2);
    const centerY = Math.floor(BASE_HEIGHT / 2);

    // 夜里深蓝结算背景与卡片
    this.add.rectangle(centerX, centerY, BASE_WIDTH, BASE_HEIGHT, PALETTE.nightBlack.num);
    this.add
      .rectangle(centerX, centerY, BASE_WIDTH - 28, BASE_HEIGHT - 24, PALETTE.deepBlue.num)
      .setStrokeStyle(1, result === 'win' ? PALETTE.brass.num : PALETTE.mistBlue.num);

    // 标题条
    this.add.rectangle(centerX, 28, BASE_WIDTH - 30, 24, PALETTE.nightBlack.num);
    this.add
      .text(centerX, 28, result === 'win' ? '赢了！' : '心魔还在……', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: result === 'win' ? PALETTE.lampYellow.hex : PALETTE.vermilion.hex,
        resolution: 1,
      })
      .setOrigin(0.5);

    if (result === 'win' && reward) {
      this.add
        .text(centerX, 56, `击败心魔「${demonName}」`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.jade.hex,
          resolution: 1,
        })
        .setOrigin(0.5);

      const moneyLine = reward.allOwnedBonus
        ? `得钱：+${reward.money}（全牌已有加赠）`
        : `得钱：+${reward.money}`;
      this.add
        .text(centerX, 78, moneyLine, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.lampYellow.hex,
          resolution: 1,
        })
        .setOrigin(0.5);

      if (reward.cardName) {
        this.add
          .text(centerX, 98, `得牌：${reward.cardName}`, {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: PALETTE.paperWhite.hex,
            resolution: 1,
          })
          .setOrigin(0.5);
      }

      this.add
        .text(centerX, 118, `赎当券 ×${reward.redeemTicket}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.brass.hex,
          resolution: 1,
        })
        .setOrigin(0.5);
    } else {
      this.add
        .text(centerX, 68, `心魔「${demonName}」未能平息`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.silverBlue.hex,
          resolution: 1,
        })
        .setOrigin(0.5);

      this.add
        .text(centerX, 94, `失败原因：${loseReason ?? ''}`, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: PALETTE.vermilion.hex,
          resolution: 1,
        })
        .setOrigin(0.5);
    }

    // 返回标题按钮
    const btn = this.add
      .rectangle(
        RESULT_RETURN_BUTTON.x,
        RESULT_RETURN_BUTTON.y,
        RESULT_RETURN_BUTTON.width,
        RESULT_RETURN_BUTTON.height,
        PALETTE.nightBlack.num,
      )
      .setStrokeStyle(1, PALETTE.brass.num)
      .setInteractive({ useHandCursor: true });

    this.add
      .text(RESULT_RETURN_BUTTON.x, RESULT_RETURN_BUTTON.y, '返回标题', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: PALETTE.paperWhite.hex,
        resolution: 1,
      })
      .setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(PALETTE.nightBlue.num));
    btn.on('pointerout', () => btn.setFillStyle(PALETTE.nightBlack.num));
    btn.on('pointerdown', () => {
      this.scene.start('TitleScene');
    });

    this.syncInputBounds();
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
