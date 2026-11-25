import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import { mulberry32 } from '../utils/rng';
import {
  canPlayCard,
  createBattle,
  endTurn,
  getIntent,
  playCard,
  resolvePendingChoice,
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
  getReputationDelta,
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

export const SIM_WIN_RATE_MIN = 0.4;
export const SIM_WIN_RATE_MAX = 0.95;
export const SIM_FREQUENT_WINNER_MEDIAN_MIN = 30;

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

export interface SimTuneOverrides {
  demonAHp?: number;
  demonBHp?: number;
  demonCHp?: number;
  demonDHp?: number;
  startingHp?: number;
  startingRenqing?: number;
  maxRenqing?: number;
  drawFirst?: number;
  drawPerRound?: number;
  winRewardMoney?: number;
  startingMoney?: number;
  runs?: number;
  days?: number;
}

export interface BalanceSimulationReport {
  overrides: SimTuneOverrides;
  demons: MonteCarloStats[];
  economy: SevenDayEconomyStats;
}

export interface SimGuardrailCheckResult {
  passed: boolean;
  errors: string[];
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

export function pickGreedyCardIndex(state: BattleState): number | null {
  if (state.phase !== 'play' || state.result !== 'ongoing' || state.pendingChoice !== null) {
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

  if (isLethalIncoming) {
    const shieldCards = playable
      .filter((p) => getCardShield(p.card) > 0)
      .sort((a, b) => getCardShield(b.card) - getCardShield(a.card) || a.card.cost - b.card.cost);
    if (shieldCards.length > 0) {
      return shieldCards[0].index;
    }
  }

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

  const otherCards = playable
    .filter((p) => {
      if (getCardShield(p.card) > 0) {
        return false;
      }
      if (isRewindCard(p.card)) {
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
      if (state.pendingChoice && state.hand.length > 0) {
        // Greedy discard: drop the lowest-damage card in hand
        let discardIdx = 0;
        let lowestDmg = Infinity;
        for (let i = 0; i < state.hand.length; i += 1) {
          const card = state.cardsByName.get(state.hand[i]);
          const dmg = card ? getCardDamage(card, state) : 0;
          if (dmg < lowestDmg) {
            lowestDmg = dmg;
            discardIdx = i;
          }
        }
        state = resolvePendingChoice(state, discardIdx).state;
        continue;
      }

      const choice = pickGreedyCardIndex(state);
      if (choice === null) {
        break;
      }
      state = playCard(state, choice).state;
      playsThisRound += 1;
    }

    if (state.result === 'ongoing') {
      state = endTurn(state).state;
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
  tightBuffer?: number;
  enableRedemption?: boolean;
  minDeckForRedeem?: number;
  forceWinAllNights?: boolean;
  balance?: BalanceConfig;
  items?: readonly PawnItem[];
}

export interface SevenDayEconomyStats {
  runs: number;
  days: number;
  winRewardMoney: number;
  avgMoneyByDay: number[];
  medianMoneyByDay: number[];
  frequentWinnerAvgByDay: number[];
  frequentWinnerMedianByDay: number[];
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
        const rate = getEffectiveAcceptRate(chosenTier, reputation, balance, item.temperament);
        if (resolveOffer(rate, offerRng)) {
          money -= price;
          reputation += getReputationDelta(chosenTier, true, item.temperament, balance);
          deck.push(item.cardName);
          pawnPrices = recordPawnPrice(pawnPrices, item.cardName, price);
        }
      }

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
    frequentWinnerMedianByDay: moneyPerDayWinners.map((arr) => median(arr)),
    frequentWinnerCount: moneyPerDayWinners[0]?.length ?? 0,
    avgTotalWins: totalWinsSum / runs,
    avgFinalDeckSize: totalDeckSizeSum / runs,
    avgRedemptionsAccepted: totalRedemptionsSum / runs,
  };
}

const ALLOWED_SIM_TUNE_KEYS = new Set<keyof SimTuneOverrides>([
  'demonAHp',
  'demonBHp',
  'demonCHp',
  'demonDHp',
  'startingHp',
  'startingRenqing',
  'maxRenqing',
  'drawFirst',
  'drawPerRound',
  'winRewardMoney',
  'startingMoney',
  'runs',
  'days',
]);

/**
 * Parses SIM_TUNE JSON env override (e.g. SIM_TUNE='{"demonAHp":22}').
 */
export function parseSimTuneEnv(raw?: string | null): SimTuneOverrides {
  if (!raw || raw.trim() === '') {
    return {};
  }
  const parsed: unknown = JSON.parse(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('SIM_TUNE must be a JSON object');
  }
  const overrides: SimTuneOverrides = {};
  for (const [key, val] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ALLOWED_SIM_TUNE_KEYS.has(key as keyof SimTuneOverrides)) {
      throw new Error(`Unknown SIM_TUNE key: "${key}"`);
    }
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new Error(`SIM_TUNE.${key} must be a finite number`);
    }
    overrides[key as keyof SimTuneOverrides] = val;
  }
  return overrides;
}

/**
 * Runs the full CLI balance simulation (4 demons + 7-day economy with redemption)
 * with optional SIM_TUNE hot overrides.
 */
export function runBalanceSimulation(overrides: SimTuneOverrides = {}): BalanceSimulationReport {
  const cards = cardsJson as CardDef[];
  const baseDemons = demonsJson as DemonDef[];
  const demons: DemonDef[] = baseDemons.map((d) => {
    const hpOverride =
      d.id === 'a'
        ? overrides.demonAHp
        : d.id === 'b'
          ? overrides.demonBHp
          : d.id === 'c'
            ? overrides.demonCHp
            : d.id === 'd'
              ? overrides.demonDHp
              : undefined;
    return {
      ...d,
      hp: hpOverride ?? d.hp,
      actions: d.actions.map((a) => ({ ...a })),
    };
  });

  const battleBalance: BattleBalanceConfig = {
    startingHp: overrides.startingHp ?? balanceJson.startingHp,
    startingRenqing: overrides.startingRenqing ?? balanceJson.startingRenqing,
    maxRenqing: overrides.maxRenqing ?? balanceJson.maxRenqing,
    drawFirst: overrides.drawFirst ?? balanceJson.drawFirst,
    drawPerRound: overrides.drawPerRound ?? balanceJson.drawPerRound,
    winRewardMoney: overrides.winRewardMoney ?? balanceJson.winRewardMoney,
  };

  const pawnBalance: BalanceConfig = {
    ...BALANCE,
    startingMoney: overrides.startingMoney ?? BALANCE.startingMoney,
    startingHp: battleBalance.startingHp,
    startingRenqing: battleBalance.startingRenqing,
    maxRenqing: battleBalance.maxRenqing,
  };

  const runs = overrides.runs ?? 1000;
  const days = overrides.days ?? 7;

  const demonStats: MonteCarloStats[] = (['a', 'b', 'c', 'd'] as const).map((id) =>
    runMonteCarlo(cards, demons, battleBalance, TEST_DECK, id, runs),
  );

  const demonWinRates: Record<DemonId, number> = {
    a: demonStats[0].winRate,
    b: demonStats[1].winRate,
    c: demonStats[2].winRate,
    d: demonStats[3].winRate,
  };

  const economy = simulateSevenDayEconomy({
    winRewardMoney: battleBalance.winRewardMoney,
    demonWinRates,
    runs,
    days,
    tightBuffer: 0,
    enableRedemption: true,
    minDeckForRedeem: 4,
    balance: pawnBalance,
    items: ITEMS,
  });

  return {
    overrides,
    demons: demonStats,
    economy,
  };
}

/**
 * Balance guardrails for `npm run sim:check`:
 * - Every demon win rate must be within [40%, 95%].
 * - 7-day frequent winner median cash flow (Day 7) must be >= 30.
 */
export function checkSimGuardrails(report: BalanceSimulationReport): SimGuardrailCheckResult {
  const errors: string[] = [];

  for (const d of report.demons) {
    if (d.winRate < SIM_WIN_RATE_MIN || d.winRate > SIM_WIN_RATE_MAX) {
      errors.push(
        `Demon ${d.demonId.toUpperCase()} (${d.demonName}) winRate ${(d.winRate * 100).toFixed(1)}% out of [${(SIM_WIN_RATE_MIN * 100).toFixed(0)}%, ${(SIM_WIN_RATE_MAX * 100).toFixed(0)}%]`,
      );
    }
  }

  const lastDayIdx = report.economy.days - 1;
  const freqMedian = report.economy.frequentWinnerMedianByDay[lastDayIdx] ?? 0;
  if (freqMedian < SIM_FREQUENT_WINNER_MEDIAN_MIN) {
    errors.push(
      `7-day frequent-winner median cash flow ${freqMedian.toFixed(1)} is below guardrail ${SIM_FREQUENT_WINNER_MEDIAN_MIN}`,
    );
  }

  return {
    passed: errors.length === 0,
    errors,
  };
}

export function formatSimReport(report: BalanceSimulationReport): string {
  const lines: string[] = ['=== 《当铺纸牌》蒙特卡洛平衡模拟报告 ==='];
  const tuneEntries = Object.entries(report.overrides);
  if (tuneEntries.length > 0) {
    lines.push(`SIM_TUNE: ${JSON.stringify(report.overrides)}`);
  }

  lines.push('\n[4 心魔战斗胜率 (1000 局/心魔)]');
  for (const d of report.demons) {
    lines.push(
      `  心魔 ${d.demonId.toUpperCase()} (${d.demonName}): 胜率 ${(d.winRate * 100).toFixed(1)}% (${d.wins}/${d.runs}) | 平均结束回合 ${d.avgEndRound.toFixed(2)} | 胜场残血 ${d.avgWinRemainingHp.toFixed(1)}`,
    );
  }

  const eco = report.economy;
  const lastIdx = eco.days - 1;
  const medTrail = eco.medianMoneyByDay.map((v) => v.toFixed(1)).join(' -> ');
  const fwMedTrail = eco.frequentWinnerMedianByDay.map((v) => v.toFixed(1)).join(' -> ');
  lines.push('\n[7 天经济现金流与赎当]');
  lines.push(`  全体第 ${eco.days} 天中位现金流: ${eco.medianMoneyByDay[lastIdx].toFixed(1)} (逐日: ${medTrail})`);
  lines.push(
    `  常赢玩家(>=5胜, n=${eco.frequentWinnerCount})第 ${eco.days} 天中位现金流: ${eco.frequentWinnerMedianByDay[lastIdx].toFixed(1)} (逐日: ${fwMedTrail})`,
  );
  lines.push(
    `  常赢玩家第 ${eco.days} 天均值现金流: ${eco.frequentWinnerAvgByDay[lastIdx].toFixed(1)} | 平均赎当次数: ${eco.avgRedemptionsAccepted.toFixed(2)} | 平均胜场: ${eco.avgTotalWins.toFixed(2)}`,
  );

  return lines.join('\n');
}
