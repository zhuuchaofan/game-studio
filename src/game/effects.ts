import itemsJson from '../data/items.json';
import type { RngFn } from '../utils/rng';
import type { HookRegistry } from './hooks';

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
  | 'shield_conditional'
  | 'draw_conditional'
  | 'discard_for_renqing';

export interface CardEffect {
  type: CardEffectType;
  value?: number;
  bonus?: number;
  condition?: CardEffectCondition;
  threshold?: number;
}

export type CardEffectCondition =
  | 'demon_acted'
  | 'has_item_card_in_hand'
  | 'enemy_hp_le'
  | 'has_shield';

const ITEM_CARD_NAMES: ReadonlySet<string> = new Set(itemsJson.map((item) => item.cardName));

/**
 * Counts how many item (旧物) cards are currently in `hand`.
 */
export function countItemCardsInHand(hand: readonly string[]): number {
  let count = 0;
  for (const name of hand) {
    if (ITEM_CARD_NAMES.has(name)) {
      count += 1;
    }
  }
  return count;
}

/**
 * True when the hand holds an item (旧物) card. The card being played has already left the
 * hand when its effects resolve, so this naturally means "another" item card.
 */
export function hasItemCardInHand(hand: readonly string[]): boolean {
  return countItemCardsInHand(hand) > 0;
}

export interface CardDef {
  id: string;
  name: string;
  item: string;
  set?: '旧物';
  cost: number;
  unplayable?: boolean;
  effects: CardEffect[];
  story: string;
  color?: string;
}

export interface DemonChargeConfig {
  threshold: number;
  refundRenqing: number;
  interruptedNextDamage: number;
}

export interface DemonAction {
  round: number;
  damage: number;
  skill?: string;
  shield?: number;
  charge?: DemonChargeConfig;
}

export interface DemonObsessionConfig {
  hpBonus?: number;
  roundDeltas?: Record<string, number>;
  effectLabel: string;
  pawnHint: string;
}

export interface DemonItemNarrative {
  customerLink: string;
  victoryLine: string;
  aftermathLine: string;
}

export interface BossComponentDef {
  itemId: string;
  cardName: string;
  name: string;
  fragmentName: string;
  shortLabel: string;
  effectText: string;
  hpBonus: number;
  roundDeltas: Record<string, number>;
  shield: number;
  chargeThresholdDelta: number;
}

export interface BossCompositionConfig {
  baseHp: number;
  maxCompositionHp: number;
  absoluteMaxHp: number;
  bareIntroLine: string;
  composedIntroLine: string;
  components: BossComponentDef[];
}

