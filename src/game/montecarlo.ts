import { mulberry32 } from '../utils/rng';
import {
  canPlayCard,
  createBattle,
  endTurn,
  getIntent,
  playCard,
  type BattleBalanceConfig,
  type BattleState,
  type CardDef,
  type DemonDef,
} from './battle';

/**
 * 固定测试牌组（10 张，覆盖伤害/护盾/抽牌/人情四类，仅供验证与蒙特卡洛测试）。
 */
export const TEST_DECK: readonly string[] = [
  '倒转',
  '守诺',
  '旧书',
  '算盘',
  '钢笔',
  '秤砣',
  '相机',
  '弹珠',
  '蒲扇',
  '暖水瓶',
];

export interface MonteCarloStats {
  demonId: string;
  demonName: string;
  runs: number;
  wins: number;
  lossesHp: number;
  lossesTimeout: number;
  winRate: number;
  avgEndRound: number;
  avgWinRemainingHp: number;
}

const MAX_PLAYS_PER_ROUND = 30;

function getCardDamage(card: CardDef, state: BattleState): number {
  let total = 0;
  for (const effect of card.effects) {
    if (effect.type === 'damage') {
      total += effect.value ?? 0;
    } else if (effect.type === 'damage_conditional') {
      total += state.demonHasActed
        ? (effect.value ?? 0) + (effect.bonus ?? 0)
        : (effect.value ?? 0);
    }
  }
  return total;
}

function getCardShield(card: CardDef): number {
  let total = 0;
  for (const effect of card.effects) {
    if (effect.type === 'shield') {
      total += effect.value ?? 0;
    }
  }
  return total;
}

function isRewindCard(card: CardDef): boolean {
  return card.effects.some((effect) => effect.type === 'rewind');
}

/**
 * 蒙特卡洛贪心策略（写死规则，便于复现与平衡评估）：
 * 1. 若心魔本回合将造成的伤害对玩家致命（incoming - shield >= playerHp），优先出护盾量最高的可用护盾牌保命；
 * 2. 否则按“伤害 / 人情费用”从高到低打出能出的伤害牌（0 费按 0.5 计防除零）；
 * 3. 无可用伤害牌时，出其余非纯护盾牌（如抽牌、人情、功能牌）按费用从低到高打出；
 *    注：倒转牌（rewind）若会回复心魔已损失血量且玩家并非濒死，则不出，避免撤销自身输出；
 * 4. 无牌可出时结束回合。
 */
export function pickGreedyCardIndex(state: BattleState): number | null {
  if (state.phase !== 'play' || state.result !== 'ongoing') {
    return null;
  }

  const playable: { index: number; card: CardDef }[] = [];
  for (let i = 0; i < state.hand.length; i += 1) {
    if (canPlayCard(state, i)) {
      const card = state.cardsByName.get(state.hand[i]);
      if (card) {
        playable.push({ index: i, card });
      }
    }
  }

  if (playable.length === 0) {
    return null;
  }

  const intent = getIntent(state);
  const incoming = intent.current?.damage ?? 0;
  const isLethalIncoming = !state.reflectNextDamage && incoming - state.shield >= state.playerHp;

  // 1. 致命伤时优先出护盾牌
  if (isLethalIncoming) {
    const shieldCards = playable
      .filter((p) => getCardShield(p.card) > 0)
      .sort((a, b) => getCardShield(b.card) - getCardShield(a.card) || a.card.cost - b.card.cost);
    if (shieldCards.length > 0) {
      return shieldCards[0].index;
    }
  }

  // 2. 按“伤害/人情比”从高到低出伤害牌
  const damageCards = playable
    .filter((p) => getCardDamage(p.card, state) > 0)
    .sort((a, b) => {
      const ratioA = getCardDamage(a.card, state) / Math.max(a.card.cost, 0.5);
      const ratioB = getCardDamage(b.card, state) / Math.max(b.card.cost, 0.5);
      if (ratioB !== ratioA) {
        return ratioB - ratioA;
      }
      return getCardDamage(b.card, state) - getCardDamage(a.card, state);
    });
  if (damageCards.length > 0) {
    return damageCards[0].index;
  }

  // 3. 其余非护盾牌按费用从低到高出（避免非致命时倒转回满心魔血）
  const otherCards = playable
    .filter((p) => {
      if (getCardShield(p.card) > 0) {
        return false;
      }
      if (isRewindCard(p.card)) {
        // 仅在玩家血量危急且倒转能回血时才考虑打出
        const snapIndex = Math.min(Math.max(0, state.round - 2), state.roundSnapshots.length - 1);
        const snap = state.roundSnapshots[snapIndex];
        return isLethalIncoming && snap !== undefined && snap.playerHp > state.playerHp;
      }
      return true;
    })
    .sort((a, b) => a.card.cost - b.card.cost);

  if (otherCards.length > 0) {
    return otherCards[0].index;
  }

  return null;
}

/**
 * Simulates a single battle to completion using the greedy strategy.
 */
export function simulateSingleBattle(
  cards: readonly CardDef[],
  demons: readonly DemonDef[],
  balance: BattleBalanceConfig,
  deck: readonly string[],
  demonId: string,
  seed: number,
): BattleState {
  const rng = mulberry32(seed);
  let state = createBattle(deck, demonId, rng, cards, demons, balance);

  while (state.result === 'ongoing') {
    let playsThisRound = 0;
    while (state.phase === 'play' && state.result === 'ongoing' && playsThisRound < MAX_PLAYS_PER_ROUND) {
      const choice = pickGreedyCardIndex(state);
      if (choice === null) {
        break;
      }
      state = playCard(state, choice);
      playsThisRound += 1;
    }

    if (state.result === 'ongoing') {
      state = endTurn(state);
    }
  }

  return state;
}

/**
 * Runs `runs` deterministic seeded battles (seeds 1..runs) and aggregates statistics.
 */
export function runMonteCarlo(
  cards: readonly CardDef[],
  demons: readonly DemonDef[],
  balance: BattleBalanceConfig,
  deck: readonly string[],
  demonId: string,
  runs = 1000,
): MonteCarloStats {
  const demon = demons.find((d) => d.id === demonId) ?? demons[0];
  let wins = 0;
  let lossesHp = 0;
  let lossesTimeout = 0;
  let totalEndRound = 0;
  let totalWinRemainingHp = 0;

  for (let seed = 1; seed <= runs; seed += 1) {
    const finalState = simulateSingleBattle(cards, demons, balance, deck, demonId, seed);
    totalEndRound += finalState.round;

    if (finalState.result === 'win') {
      wins += 1;
      totalWinRemainingHp += finalState.playerHp;
    } else if (finalState.result === 'lose_hp') {
      lossesHp += 1;
    } else {
      lossesTimeout += 1;
    }
  }

  return {
    demonId: demon?.id ?? demonId,
    demonName: demon?.name ?? demonId,
    runs,
    wins,
    lossesHp,
    lossesTimeout,
    winRate: runs > 0 ? wins / runs : 0,
    avgEndRound: runs > 0 ? totalEndRound / runs : 0,
    avgWinRemainingHp: wins > 0 ? totalWinRemainingHp / wins : 0,
  };
}
