import type { RngFn } from '../utils/rng';
import {
  applyEffect,
  cloneBattleState,
  drawCardsFromState,
  isAttackCard,
  shuffleArray,
  type BattleBalanceConfig,
  type BattlePhase,
  type BattleResult,
  type BattleState,
  type CardDef,
  type CardEffect,
  type CardEffectType,
  type DemonAction,
  type DemonDef,
  type EffectContext,
  type RoundSnapshot,
} from './effects';

export type {
  BattleBalanceConfig,
  BattlePhase,
  BattleResult,
  BattleState,
  CardDef,
  CardEffect,
  CardEffectType,
  DemonAction,
  DemonDef,
  EffectContext,
  RoundSnapshot,
};
export { applyEffect, isAttackCard, shuffleArray };

export interface IntentInfo {
  current: DemonAction | null;
  next: DemonAction | null;
  upcomingSkill: DemonAction | null;
}

export interface WinReward {
  money: number;
  cardName: string | null;
  redeemTicket: number;
  allOwnedBonus: boolean;
}

export interface BattleDebugSnapshot {
  phase: BattlePhase | 'empty_deck' | 'result_scene';
  round: number;
  playerHp: number;
  shield: number;
  renqing: number;
  maxRenqing?: number;
  demonHp: number;
  hand: string[];
  deckCount: number;
  discardCount: number;
  result: BattleResult | 'empty_deck';
  demonId: string;
  demonName: string;
  intent: IntentInfo;
  isAnimating?: boolean;
  reward?: WinReward | null;
  loseReason?: string | null;
  day?: number;
  shopLevel?: number;
  savedData?: {
    version: 1;
    day: number;
    money: number;
    reputation: number;
    deck: string[];
    shopLevel: number;
    redeemTickets: number;
    tutorialCompleted?: boolean;
  } | null;
  /** 新手教程状态（供 E2E 测试断言用）。 */
  tutorialActive?: boolean;
  currentStep?: string | null;
  tutorialDone?: boolean;
  tutorialCopy?: string | null;
}

/**
 * 测试钩子接口（仅供 E2E 自动化测试断言使用，非正式游戏功能）。
 */
export interface BattleDebugHook {
  getState: () => BattleDebugSnapshot;
}

declare global {
  interface Window {
    // 测试钩子（仅供测试断言用，非正式功能）
    __BATTLE_DEBUG__?: BattleDebugHook;
  }
}

/**
 * Builds a lookup map from card name to CardDef.
 */
export function buildCardMap(cards: readonly CardDef[]): Map<string, CardDef> {
  const map = new Map<string, CardDef>();
  for (const card of cards) {
    map.set(card.name, card);
  }
  return map;
}

/**
 * Initializes a new card battle state machine (draw -> play).
 * Does not read JSON directly: `cards`, `demons`, and `balance` are injected.
 */
export function createBattle(
  deckCardNames: readonly string[],
  demonId: string,
  rng: RngFn,
  cards: readonly CardDef[],
  demons: readonly DemonDef[],
  balance: BattleBalanceConfig,
): BattleState {
  const demon = demons.find((d) => d.id === demonId) ?? demons[0];
  if (!demon) {
    throw new Error(`Demon not found: ${demonId}`);
  }

  const cardsByName = buildCardMap(cards);
  const shuffledDeck = shuffleArray(deckCardNames, rng);
  const maxRounds = demon.actions.length;

  const initialDrawPhase: BattleState = {
    phase: 'draw',
    round: 1,
    maxRounds,
    playerHp: balance.startingHp,
    maxPlayerHp: balance.startingHp,
    shield: 0,
    renqing: balance.startingRenqing,
    maxRenqing: balance.maxRenqing,
    nextRoundRenqingBonus: 0,
    demonId: demon.id,
    demonName: demon.name,
    demonHp: demon.hp,
    demonMaxHp: demon.hp,
    demonActions: demon.actions.map((a) => ({ ...a })),
    demonHasActed: false,
    hand: [],
    drawPile: shuffledDeck,
    discardPile: [],
    illuminateNextDraw: false,
    reflectNextDamage: false,
    revealedNextIntent: false,
    roundSnapshots: [{ playerHp: balance.startingHp, demonHp: demon.hp }],
    result: 'ongoing',
    log: [],
    cardsByName,
    balance: { ...balance },
    rng,
  };

  const afterDraw = drawCardsFromState(initialDrawPhase, balance.drawFirst, {
    cardsByName,
    rng,
  });

  return {
    ...afterDraw,
    phase: 'play',
  };
}

