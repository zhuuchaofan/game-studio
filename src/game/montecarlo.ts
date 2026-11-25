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
import {
  BALANCE,
  createRedemptionOffer,
  DAILY_CUSTOMER_COUNT,
  deriveDaySeed,
  deriveRedemptionSeed,
  getEffectiveAcceptRate,
  ITEMS,
  pickDailyItems,
  quotePrice,
  resolveOffer,
  type BalanceConfig,
  type PawnItem,
} from './pawnshop';
import { consumePawnPrice, demonIdForDay, recordPawnPrice, type DemonId, type PawnPriceLedger } from './save';

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

export interface EconomySimOptions {
  winRewardMoney: number;
  demonWinRates: Record<DemonId, number>;
  runs?: number;
  days?: number;
  /** Minimum reserve to keep when choosing fair tier; when tight (money < fairPrice + tightBuffer), try low tier. */
  tightBuffer?: number;
  /** Whether player uses C4 redemption when holding >= 1 ticket and >= minDeckForRedeem cards. */
  enableRedemption?: boolean;
  minDeckForRedeem?: number;
  /** If true, force every night to win (models a frequent/consistent winner). */
  forceWinAllNights?: boolean;
  balance?: BalanceConfig;
  items?: readonly PawnItem[];
}

export interface SevenDayEconomyStats {
  runs: number;
  days: number;
  winRewardMoney: number;
  /** Average end-of-day money for days 1..7 (index 0 = Day 1 after night reward). */
  avgMoneyByDay: number[];
  /** Median end-of-day money for days 1..7. */
  medianMoneyByDay: number[];
  /** Average end-of-day money among frequent winners (>= 5 wins in 7 nights). */
  frequentWinnerAvgByDay: number[];
  frequentWinnerCount: number;
  avgTotalWins: number;
  avgFinalDeckSize: number;
  avgRedemptionsAccepted: number;
}

function median(values: readonly number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * 7-day daytime + nighttime economy simulation (P6 B3):
 * Strategy: offer fair if comfortably affordable (money >= fairPrice + tightBuffer),
 * try low when money is tight (money >= lowPrice), skip if unaffordable;
 * night battle win probability is taken from Monte Carlo results per demon.
 */
export function simulateSevenDayEconomy(opts: EconomySimOptions): SevenDayEconomyStats {
  const runs = opts.runs ?? 1000;
  const days = opts.days ?? 7;
  const tightBuffer = opts.tightBuffer ?? 0;
  const enableRedemption = opts.enableRedemption ?? false;
  const minDeckForRedeem = opts.minDeckForRedeem ?? 4;
  const forceWinAllNights = opts.forceWinAllNights ?? false;
  const balance = opts.balance ?? BALANCE;
  const items = opts.items ?? ITEMS;

  const moneyPerDayAll: number[][] = Array.from({ length: days }, () => []);
  const moneyPerDayWinners: number[][] = Array.from({ length: days }, () => []);
  let totalWinsSum = 0;
  let totalDeckSizeSum = 0;
  let totalRedemptionsSum = 0;

  for (let seed = 1; seed <= runs; seed += 1) {
    const offerRng = mulberry32(seed * 9973 + 17);
    const nightRng = mulberry32(seed * 7919 + 31);

    let money = balance.startingMoney;
    let reputation = balance.startingReputation;
    const deck: string[] = [];
    let pawnPrices: PawnPriceLedger = {};
    let redeemTickets = 0;
    let wins = 0;
    let redemptionsAccepted = 0;
    const trajectory: number[] = [];

    for (let day = 1; day <= days; day += 1) {
      // Optional C4 pre-day redemption
      if (enableRedemption && redeemTickets >= 1 && deck.length >= minDeckForRedeem) {
        const redeemRng = mulberry32(deriveRedemptionSeed(seed, day));
        const offer = createRedemptionOffer(deck, redeemTickets, pawnPrices, redeemRng, items);
        if (offer) {
          deck.splice(offer.deckIndex, 1);
          pawnPrices = consumePawnPrice(pawnPrices, offer.cardName);
          money += offer.payout;
          reputation += 1;
          redeemTickets -= 1;
          redemptionsAccepted += 1;
        }
      }

      const dayRng = mulberry32(deriveDaySeed(seed, day));
      const dailyCustomers = pickDailyItems(items, day, dayRng, DAILY_CUSTOMER_COUNT);

      for (const item of dailyCustomers) {
        const fairPrice = quotePrice(item.trueValue, 'fair', balance);
        const lowPrice = quotePrice(item.trueValue, 'low', balance);

        let chosenTier: 'fair' | 'low' | null = null;
        if (money >= fairPrice + tightBuffer) {
          chosenTier = 'fair';
        } else if (money >= lowPrice) {
          chosenTier = 'low';
        }

        if (chosenTier === null) {
          continue;
        }

        const price = quotePrice(item.trueValue, chosenTier, balance);
        const rate = getEffectiveAcceptRate(chosenTier, reputation, balance);
        if (resolveOffer(rate, offerRng)) {
          money -= price;
          reputation += balance.tiers[chosenTier].reputationOnAccept;
          deck.push(item.cardName);
          pawnPrices = recordPawnPrice(pawnPrices, item.cardName, price);
        }
      }

      // Night battle outcome using Monte Carlo demon win rate
      const demonId = demonIdForDay(day);
      const winRate = opts.demonWinRates[demonId];
      const won = forceWinAllNights || nightRng() < winRate;
      if (won) {
        money += opts.winRewardMoney;
        redeemTickets += 1;
        wins += 1;
      }

      trajectory.push(money);
    }

    for (let d = 0; d < days; d += 1) {
      moneyPerDayAll[d].push(trajectory[d]);
    }
    if (wins >= 5) {
      for (let d = 0; d < days; d += 1) {
        moneyPerDayWinners[d].push(trajectory[d]);
      }
    }

    totalWinsSum += wins;
    totalDeckSizeSum += deck.length;
    totalRedemptionsSum += redemptionsAccepted;
  }

  return {
    runs,
    days,
    winRewardMoney: opts.winRewardMoney,
    avgMoneyByDay: moneyPerDayAll.map((arr) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
    ),
    medianMoneyByDay: moneyPerDayAll.map((arr) => median(arr)),
    frequentWinnerAvgByDay: moneyPerDayWinners.map((arr) =>
      arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0,
    ),
    frequentWinnerCount: moneyPerDayWinners[0]?.length ?? 0,
    avgTotalWins: totalWinsSum / runs,
    avgFinalDeckSize: totalDeckSizeSum / runs,
    avgRedemptionsAccepted: totalRedemptionsSum / runs,
  };
}