export interface DemonDef {
  id: string;
  name: string;
  hp: number;
  isBoss?: boolean;
  chapter?: number;
  linkedItemIds?: string[];
  linkedItemNarratives?: Record<string, DemonItemNarrative>;
  mechanicLine?: string;
  obsession?: DemonObsessionConfig;
  introLine?: string;
  customerLink?: string;
  genericCustomerLink?: string;
  customerTag?: string;
  victoryLine?: string;
  genericVictoryLine?: string;
  aftermathLine?: string;
  genericAftermathLine?: string;
  composition?: BossCompositionConfig;
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

/**
 * Pure JSON-serializable paused card-choice continuation.
 */
export interface PendingChoice {
  kind: 'discard';
  sourceCardName: string;
  prompt: string;
  count: number;
  then: CardEffect[];
  returnToHandOnCancel?: {
    cardName: string;
    cost: number;
  };
}

export type BattleEvent =
  | { type: 'CARD_PLAYED'; cardName: string; cost: number; round: number }
  | {
      type: 'DAMAGE_DEALT';
      target: 'demon' | 'player';
      amount: number;
      source: string;
      demonHpAfter?: number;
      demonShieldAfter?: number;
      shieldAbsorbed?: number;
      hpDamage?: number;
      playerHpAfter?: number;
    }
  | { type: 'SHIELD_GAINED'; amount: number; shieldAfter: number; source: string }
  | { type: 'REFLECT_TRIGGERED'; damage: number; demonHpAfter: number }
  | {
      type: 'REWIND_APPLIED';
      playerHpBefore: number;
      playerHpAfter: number;
      demonHpBefore: number;
      demonHpAfter: number;
    }
  | {
      type: 'DEMON_ACT';
      round: number;
      skill?: string;
      rawDamage: number;
      absorbed: number;
      hpDamage: number;
      reflected: boolean;
    }
  | {
      type: 'BOSS_CHARGE_STARTED';
      round: number;
      skill: string;
      shieldGained: number;
      threshold: number;
      refundRenqing: number;
    }
  | {
      type: 'BOSS_CHARGE_INTERRUPTED';
      round: number;
      skill: string;
      damageDealt: number;
      threshold: number;
      refundRenqing: number;
      renqingAfter: number;
      reducedNextDamage: number;
    }
  | { type: 'BATTLE_ENDED'; result: Exclude<BattleResult, 'ongoing'>; round: number }
  | { type: 'CARD_DISCARDED'; cardName: string; handIndex: number }
  | { type: 'CHOICE_REQUIRED'; choice: PendingChoice }
  | { type: 'RENQING_GAINED'; amount: number; renqingAfter: number; source: string }
  | { type: 'HEAL_APPLIED'; amount: number; playerHpAfter: number }
  | { type: 'CARDS_DRAWN'; cards: string[] }
  | { type: 'TURN_STARTED'; round: number; renqing: number };

export interface BattleActionResult {
  state: BattleState;
  events: BattleEvent[];
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
  isBoss: boolean;
  demonMechanicLine: string;
  demonIntroLine: string;
  demonCustomerLink: string;
  demonCustomerTag: string;
  demonVictoryLine: string;
  demonAftermathLine: string;
  demonHp: number;
  demonMaxHp: number;
  demonShield: number;
  demonActions: DemonAction[];
  demonHasActed: boolean;
  bossCharging: boolean;
  bossChargeSkill: string | null;
  bossChargeDamage: number;
  bossChargeThreshold: number;
  bossChargeRefundRenqing: number;
  bossChargeInterrupted: boolean;
  bossInterruptedNextDamage: number | null;
  bossChargeRound: number | null;
  hand: string[];
  drawPile: string[];
  discardPile: string[];
  illuminateNextDraw: boolean;
  reflectNextDamage: boolean;
  revealedNextIntent: boolean;
  roundSnapshots: RoundSnapshot[];
  pendingChoice: PendingChoice | null;
  result: BattleResult;
  log: string[];
  /** Internal runtime references (non-serialized, provided by createBattle). */
  readonly cardsByName: ReadonlyMap<string, CardDef>;
  readonly balance: BattleBalanceConfig;
  readonly rng: RngFn;
  readonly hooks?: HookRegistry;
}

export interface EffectContext {
  cardsByName: ReadonlyMap<string, CardDef>;
  rng: RngFn;
}

export function clonePendingChoice(choice: PendingChoice | null): PendingChoice | null {
  if (!choice) {
    return null;
  }
  return {
    kind: choice.kind,
    sourceCardName: choice.sourceCardName,
    prompt: choice.prompt,
    count: choice.count,
    then: choice.then.map((e) => ({ ...e })),
    ...(choice.returnToHandOnCancel
      ? { returnToHandOnCancel: { ...choice.returnToHandOnCancel } }
      : {}),
  };
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
 * Clones a BattleState shallowly with fresh copies of all mutable arrays & pendingChoice.
 */
export function cloneBattleState(state: BattleState): BattleState {
  return {
    ...state,
    demonActions: state.demonActions.map((a) => ({
      ...a,
      ...(a.charge ? { charge: { ...a.charge } } : {}),
    })),
    hand: [...state.hand],
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    roundSnapshots: state.roundSnapshots.map((snap) => ({ ...snap })),
    pendingChoice: clonePendingChoice(state.pendingChoice),
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
  return drawCardsWithEvents(state, count, ctx).state;
}

export function drawCardsWithEvents(
  state: BattleState,
  count: number,
  ctx: EffectContext,
): BattleActionResult {
  if (count <= 0) {
    return { state: cloneBattleState(state), events: [] };
  }

  let drawPile = [...state.drawPile];
  let discardPile = [...state.discardPile];
  const hand = [...state.hand];
  let illuminateNextDraw = state.illuminateNextDraw;
  const drawnCards: string[] = [];

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
      drawnCards.push(drawn);
    }
  }

  const nextState: BattleState = {
    ...cloneBattleState(state),
    hand,
    drawPile,
    discardPile,
    illuminateNextDraw,
  };

  return {
    state: nextState,
    events: drawnCards.length > 0 ? [{ type: 'CARDS_DRAWN', cards: drawnCards }] : [],
  };
}

function applyDamageToDemon(
  next: BattleState,
  amount: number,
  sourceName: string,
  events: BattleEvent[],
): void {
  const shieldAbsorbed = Math.min(next.demonShield, Math.max(0, amount));
  const hpDamage = Math.max(0, amount - shieldAbsorbed);
  next.demonShield -= shieldAbsorbed;
  next.demonHp = Math.max(0, next.demonHp - hpDamage);

  events.push({
    type: 'DAMAGE_DEALT',
    target: 'demon',
    amount,
    source: sourceName,
    demonHpAfter: next.demonHp,
    ...(shieldAbsorbed > 0 || next.isBoss
      ? {
          shieldAbsorbed,
          hpDamage,
          demonShieldAfter: next.demonShield,
        }
      : {}),
  });

  if (next.bossCharging && !next.bossChargeInterrupted && amount > 0) {
    next.bossChargeDamage += amount;
    if (next.bossChargeDamage >= next.bossChargeThreshold) {
      next.bossChargeInterrupted = true;
      next.bossCharging = false;
      next.renqing += next.bossChargeRefundRenqing;
      const reducedDamage = next.bossInterruptedNextDamage ?? 3;
      const nextRoundIdx = next.demonActions.findIndex((a) => a.round === next.round + 1);
      if (nextRoundIdx >= 0) {
        next.demonActions[nextRoundIdx] = {
          ...next.demonActions[nextRoundIdx],
          damage: reducedDamage,
          skill: `${next.bossChargeSkill ?? '封门'}(破)`,
        };
      }
      const skillName = next.bossChargeSkill ?? '封门';
      next.log.push(
        `R${next.round}:打断「${skillName}」(累伤${next.bossChargeDamage}/${next.bossChargeThreshold})返还+${next.bossChargeRefundRenqing}人情`,
      );
      events.push({
        type: 'BOSS_CHARGE_INTERRUPTED',
        round: next.round,
        skill: skillName,
        damageDealt: next.bossChargeDamage,
        threshold: next.bossChargeThreshold,
        refundRenqing: next.bossChargeRefundRenqing,
        renqingAfter: next.renqing,
        reducedNextDamage: reducedDamage,
      });
    }
  }
}

/**
 * EffectRunner with structured BattleEvent output.
 * Does not mutate the input state.
 */
export function applyEffectWithEvents(
  state: BattleState,
  effect: CardEffect,
  ctx: EffectContext,
  sourceName = 'effect',
): BattleActionResult {
  const next = cloneBattleState(state);
  const events: BattleEvent[] = [];

  switch (effect.type) {
    case 'damage': {
      const amount = effect.value ?? 0;
      applyDamageToDemon(next, amount, sourceName, events);
      return { state: next, events };
    }

    case 'damage_conditional': {
      const base = effect.value ?? 0;
      const bonus = effect.bonus ?? 0;
      let met: boolean;
      switch (effect.condition) {
        case 'has_item_card_in_hand':
          met = hasItemCardInHand(next.hand);
          break;
        case 'enemy_hp_le':
          met = next.demonHp <= (effect.threshold ?? 0);
          break;
        default:
          met = next.demonHasActed;
      }
      const amount = met ? base + bonus : base;
      applyDamageToDemon(next, amount, sourceName, events);
      return { state: next, events };
    }

    case 'shield_conditional': {
      const met = effect.condition === 'has_shield' && next.shield > 0;
      const amount = (effect.value ?? 0) + (met ? (effect.bonus ?? 0) : 0);
      next.shield += amount;
      events.push({
        type: 'SHIELD_GAINED',
        amount,
        shieldAfter: next.shield,
        source: sourceName,
      });
      return { state: next, events };
    }

    case 'draw_conditional': {
      const met = effect.condition === 'has_item_card_in_hand' && hasItemCardInHand(next.hand);
      const count = (effect.value ?? 0) + (met ? (effect.bonus ?? 0) : 0);
      return drawCardsWithEvents(next, count, ctx);
    }

    case 'shield': {
      const amount = effect.value ?? 0;
      next.shield += amount;
      events.push({
        type: 'SHIELD_GAINED',
        amount,
        shieldAfter: next.shield,
        source: sourceName,
      });
      return { state: next, events };
    }

    case 'draw': {
      const count = effect.value ?? 0;
      return drawCardsWithEvents(next, count, ctx);
    }

    case 'heal': {
      const amount = effect.value ?? 0;
      const before = next.playerHp;
      next.playerHp = Math.min(next.maxPlayerHp, next.playerHp + amount);
      events.push({
        type: 'HEAL_APPLIED',
        amount: next.playerHp - before,
        playerHpAfter: next.playerHp,
      });
      return { state: next, events };
    }

    case 'renqing': {
      const amount = effect.value ?? 0;
      next.renqing += amount;
      events.push({
        type: 'RENQING_GAINED',
        amount,
        renqingAfter: next.renqing,
        source: sourceName,
      });
      return { state: next, events };
    }

    case 'renqing_next': {
      const amount = effect.value ?? 0;
      next.nextRoundRenqingBonus += amount;
      return { state: next, events };
    }

    case 'rewind': {
      if (next.roundSnapshots.length === 0) {
        return { state: next, events };
      }
      const targetIndex = Math.min(
        Math.max(0, next.round - 2),
        next.roundSnapshots.length - 1,
      );
      const snapshot = next.roundSnapshots[targetIndex];
      const playerHpBefore = next.playerHp;
      const demonHpBefore = next.demonHp;
      next.playerHp = snapshot.playerHp;
      next.demonHp = snapshot.demonHp;
      events.push({
        type: 'REWIND_APPLIED',
        playerHpBefore,
        playerHpAfter: next.playerHp,
        demonHpBefore,
        demonHpAfter: next.demonHp,
      });
      return { state: next, events };
    }

    case 'illuminate': {
      next.illuminateNextDraw = true;
      return { state: next, events };
    }

    case 'reflect': {
      next.reflectNextDamage = true;
      return { state: next, events };
    }

    case 'reveal': {
      next.revealedNextIntent = true;
      return { state: next, events };
    }

    case 'discard_for_renqing': {
      if (next.hand.length === 0) {
        return { state: next, events };
      }
      const choice: PendingChoice = {
        kind: 'discard',
        sourceCardName: sourceName,
        prompt: '选1张手牌弃掉',
        count: 1,
        then: [{ type: 'renqing', value: effect.value ?? 0 }],
      };
      next.pendingChoice = choice;
      events.push({ type: 'CHOICE_REQUIRED', choice: clonePendingChoice(choice)! });
      return { state: next, events };
    }
  }
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
  return applyEffectWithEvents(state, effect, ctx).state;
}