/**
 * Returns whether the card at `handIndex` can currently be played.
 */
export function canPlayCard(state: BattleState, handIndex: number): boolean {
  if (state.phase !== 'play' || state.result !== 'ongoing') {
    return false;
  }
  if (handIndex < 0 || handIndex >= state.hand.length) {
    return false;
  }

  const cardName = state.hand[handIndex];
  const card = state.cardsByName.get(cardName);
  if (!card) {
    return false;
  }

  if (state.renqing < card.cost) {
    return false;
  }

  // 当票（discard_for_renqing）需要弃掉手牌中除本身外的至少 1 张牌
  const requiresOtherCard = card.effects.some((e) => e.type === 'discard_for_renqing');
  if (requiresOtherCard && state.hand.length < 2) {
    return false;
  }

  return true;
}

/**
 * Plays the card at `handIndex`, applying its effects sequentially.
 * Pure & immutable: returns unchanged clone if the play is illegal.
 */
export function playCard(state: BattleState, handIndex: number): BattleState {
  if (!canPlayCard(state, handIndex)) {
    return cloneBattleState(state);
  }

  const cardName = state.hand[handIndex];
  const card = state.cardsByName.get(cardName);
  if (!card) {
    return cloneBattleState(state);
  }

  let current = cloneBattleState(state);
  current.renqing -= card.cost;
  current.hand.splice(handIndex, 1);

  const ctx: EffectContext = {
    cardsByName: current.cardsByName,
    rng: current.rng,
  };

  for (const effect of card.effects) {
    current = applyEffect(current, effect, ctx);
  }

  current.discardPile.push(cardName);
  current.log.push(`R${current.round}:打出${cardName}(费${card.cost})`);

  // 伤害立即击杀心魔 -> 立即判胜
  if (current.demonHp <= 0) {
    current.demonHp = 0;
    current.phase = 'result';
    current.result = 'win';
  }

  return current;
}

/**
 * Ends the player's turn: transitions play -> demonAct -> roundEnd -> (next round draw -> play | result).
 * Pure & immutable.
 */
export function endTurn(state: BattleState): BattleState {
  if (state.phase !== 'play' || state.result !== 'ongoing') {
    return cloneBattleState(state);
  }

  let current = cloneBattleState(state);

  // 1. demonAct phase
  current.phase = 'demonAct';
  const action = current.demonActions.find((a) => a.round === current.round);
  current.demonHasActed = true;
  const incomingDamage = action?.damage ?? 0;

  if (incomingDamage > 0) {
    if (current.reflectNextDamage) {
      current.demonHp = Math.max(0, current.demonHp - incomingDamage);
      current.reflectNextDamage = false;
      current.log.push(`R${current.round}:反弹${incomingDamage}伤`);
      if (current.demonHp <= 0) {
        current.phase = 'result';
        current.result = 'win';
        return current;
      }
    } else {
      const absorbed = Math.min(current.shield, incomingDamage);
      const hpDamage = incomingDamage - absorbed;
      current.shield -= absorbed;
      current.playerHp = Math.max(0, current.playerHp - hpDamage);
      const skillPrefix = action?.skill ? `${action.skill} ` : '';
      current.log.push(
        `R${current.round}:心魔${skillPrefix}造成${incomingDamage}伤(盾挡${absorbed},扣血${hpDamage})`,
      );
      if (current.playerHp <= 0) {
        current.phase = 'result';
        current.result = 'lose_hp';
        return current;
      }
    }
  }

  // 2. roundEnd phase
  current.phase = 'roundEnd';
  if (current.round >= current.maxRounds) {
    current.phase = 'result';
    current.result = 'lose_timeout';
    return current;
  }

  // 3. Advance to next round: reset shield, refill renqing (+ next bonus), save snapshot, draw
  current.round += 1;
  current.shield = 0;
  current.renqing = current.maxRenqing + current.nextRoundRenqingBonus;
  current.nextRoundRenqingBonus = 0;
  current.roundSnapshots.push({
    playerHp: current.playerHp,
    demonHp: current.demonHp,
  });

  current.phase = 'draw';
  current = drawCardsFromState(current, current.balance.drawPerRound, {
    cardsByName: current.cardsByName,
    rng: current.rng,
  });
  current.phase = 'play';

  return current;
}

