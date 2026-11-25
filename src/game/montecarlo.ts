import balanceJson from '../data/balance.json';
import cardsJson from '../data/cards.json';
import demonsJson from '../data/demons.json';
import { mulberry32 } from '../utils/rng';
import {
  canPlayCard,
  createBattle,
  endTurn,
  getIntent,
  isAttackCard,
  playCard,
  resolvePendingChoice,
  resolveWinReward,
  type BattleBalanceConfig,
  type BattleState,
  type CardDef,
  type CreateBattleOptions,
  type DemonDef,
} from './battle';
import {
  CHAPTER_DAYS,
  CHAPTER_ONE_ID,
  CHAPTERS,
  deriveSideQuestSeed,
  getBossHpBonus,
  getChapterConfig,
  getPactEffectDelta,
  getRedemptionMultiplier,
  getSkipCustomerReputationDelta,
  pickSideQuestItem,
  removeCardAtIndex,
  selectDemonForChapterDay,
  VALID_PACT_IDS,
  type ChapterConfig,
  type PactId,
} from './chapters';
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
import {
  consumePawnPrice,
  demonIdForDay,
  maxRenqingForLevel,
  recordPawnPrice,
  type DemonId,
  type PawnPriceLedger,
} from './save';

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
export const SIM_BOSS_WIN_RATE_MIN = 0.45;
export const SIM_BOSS_WIN_RATE_MAX = 0.85;
export const SIM_CHAPTER_CLEAR_RATE_MIN = 0.35;
export const SIM_CHAPTER_CLEAR_RATE_MAX = 0.75;
/**
 * P10 子项 7 新玩家首夜模拟护栏（先测 1000 局基线：总胜率 28.5%、单攻击牌 8.8%，
 * 据实测结果定区间，未为过护栏改动任何游戏数值）。
 */
export const SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MIN = 0.2;
export const SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MAX = 0.45;
export const SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MIN = 0.05;
export const SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MAX = 0.25;

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
  interrupts?: number;
  interruptRate?: number;
}

export interface ChapterOneSimStats {
  runs: number;
  clears: number;
  clearRate: number;
  bossReached: number;
  bossWins: number;
  bossWinRate: number;
  bossInterrupts: number;
  bossInterruptRate: number;
  avgNightsWon: number;
  avgFinalMoney: number;
  medianFinalMoney: number;
  avgFinalDeckSize: number;
  avgBossRenqing: number;
}

