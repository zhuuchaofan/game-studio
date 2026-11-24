import type { RngFn } from '../utils/rng';

export type CardEffectType =
  | 'damage'
  | 'shield'
  | 'draw'
  | 'heal'
  | 'renqing'
  | 'renqing_next'
  | 'rewind'
  | 'illuminate'
  | 'reflect'
  | 'reveal'
  | 'damage_conditional'
  | 'discard_for_renqing';

export interface CardEffect {
  type: CardEffectType;
  value?: number;
  bonus?: number;
}

export interface CardDef {
  id: string;
  name: string;
  item: string;
  cost: number;
  effects: CardEffect[];
  story: string;
  color?: string;
}

export interface DemonAction {
  round: number;
  damage: number;
  skill?: string;
}

export interface DemonDef {
  id: string;
  name: string;
  hp: number;
  actions: DemonAction[];
}

export interface BattleBalanceConfig {
  startingHp: number;
  startingRenqing: number;
  maxRenqing: number;
  drawFirst: number;
  drawPerRound: number;
  winRewardMoney: number;
}

export type BattlePhase = 'draw' | 'play' | 'demonAct' | 'roundEnd' | 'result';

export type BattleResult = 'ongoing' | 'win' | 'lose_hp' | 'lose_timeout';

export interface RoundSnapshot {
  playerHp: number;
  demonHp: number;
}

export interface BattleState {
  phase: BattlePhase;
  round: number;
  maxRounds: number;
  playerHp: number;
  maxPlayerHp: number;
  shield: number;
  renqing: number;
  maxRenqing: number;
  nextRoundRenqingBonus: number;
  demonId: string;
  demonName: string;
  demonHp: number;
  demonMaxHp: number;
  demonActions: DemonAction[];
  demonHasActed: boolean;
  hand: string[];
  drawPile: string[];
  discardPile: string[];
  illuminateNextDraw: boolean;
  reflectNextDamage: boolean;
  revealedNextIntent: boolean;
  roundSnapshots: RoundSnapshot[];
  result: BattleResult;
  log: string[];
  /** Internal runtime references (non-serialized, provided by createBattle). */
  readonly cardsByName: ReadonlyMap<string, CardDef>;
  readonly balance: BattleBalanceConfig;
  readonly rng: RngFn;
}

export interface EffectContext {
  cardsByName: ReadonlyMap<string, CardDef>;
  rng: RngFn;
}

/**
 * Pure Fisher-Yates shuffle returning a new array without mutating input.
 */
export function shuffleArray<T>(items: readonly T[], rng: RngFn): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * Attack card predicate: any card containing a damage-type effect.
 */
export function isAttackCard(card: CardDef | undefined): boolean {
  if (!card) {
    return false;
  }
  return card.effects.some(
    (effect) => effect.type === 'damage' || effect.type === 'damage_conditional',
  );
}

/**
 * Clones a BattleState shallowly with fresh copies of all mutable arrays.
 */
export function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    demonActions: state.demonActions.map((a) => ({ ...a })),
    hand: [...state.hand],
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    roundSnapshots: state.roundSnapshots.map((snap) => ({ ...snap })),
    log: [...state.log],
  };
}

/**
 * Draws `count` cards from drawPile into hand, reshuffling discardPile when needed,
 * and honoring `illuminateNextDraw` on the next draw. Pure & immutable.
 */
export function drawCardsFromState(
  state: BattleState,
  count: number,
  ctx: EffectContext,
): BattleState {
  if (count <= 0) {
    return cloneBattleState(state);
  }

  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];
  const hand = [...state.hand];
  let illuminateNextDraw = state.illuminateNextDraw;

  for (let i = 0; i < count; i += 1) {
    if (drawPile.length === 0) {
      if (discardPile.length === 0) {
        break;
      }
      drawPile = shuffleArray(discardPile, ctx.rng);
      discardPile = [];
    }

    if (illuminateNextDraw) {
      const topCard = ctx.cardsByName.get(drawPile[0]);
      if (!isAttackCard(topCard)) {
        const attackIdx = drawPile.findIndex((name) => isAttackCard(ctx.cardsByName.get(name)));
        if (attackIdx > 0) {
          const [attackCard] = drawPile.splice(attackIdx, 1);
          drawPile.unshift(attackCard);
        }
      }
      illuminateNextDraw = false;
    }

    const drawn = drawPile.shift();
    if (drawn !== undefined) {
      hand.push(drawn);
    }
  }

  return {
    ...cloneBattleState(state),
    hand,
    drawPile,
    discardPile,
    illuminateNextDraw,
  };
}

/**
 * EffectRunner: dispatches a single declarative CardEffect by `effect.type`,
 * returning a new BattleState without mutating the input state.
 */
export function applyEffect(
  state: BattleState,
  effect: CardEffect,
  ctx: EffectContext,
): BattleState {
  const next = cloneBattleState(state);

  switch (effect.type) {
    case 'damage': {
      const amount = effect.value ?? 0;
      next.demonHp = Math.max(0, next.demonHp - amount);
      return next;
    }

    case 'damage_conditional': {
      const base = effect.value ?? 0;
      const bonus = effect.bonus ?? 0;
      const amount = next.demonHasActed ? base + bonus : base;
      next.demonHp = Math.max(0, next.demonHp - amount);
      return next;
    }

    case 'shield': {
      const amount = effect.value ?? 0;
      next.shield += amount;
      return next;
    }

    case 'draw': {
      const count = effect.value ?? 0;
      return drawCardsFromState(next, count, ctx);
    }

    case 'heal': {
      const amount = effect.value ?? 0;
      next.playerHp = Math.min(next.maxPlayerHp, next.playerHp + amount);
      return next;
    }

    case 'renqing': {
      const amount = effect.value ?? 0;
      next.renqing += amount;
      return next;
    }

    case 'renqing_next': {
      const amount = effect.value ?? 0;
      next.nextRoundRenqingBonus += amount;
      return next;
    }

    case 'rewind': {
      if (next.roundSnapshots.length === 0) {
        return next;
      }
      // Round 2 -> index 0 (start of Round 1); Round 3 -> index 1 (start of Round 2); Round 1 -> index 0.
      const targetIndex = Math.min(
        Math.max(0, next.round - 2),
        next.roundSnapshots.length - 1,
      );
      const snapshot = next.roundSnapshots[targetIndex];
      next.playerHp = snapshot.playerHp;
      next.demonHp = snapshot.demonHp;
      return next;
    }

    case 'illuminate': {
      next.illuminateNextDraw = true;
      return next;
    }

    case 'reflect': {
      next.reflectNextDamage = true;
      return next;
    }

    case 'reveal': {
      next.revealedNextIntent = true;
      return next;
    }

    case 'discard_for_renqing': {
      if (next.hand.length === 0) {
        return next;
      }
      const discarded = next.hand.shift();
      if (discarded !== undefined) {
        next.discardPile.push(discarded);
      }
      next.renqing += effect.value ?? 0;
      return next;
    }
  }
}