/**
 * Returns the demon's current-round intent, plus upcoming skill warning (e.g. "远行")
 * and next-round intent when `revealedNextIntent` (收音机) is active.
 */
export function getIntent(state: BattleState): IntentInfo {
  const current = state.demonActions.find((a) => a.round === state.round) ?? null;
  const nextAction = state.demonActions.find((a) => a.round === state.round + 1) ?? null;

  return {
    current: current ? { ...current } : null,
    next: state.revealedNextIntent && nextAction ? { ...nextAction } : null,
    upcomingSkill: nextAction?.skill ? { ...nextAction } : null,
  };
}

/**
 * Computes victory rewards deterministically using seeded RNG.
 */
export function resolveWinReward(
  deckCardNames: readonly string[],
  cards: readonly CardDef[],
  balance: BattleBalanceConfig,
  rng: RngFn,
): WinReward {
  const owned = new Set(deckCardNames);
  const available = cards.filter((c) => !owned.has(c.name));

  if (available.length === 0) {
    return {
      money: balance.winRewardMoney * 2,
      cardName: null,
      redeemTicket: 1,
      allOwnedBonus: true,
    };
  }

  const index = Math.floor(rng() * available.length);
  const picked = available[index];
  return {
    money: balance.winRewardMoney,
    cardName: picked.name,
    redeemTicket: 1,
    allOwnedBonus: false,
  };
}

/**
 * Builds the read-only snapshot returned by window.__BATTLE_DEBUG__.getState().
 */
export function toBattleDebugSnapshot(
  state: BattleState,
  isAnimating = false,
): BattleDebugSnapshot {
  return {
    phase: state.phase,
    round: state.round,
    playerHp: state.playerHp,
    shield: state.shield,
    renqing: state.renqing,
    maxRenqing: state.maxRenqing,
    demonHp: state.demonHp,
    hand: [...state.hand],
    deckCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    result: state.result,
    demonId: state.demonId,
    demonName: state.demonName,
    intent: getIntent(state),
    isAnimating,
  };
}

/**
 * Generates a compact Chinese summary of a card's effects for 48x64 card rendering.
 */
export function formatEffectShort(card: CardDef): string {
  const parts = card.effects.map((e) => {
    switch (e.type) {
      case 'damage':
        return `伤${e.value ?? 0}`;
      case 'damage_conditional':
        return `伤${e.value ?? 0}/${(e.value ?? 0) + (e.bonus ?? 0)}`;
      case 'shield':
        return `盾${e.value ?? 0}`;
      case 'draw':
        return `抽${e.value ?? 0}`;
      case 'heal':
        return `回${e.value ?? 0}`;
      case 'renqing':
        return `情+${e.value ?? 0}`;
      case 'renqing_next':
        return `下回+${e.value ?? 0}情`;
      case 'rewind':
        return '倒转';
      case 'illuminate':
        return '照亮';
      case 'reflect':
        return '反伤';
      case 'reveal':
        return '探意';
      case 'discard_for_renqing':
        return `弃1+${e.value ?? 0}情`;
    }
  });
  return parts.join('');
}