export interface SimTuneOverrides {
  demonAHp?: number;
  demonBHp?: number;
  demonCHp?: number;
  demonDHp?: number;
  bossCh1Hp?: number;
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

export interface NewPlayerFirstNightStats {
  runs: number;
  wins: number;
  lossesHp: number;
  lossesTimeout: number;
  winRate: number;
  singleAttackRuns: number;
  singleAttackWins: number;
  singleAttackWinRate: number;
  doubleAttackRuns: number;
  doubleAttackWins: number;
  doubleAttackWinRate: number;
  avgEndRound: number;
  avgWinRemainingHp: number;
}

export interface NewPlayerFirstNightSimOptions {
  cards?: readonly CardDef[];
  demons?: readonly DemonDef[];
  battleBalance?: BattleBalanceConfig;
  items?: readonly PawnItem[];
  runs?: number;
}

export interface BalanceSimulationReport {
  overrides: SimTuneOverrides;
  demons: MonteCarloStats[];
  economy: SevenDayEconomyStats;
  boss: MonteCarloStats;
  chapter1: ChapterOneSimStats;
  newPlayerFirstNight: NewPlayerFirstNightStats;
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
  options?: CreateBattleOptions,
): BattleState {
  const rng = mulberry32(seed);
  let state = createBattle(deck, demonId, rng, cards, demons, balance, undefined, options);

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
  options?: CreateBattleOptions,
): MonteCarloStats {
  const demon = demons.find((d) => d.id === demonId) ?? demons[0];
  let wins = 0;
  let lossesHp = 0;
  let lossesTimeout = 0;
  let totalEndRound = 0;
  let totalWinRemainingHp = 0;
  let interrupts = 0;

  for (let seed = 1; seed <= runs; seed += 1) {
    const finalState = simulateSingleBattle(cards, demons, balance, deck, demonId, seed, options);
    totalEndRound += finalState.round;
    if (finalState.bossChargeInterrupted) {
      interrupts += 1;
    }

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
    ...(demon?.isBoss
      ? {
          interrupts,
          interruptRate: runs > 0 ? interrupts / runs : 0,
        }
      : {}),
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

export interface ChapterOneSimOptions {
  cards?: readonly CardDef[];
  demons?: readonly DemonDef[];
  battleBalance?: BattleBalanceConfig;
  pawnBalance?: BalanceConfig;
  items?: readonly PawnItem[];
  chapters?: readonly ChapterConfig[];
  runs?: number;
}

function getCardBaseDamage(card: CardDef | undefined): number {
  if (!card) return 0;
  let total = 0;
  for (const eff of card.effects) {
    if (eff.type === 'damage') total += eff.value ?? 0;
    else if (eff.type === 'damage_conditional') total += (eff.value ?? 0) + (eff.bonus ?? 0) * 0.6;
  }
  return total;
}

function getCardNetRenqing(card: CardDef): number {
  let gain = 0;
  for (const eff of card.effects) {
    if (eff.type === 'renqing') gain += eff.value ?? 0;
  }
  return gain - card.cost;
}

function getCardDrawCount(card: CardDef): number {
  let total = 0;
  for (const eff of card.effects) {
    if (eff.type === 'draw') total += eff.value ?? 0;
  }
  return total;
}

/**
 * Realistic player card selection for Chapter 1 simulation (plays free/net-positive
 * renqing & draw engines like 算盘/余音/集邮/拨浪鼓 before spending last renqing,
 * shields lethal incoming hits, and prioritizes high-efficiency damage).
 */
function pickChapterBattleCardIndex(state: BattleState): number | null {
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

  // 1. Always play strictly net-positive renqing generators first (e.g. 算盘: 1 cost -> +2 renqing)
  const netGain = playable
    .filter((p) => getCardNetRenqing(p.card) > 0 && !p.card.effects.some((e) => e.type === 'discard_for_renqing'))
    .sort((a, b) => getCardNetRenqing(b.card) - getCardNetRenqing(a.card));
  if (netGain.length > 0) {
    return netGain[0].index;
  }

  // 2. Play zero-net-cost damage or draw cards (e.g. 余音: 1 cost -> 3 dmg + 1 renqing; 集邮: 1 cost -> draw 1 + 1 renqing; 拨浪鼓: 0 cost -> draw 1)
  const freeEngine = playable
    .filter(
      (p) =>
        getCardNetRenqing(p.card) === 0 &&
        (getCardDamage(p.card, state) > 0 || getCardDrawCount(p.card) > 0) &&
        !p.card.effects.some((e) => e.type === 'discard_for_renqing'),
    )
    .sort((a, b) => getCardDamage(b.card, state) - getCardDamage(a.card, state) || getCardDrawCount(b.card) - getCardDrawCount(a.card));
  if (freeEngine.length > 0) {
    return freeEngine[0].index;
  }

  // 3. Shield if incoming damage this turn is lethal
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

  // 4. Play draw cards (e.g. 旧书) when we still have extra renqing after drawing to play drawn damage
  if (state.renqing >= 2) {
    const drawCards = playable
      .filter((p) => getCardDrawCount(p.card) >= 2 && getCardDamage(p.card, state) === 0)
      .sort((a, b) => getCardDrawCount(b.card) - getCardDrawCount(a.card));
    if (drawCards.length > 0 && state.drawPile.length + state.discardPile.length > 0) {
      return drawCards[0].index;
    }
  }

  // 5. Play highest damage-per-renqing cards
  const damageCards = playable
    .filter((p) => getCardDamage(p.card, state) > 0)
    .sort((a, b) => {
      const ratioA = getCardDamage(a.card, state) / Math.max(a.card.cost, 0.5);
      const ratioB = getCardDamage(b.card, state) / Math.max(b.card.cost, 0.5);
      if (ratioB !== ratioA) return ratioB - ratioA;
      return getCardDamage(b.card, state) - getCardDamage(a.card, state);
    });
  if (damageCards.length > 0) {
    return damageCards[0].index;
  }

  // 6. Use 当票 if we have a 0-damage card to discard and can gain +2 renqing
  const pawnTicket = playable.find((p) =>
    p.card.effects.some((e) => e.type === 'discard_for_renqing'),
  );
  if (pawnTicket && state.hand.some((n, idx) => idx !== pawnTicket.index && getCardBaseDamage(state.cardsByName.get(n)) === 0)) {
    return pawnTicket.index;
  }

  // 7. Useful non-rewind utility (e.g. 手电, 煤油灯, 铜镜 before heavy hits)
  const utility = playable
    .filter((p) => !isRewindCard(p.card) && getCardShield(p.card) === 0)
    .sort((a, b) => a.card.cost - b.card.cost);
  if (utility.length > 0) {
    return utility[0].index;
  }

  return null;
}

function simulateChapterBattle(
  cards: readonly CardDef[],
  demons: readonly DemonDef[],
  balance: BattleBalanceConfig,
  deck: readonly string[],
  demonId: string,
  seed: number,
  options?: CreateBattleOptions,
): BattleState {
  const rng = mulberry32(seed);
  let state = createBattle(deck, demonId, rng, cards, demons, balance, undefined, options);

  while (state.result === 'ongoing') {
    let playsThisRound = 0;
    while (state.phase === 'play' && state.result === 'ongoing' && playsThisRound < MAX_PLAYS_PER_ROUND) {
      if (state.pendingChoice && state.hand.length > 0) {
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

      const choice = pickChapterBattleCardIndex(state);
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
 * Simulates complete 7-day Chapter 1 runs (Day 1..7 pawnshop, redemption, Day 4 pact + free trim,
 * Day 6 optional side quest, Nights 1..6 chapter demons, and Night 7 Boss).
 */
export function simulateChapterOne(opts: ChapterOneSimOptions = {}): ChapterOneSimStats {
  const cards = opts.cards ?? (cardsJson as CardDef[]);
  const demons = opts.demons ?? (demonsJson as DemonDef[]);
  const battleBalance: BattleBalanceConfig = opts.battleBalance ?? {
    startingHp: balanceJson.startingHp,
    startingRenqing: balanceJson.startingRenqing,
    maxRenqing: balanceJson.maxRenqing,
    drawFirst: balanceJson.drawFirst,
    drawPerRound: balanceJson.drawPerRound,
    winRewardMoney: balanceJson.winRewardMoney,
  };
  const pawnBalance = opts.pawnBalance ?? BALANCE;
  const items = opts.items ?? ITEMS;
  const chapters = opts.chapters ?? CHAPTERS;
  const chapter = getChapterConfig(CHAPTER_ONE_ID, chapters);
  const runs = opts.runs ?? 1000;

  const cardByName = new Map<string, CardDef>();
  for (const card of cards) {
    cardByName.set(card.name, card);
  }

  let clears = 0;
  let bossReached = 0;
  let bossWins = 0;
  let bossInterrupts = 0;
  let totalNightsWon = 0;
  let totalFinalMoney = 0;
  let totalFinalDeckSize = 0;
  let totalBossRenqing = 0;
  const finalMoneys: number[] = [];

  for (let seed = 1; seed <= runs; seed += 1) {
    const offerRng = mulberry32(seed * 9973 + 17);
    const rewardRng = mulberry32(seed * 6131 + 29);

    let money = pawnBalance.startingMoney;
    let reputation = pawnBalance.startingReputation;
    let deck: string[] = [];
    let pawnPrices: PawnPriceLedger = {};
    let redeemTickets = 0;
    let shopLevel = 1;
    let pactChoice: PactId | null = null;
    let sideQuestAccepted = false;
    let nightsWon = 0;

    for (let day = 1; day <= CHAPTER_DAYS; day += 1) {
      // Day 4: Pact (rotate evenly across all 3 pacts so all branches are tested) + free trim
      if (day === 4) {
        pactChoice = VALID_PACT_IDS[(seed - 1) % VALID_PACT_IDS.length];
        const delta = getPactEffectDelta(pactChoice, CHAPTER_ONE_ID, chapters);
        money += delta.moneyDelta;
        reputation += delta.reputationDelta;

        // Free trim: remove 1 zero-damage non-draw/non-renqing card if deck has >= 4 cards
        if (deck.length >= 4) {
          let trimIdx = -1;
          for (let i = 0; i < deck.length; i += 1) {
            const c = cardByName.get(deck[i]);
            if (
              c &&
              getCardBaseDamage(c) === 0 &&
              !c.effects.some((e) => e.type === 'draw' || e.type === 'renqing')
            ) {
              trimIdx = i;
              break;
            }
          }
          if (trimIdx >= 0) {
            deck = removeCardAtIndex(deck, trimIdx);
          }
        }
      }

      // Morning redemption (using chapter pact multiplier if high_margin)
      const redeemMultiplier = getRedemptionMultiplier(pactChoice, CHAPTER_ONE_ID, chapters);
      if (redeemTickets >= 1 && deck.length >= 4) {
        const redeemRng = mulberry32(deriveRedemptionSeed(seed, day));
        const offer = createRedemptionOffer(
          deck,
          redeemTickets,
          pawnPrices,
          redeemRng,
          items,
          redeemMultiplier,
        );
        if (offer) {
          const offerCard = cardByName.get(offer.cardName);
          // Regular player redeems non-damage items (or when low on cash)
          if (getCardBaseDamage(offerCard) === 0 || (money < 50 && deck.length >= 6)) {
            deck.splice(offer.deckIndex, 1);
            pawnPrices = consumePawnPrice(pawnPrices, offer.cardName);
            money += offer.payout;
            reputation += 1;
            redeemTickets -= 1;
          }
        }
      }

      // Daytime pawnshop (3 customers, Day 1 damage guarantee)
      const dayRng = mulberry32(deriveDaySeed(seed, day));
      const dailyCustomers = pickDailyItems(items, day, dayRng, DAILY_CUSTOMER_COUNT);

      // Day 6 optional side quest: accept when deck still wants another damage/draw item and money >= 40
      if (day === 6) {
        const damageCount = deck.filter((n) => getCardBaseDamage(cardByName.get(n)) > 0).length;
        if (damageCount < 5 && money >= 40) {
          const sqRng = mulberry32(deriveSideQuestSeed(seed, CHAPTER_ONE_ID, day));
          const extraItem = pickSideQuestItem(deck, items, sqRng);
          if (extraItem) {
            sideQuestAccepted = true;
            dailyCustomers.push(extraItem);
          }
        }
      }

      const skipRepDelta = getSkipCustomerReputationDelta(pactChoice, CHAPTER_ONE_ID, chapters);
      for (const item of dailyCustomers) {
        const highPrice = quotePrice(item.trueValue, 'high', pawnBalance);
        const fairPrice = quotePrice(item.trueValue, 'fair', pawnBalance);
        const lowPrice = quotePrice(item.trueValue, 'low', pawnBalance);
        const itemCard = cardByName.get(item.cardName);
        const isDamageItem = getCardBaseDamage(itemCard) > 0;
        const isDrawOrRenqing = Boolean(
          itemCard?.effects.some((e) => e.type === 'draw' || e.type === 'renqing'),
        );

        let chosenTier: 'high' | 'fair' | 'low' | null = null;
        if (isDamageItem) {
          // Strongly want damage items (bicycle/erhu): high on Day 1-2 to lock in damage, fair/low otherwise
          if (day <= 2 && money >= highPrice && deck.length < 4) {
            chosenTier = 'high';
          } else if (money >= fairPrice) {
            chosenTier = 'fair';
          } else if (money >= lowPrice) {
            chosenTier = 'low';
          }
        } else if (isDrawOrRenqing) {
          if (money >= fairPrice && deck.length < 8) {
            chosenTier = 'fair';
          } else if (money >= lowPrice && deck.length < 10) {
            chosenTier = 'low';
          }
        } else if (deck.length < 4 && money >= lowPrice) {
          // Only pick up non-damage/non-draw items cheaply if deck is still very small
          chosenTier = 'low';
        }

        if (chosenTier === null) {
          reputation += skipRepDelta;
          continue;
        }

        const price = quotePrice(item.trueValue, chosenTier, pawnBalance);
        const rate = getEffectiveAcceptRate(chosenTier, reputation, pawnBalance, item.temperament);
        if (resolveOffer(rate, offerRng)) {
          money -= price;
          reputation += getReputationDelta(chosenTier, true, item.temperament, pawnBalance);
          deck.push(item.cardName);
          pawnPrices = recordPawnPrice(pawnPrices, item.cardName, price);
        }
      }

      // Night battle
      const demonId = selectDemonForChapterDay(CHAPTER_ONE_ID, day, seed, chapters);
      const nightRenqing = maxRenqingForLevel(shopLevel);
      const nightBalance: BattleBalanceConfig = {
        ...battleBalance,
        startingRenqing: nightRenqing,
        maxRenqing: nightRenqing,
      };
      const demonHpBonus =
        day === 6 && sideQuestAccepted
          ? chapter.day6SideQuest.nightDemonHpBonus
          : day === CHAPTER_DAYS
            ? getBossHpBonus(pactChoice, CHAPTER_ONE_ID, chapters)
            : 0;

      if (day === CHAPTER_DAYS) {
        bossReached += 1;
        totalBossRenqing += nightRenqing;
      }

      if (deck.length === 0) {
        continue;
      }

      const battleSeed = seed * 1009 + day * 37;
      const finalBattle = simulateChapterBattle(
        cards,
        demons,
        nightBalance,
        deck,
        demonId,
        battleSeed,
        { demonHpBonus },
      );

      if (day === CHAPTER_DAYS && finalBattle.bossChargeInterrupted) {
        bossInterrupts += 1;
      }

      if (finalBattle.result === 'win') {
        nightsWon += 1;
        const reward = resolveWinReward(deck, cards, battleBalance, rewardRng);
        money += reward.money;
        if (reward.cardName) {
          deck.push(reward.cardName);
        }
        redeemTickets += reward.redeemTicket;
        shopLevel += 1;
        if (day === CHAPTER_DAYS) {
          bossWins += 1;
          clears += 1;
        }
      }
    }

    totalNightsWon += nightsWon;
    totalFinalMoney += money;
    totalFinalDeckSize += deck.length;
    finalMoneys.push(money);
  }

  return {
    runs,
    clears,
    clearRate: runs > 0 ? clears / runs : 0,
    bossReached,
    bossWins,
    bossWinRate: bossReached > 0 ? bossWins / bossReached : 0,
    bossInterrupts,
    bossInterruptRate: bossReached > 0 ? bossInterrupts / bossReached : 0,
    avgNightsWon: runs > 0 ? totalNightsWon / runs : 0,
    avgFinalMoney: runs > 0 ? totalFinalMoney / runs : 0,
    medianFinalMoney: median(finalMoneys),
    avgFinalDeckSize: runs > 0 ? totalFinalDeckSize / runs : 0,
    avgBossRenqing: bossReached > 0 ? totalBossRenqing / bossReached : 0,
  };
}

/**
 * P10 子项 7：新玩家首夜模拟（真实第 1 天 3 件旧物分布，禁用 TEST_DECK）。
 * 开局牌组 = 按 pickDailyItems(items, 1, rng, 3) 真实分布抽出的 3 件旧物对应牌，
 * 跑 `runs`（默认 1000）局对阵第 1 夜心魔 A（药费），统计总体首夜胜率与“只有一张攻击牌”对局胜率。
 */
export function simulateNewPlayerFirstNight(
  opts: NewPlayerFirstNightSimOptions = {},
): NewPlayerFirstNightStats {
  const cards = opts.cards ?? (cardsJson as CardDef[]);
  const demons = opts.demons ?? (demonsJson as DemonDef[]);
  const battleBalance: BattleBalanceConfig = opts.battleBalance ?? {
    startingHp: balanceJson.startingHp,
    startingRenqing: balanceJson.startingRenqing,
    maxRenqing: balanceJson.maxRenqing,
    drawFirst: balanceJson.drawFirst,
    drawPerRound: balanceJson.drawPerRound,
    winRewardMoney: balanceJson.winRewardMoney,
  };
  const items = opts.items ?? ITEMS;
  const runs = opts.runs ?? 1000;

  const cardByName = new Map<string, CardDef>();
  for (const card of cards) {
    cardByName.set(card.name, card);
  }

  let wins = 0;
  let lossesHp = 0;
  let lossesTimeout = 0;
  let singleAttackRuns = 0;
  let singleAttackWins = 0;
  let doubleAttackRuns = 0;
  let doubleAttackWins = 0;
  let totalEndRound = 0;
  let totalWinRemainingHp = 0;

  for (let seed = 1; seed <= runs; seed += 1) {
    const dayRng = mulberry32(deriveDaySeed(seed, 1));
    const dailyItems = pickDailyItems(items, 1, dayRng, DAILY_CUSTOMER_COUNT);
    const deck = dailyItems.map((item) => item.cardName);
    const attackCount = deck.filter((name) => isAttackCard(cardByName.get(name))).length;

    const battleSeed = seed * 1009 + 37;
    const finalState = simulateChapterBattle(cards, demons, battleBalance, deck, 'a', battleSeed);
    totalEndRound += finalState.round;

    const isSingleAttack = attackCount === 1;
    if (isSingleAttack) {
      singleAttackRuns += 1;
    } else if (attackCount >= 2) {
      doubleAttackRuns += 1;
    }

    if (finalState.result === 'win') {
      wins += 1;
      totalWinRemainingHp += finalState.playerHp;
      if (isSingleAttack) {
        singleAttackWins += 1;
      } else if (attackCount >= 2) {
        doubleAttackWins += 1;
      }
    } else if (finalState.result === 'lose_hp') {
      lossesHp += 1;
    } else {
      lossesTimeout += 1;
    }
  }

  return {
    runs,
    wins,
    lossesHp,
    lossesTimeout,
    winRate: runs > 0 ? wins / runs : 0,
    singleAttackRuns,
    singleAttackWins,
    singleAttackWinRate: singleAttackRuns > 0 ? singleAttackWins / singleAttackRuns : 0,
    doubleAttackRuns,
    doubleAttackWins,
    doubleAttackWinRate: doubleAttackRuns > 0 ? doubleAttackWins / doubleAttackRuns : 0,
    avgEndRound: runs > 0 ? totalEndRound / runs : 0,
    avgWinRemainingHp: wins > 0 ? totalWinRemainingHp / wins : 0,
  };
}

const ALLOWED_SIM_TUNE_KEYS = new Set<keyof SimTuneOverrides>([
  'demonAHp',
  'demonBHp',
  'demonCHp',
  'demonDHp',
  'bossCh1Hp',
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
              : d.id === 'boss_ch1'
                ? overrides.bossCh1Hp
                : undefined;
    return {
      ...d,
      hp: hpOverride ?? d.hp,
      actions: d.actions.map((a) => ({
        ...a,
        ...(a.charge ? { charge: { ...a.charge } } : {}),
      })),
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

  // Standalone Boss simulation at typical Day 7 player level (shopLevel 3 => 5 renqing)
  const bossBalance: BattleBalanceConfig = {
    ...battleBalance,
    startingRenqing: maxRenqingForLevel(3),
    maxRenqing: maxRenqingForLevel(3),
  };
  const bossStats = runMonteCarlo(cards, demons, bossBalance, TEST_DECK, 'boss_ch1', runs);

  // Full 7-day Chapter 1 progression simulation (Day 1 -> Night 7 Boss)
  const chapter1 = simulateChapterOne({
    cards,
    demons,
    battleBalance,
    pawnBalance,
    items: ITEMS,
    chapters: CHAPTERS,
    runs,
  });

  // P10 New-player Night 1 simulation (realistic Day 1 3-item pool via pickDailyItems)
  const newPlayerFirstNight = simulateNewPlayerFirstNight({
    cards,
    demons,
    battleBalance,
    items: ITEMS,
    runs,
  });

  return {
    overrides,
    demons: demonStats,
    economy,
    boss: bossStats,
    chapter1,
    newPlayerFirstNight,
  };
}

/**
 * Balance guardrails for `npm run sim:check`:
 * - Every regular demon (A/B/C/D) win rate must be within [40%, 95%].
 * - 7-day frequent winner median cash flow (Day 7) must be >= 30.
 * - P9 Boss win rate must be within [45%, 85%].
 * - P9 regular 7-day Chapter 1 clear rate must be within [35%, 75%].
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

  const bossWinRate = report.boss.winRate;
  if (bossWinRate < SIM_BOSS_WIN_RATE_MIN || bossWinRate > SIM_BOSS_WIN_RATE_MAX) {
    errors.push(
      `Boss (${report.boss.demonName}) winRate ${(bossWinRate * 100).toFixed(1)}% out of [${(SIM_BOSS_WIN_RATE_MIN * 100).toFixed(0)}%, ${(SIM_BOSS_WIN_RATE_MAX * 100).toFixed(0)}%]`,
    );
  }

  const clearRate = report.chapter1.clearRate;
  if (clearRate < SIM_CHAPTER_CLEAR_RATE_MIN || clearRate > SIM_CHAPTER_CLEAR_RATE_MAX) {
    errors.push(
      `Chapter 1 7-day clearRate ${(clearRate * 100).toFixed(1)}% out of [${(SIM_CHAPTER_CLEAR_RATE_MIN * 100).toFixed(0)}%, ${(SIM_CHAPTER_CLEAR_RATE_MAX * 100).toFixed(0)}%]`,
    );
  }

  const npWinRate = report.newPlayerFirstNight.winRate;
  if (
    npWinRate < SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MIN ||
    npWinRate > SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MAX
  ) {
    errors.push(
      `New-player first-night winRate ${(npWinRate * 100).toFixed(1)}% out of [${(SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MIN * 100).toFixed(0)}%, ${(SIM_NEW_PLAYER_FIRST_NIGHT_WIN_RATE_MAX * 100).toFixed(0)}%]`,
    );
  }

  const npSingleRate = report.newPlayerFirstNight.singleAttackWinRate;
  if (
    npSingleRate < SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MIN ||
    npSingleRate > SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MAX
  ) {
    errors.push(
      `New-player first-night single-attack winRate ${(npSingleRate * 100).toFixed(1)}% out of [${(SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MIN * 100).toFixed(0)}%, ${(SIM_NEW_PLAYER_SINGLE_ATTACK_WIN_RATE_MAX * 100).toFixed(0)}%]`,
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

  const b = report.boss;
  lines.push('\n[第 7 夜大心魔 Boss 单场测试 (TEST_DECK, Lv.3 人情5)]');
  lines.push(
    `  Boss (${b.demonName}): 胜率 ${(b.winRate * 100).toFixed(1)}% (${b.wins}/${b.runs}) | 打断率 ${((b.interruptRate ?? 0) * 100).toFixed(1)}% (${b.interrupts ?? 0}/${b.runs}) | 平均结束回合 ${b.avgEndRound.toFixed(2)} | 胜场残血 ${b.avgWinRemainingHp.toFixed(1)}`,
  );

  const ch = report.chapter1;
  lines.push('\n[第 1 章 7 天完整通关模拟]');
  lines.push(
    `  7 天通关率: ${(ch.clearRate * 100).toFixed(1)}% (${ch.clears}/${ch.runs}) | Boss战胜率: ${(ch.bossWinRate * 100).toFixed(1)}% | Boss打断率: ${(ch.bossInterruptRate * 100).toFixed(1)}%`,
  );
  lines.push(
    `  平均胜夜数: ${ch.avgNightsWon.toFixed(2)}/7 | 第7夜平均人情: ${ch.avgBossRenqing.toFixed(2)} | 终局中位钱: ${ch.medianFinalMoney.toFixed(1)} | 终局均牌数: ${ch.avgFinalDeckSize.toFixed(1)}`,
  );

  const np = report.newPlayerFirstNight;
  lines.push('\n[新玩家首夜模拟 (真实第1天3件旧物分布, 1000 局, 对阵心魔 A 药费)]');
  lines.push(
    `  首夜总胜率: ${(np.winRate * 100).toFixed(1)}% (${np.wins}/${np.runs}) | 平均结束回合 ${np.avgEndRound.toFixed(2)} | 胜场残血 ${np.avgWinRemainingHp.toFixed(1)} | 血归零 ${np.lossesHp} / 超时 ${np.lossesTimeout}`,
  );
  lines.push(
    `  只有1张攻击牌胜率: ${(np.singleAttackWinRate * 100).toFixed(1)}% (${np.singleAttackWins}/${np.singleAttackRuns}) | 2张攻击牌胜率: ${(np.doubleAttackWinRate * 100).toFixed(1)}% (${np.doubleAttackWins}/${np.doubleAttackRuns})`,
  );

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
