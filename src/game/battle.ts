import type { RngFn } from '../utils/rng';
import {
  applyEffect,
  applyEffectWithEvents,
  cloneBattleState,
  clonePendingChoice,
  drawCardsWithEvents,
  isAttackCard,
  shuffleArray,
  type BattleActionResult,
  type BattleBalanceConfig,
  type BattleEvent,
  type BattlePhase,
  type BattleResult,
  type BattleState,
  type CardDef,
  type CardEffect,
  type CardEffectType,
  type DemonAction,
  type DemonChargeConfig,
  type DemonDef,
  type EffectContext,
  type PendingChoice,
  type RoundSnapshot,
} from './effects';
import type { ChapterSaveState } from './chapters';
import type { HookRegistry } from './hooks';

export type {
  BattleActionResult,
  BattleBalanceConfig,
  BattleEvent,
  BattlePhase,
  BattleResult,
  BattleState,
  CardDef,
  CardEffect,
  CardEffectType,
  DemonAction,
  DemonChargeConfig,
  DemonDef,
  EffectContext,
  PendingChoice,
  RoundSnapshot,
};
export { applyEffect, applyEffectWithEvents, isAttackCard, shuffleArray };

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
  maxRounds?: number;
  playerHp: number;
  shield: number;
  renqing: number;
  maxRenqing?: number;
  demonHp: number;
  demonMaxHp?: number;
  demonShield?: number;
  isBoss?: boolean;
  bossCharging?: boolean;
  bossChargeDamage?: number;
  bossChargeThreshold?: number;
  bossChargeInterrupted?: boolean;
  detailMode?: 'effect' | 'story';
  hand: string[];
  deckCount: number;
  discardCount: number;
  pendingChoice?: PendingChoice | null;
  result: BattleResult | 'empty_deck';
  resultView?: 'normal' | 'diary' | 'ending' | 'chapter_failed';
  demonId: string;
  demonName: string;
  demonIntroLine?: string;
  victoryLine?: string | null;
  intent: IntentInfo;
  isAnimating?: boolean;
  queuedCount?: number;
  reward?: WinReward | null;
  loseReason?: string | null;
  day?: number;
  shopLevel?: number;
  savedData?: {
    version: 1 | 2 | 3;
    day: number;
    money: number;
    reputation: number;
    deck: string[];
    shopLevel: number;
    redeemTickets: number;
    tutorialCompleted?: boolean;
    chapter?: ChapterSaveState;
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

export interface CreateBattleOptions {
  demonHpBonus?: number;
}

function activateRoundChargeIfAny(state: BattleState, events: BattleEvent[]): void {
  const action = state.demonActions.find((a) => a.round === state.round);
  if (!action?.charge) {
    return;
  }
  const shieldGain = action.shield ?? 0;
  const skill = action.skill ?? '封门';
  state.demonShield = shieldGain;
  state.bossCharging = true;
  state.bossChargeSkill = skill;
  state.bossChargeDamage = 0;
  state.bossChargeThreshold = action.charge.threshold;
  state.bossChargeRefundRenqing = action.charge.refundRenqing;
  state.bossChargeInterrupted = false;
  state.bossInterruptedNextDamage = action.charge.interruptedNextDamage;
  state.bossChargeRound = state.round;
  state.log.push(
    `R${state.round}:蓄力「${skill}」获${shieldGain}盾(累计>=${action.charge.threshold}伤打断)`,
  );
  events.push({
    type: 'BOSS_CHARGE_STARTED',
    round: state.round,
    skill,
    shieldGained: shieldGain,
    threshold: action.charge.threshold,
    refundRenqing: action.charge.refundRenqing,
  });
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
  hooks?: HookRegistry,
  options?: CreateBattleOptions,
): BattleState {
  const demon = demons.find((d) => d.id === demonId) ?? demons[0];
  if (!demon) {
    throw new Error(`Demon not found: ${demonId}`);
  }

  const cardsByName = buildCardMap(cards);
  const shuffledDeck = shuffleArray(deckCardNames, rng);
  const maxRounds = demon.actions.length;
  const effectiveDemonHp = Math.max(1, demon.hp + (options?.demonHpBonus ?? 0));

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
    isBoss: Boolean(demon.isBoss),
    demonIntroLine: demon.introLine ?? '',
    demonVictoryLine: demon.victoryLine ?? '',
    demonHp: effectiveDemonHp,
    demonMaxHp: effectiveDemonHp,
    demonShield: 0,
    demonActions: demon.actions.map((a) => ({
      ...a,
      ...(a.charge ? { charge: { ...a.charge } } : {}),
    })),
    demonHasActed: false,
    bossCharging: false,
    bossChargeSkill: null,
    bossChargeDamage: 0,
    bossChargeThreshold: 0,
    bossChargeRefundRenqing: 0,
    bossChargeInterrupted: false,
    bossInterruptedNextDamage: null,
    bossChargeRound: null,
    hand: [],
    drawPile: shuffledDeck,
    discardPile: [],
    illuminateNextDraw: false,
    reflectNextDamage: false,
    revealedNextIntent: false,
    roundSnapshots: [{ playerHp: balance.startingHp, demonHp: effectiveDemonHp }],
    pendingChoice: null,
    result: 'ongoing',
    log: [],
    cardsByName,
    balance: { ...balance },
    rng,
    ...(hooks ? { hooks } : {}),
  };

  let state = drawCardsWithEvents(initialDrawPhase, balance.drawFirst, {
    cardsByName,
    rng,
  }).state;
  state = {
    ...state,
    phase: 'play',
  };

  activateRoundChargeIfAny(state, []);

  if (hooks) {
    state = hooks.emit('battleStart', state, { round: state.round }).state;
    state = hooks.emit('turnStart', state, { round: state.round }).state;
  }

  return state;
}

/**
 * Returns whether the card at `handIndex` can currently be played.
 */
export function canPlayCard(state: BattleState, handIndex: number): boolean {
  if (state.phase !== 'play' || state.result !== 'ongoing' || state.pendingChoice !== null) {
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

function finalizeWinIfDead(state: BattleState, events: BattleEvent[]): BattleState {
  if (state.demonHp > 0 || state.result !== 'ongoing') {
    return state;
  }
  let current = cloneBattleState(state);
  current.demonHp = 0;
  current.phase = 'result';
  current.result = 'win';
  current.pendingChoice = null;
  events.push({ type: 'BATTLE_ENDED', result: 'win', round: current.round });
  if (current.hooks) {
    const wonHook = current.hooks.emit('battleWon', current, {
      round: current.round,
      result: 'win',
    });
    current = wonHook.state;
    events.push(...wonHook.events);
  }
  return current;
}

/**
 * Plays the card at `handIndex`, applying its effects sequentially and returning { state, events }.
 * Pauses into `state.pendingChoice` if an effect requires player hand selection (e.g., 当票).
 * Pure & immutable: returns unchanged clone with empty events if the play is illegal.
 */
export function playCard(state: BattleState, handIndex: number): BattleActionResult {
  if (!canPlayCard(state, handIndex)) {
    return { state: cloneBattleState(state), events: [] };
  }

  const cardName = state.hand[handIndex];
  const card = state.cardsByName.get(cardName);
  if (!card) {
    return { state: cloneBattleState(state), events: [] };
  }

  let current = cloneBattleState(state);
  const events: BattleEvent[] = [];

  current.renqing -= card.cost;
  current.hand.splice(handIndex, 1);
  current.log.push(`R${current.round}:打出${cardName}(费${card.cost})`);
  events.push({ type: 'CARD_PLAYED', cardName, cost: card.cost, round: current.round });

  const ctx: EffectContext = {
    cardsByName: current.cardsByName,
    rng: current.rng,
  };

  for (let i = 0; i < card.effects.length; i += 1) {
    const effect = card.effects[i];
    if (effect.type === 'discard_for_renqing') {
      if (current.hand.length === 0) {
        continue;
      }
      current.discardPile.push(cardName);
      const remaining = card.effects.slice(i + 1).map((e) => ({ ...e }));
      const choice: PendingChoice = {
        kind: 'discard',
        sourceCardName: cardName,
        prompt: '选1张手牌弃掉',
        count: 1,
        then: [{ type: 'renqing', value: effect.value ?? 0 }, ...remaining],
        returnToHandOnCancel: {
          cardName,
          cost: card.cost,
        },
      };
      current.pendingChoice = choice;
      events.push({ type: 'CHOICE_REQUIRED', choice: clonePendingChoice(choice)! });
      return { state: current, events };
    }

    const res = applyEffectWithEvents(current, effect, ctx, cardName);
    current = res.state;
    events.push(...res.events);
  }

  current.discardPile.push(cardName);

  if (current.hooks) {
    const hookRes = current.hooks.emit('cardPlayed', current, {
      card,
      cardName,
      round: current.round,
    });
    current = hookRes.state;
    events.push(...hookRes.events);
  }

  current = finalizeWinIfDead(current, events);

  return { state: current, events };
}

/**
 * Resolves an active `pendingChoice` (e.g., choosing which hand card to discard for 当票),
 * then resumes all queued `then` effects. Pure & immutable.
 */
export function resolvePendingChoice(state: BattleState, handIndex: number): BattleActionResult {
  const choice = state.pendingChoice;
  if (
    !choice ||
    state.phase !== 'play' ||
    state.result !== 'ongoing' ||
    handIndex < 0 ||
    handIndex >= state.hand.length
  ) {
    return { state: cloneBattleState(state), events: [] };
  }

  let current = cloneBattleState(state);
  const events: BattleEvent[] = [];

  const [discarded] = current.hand.splice(handIndex, 1);
  current.discardPile.push(discarded);
  current.pendingChoice = null;
  current.log.push(`R${current.round}:弃置${discarded}`);
  events.push({ type: 'CARD_DISCARDED', cardName: discarded, handIndex });

  if (current.hooks) {
    const discardHook = current.hooks.emit('onDiscard', current, {
      discardedCard: discarded,
      cardName: choice.sourceCardName,
      round: current.round,
    });
    current = discardHook.state;
    events.push(...discardHook.events);
  }

  const ctx: EffectContext = {
    cardsByName: current.cardsByName,
    rng: current.rng,
  };

  for (const effect of choice.then) {
    const res = applyEffectWithEvents(current, effect, ctx, choice.sourceCardName);
    current = res.state;
    events.push(...res.events);
  }

  const sourceCard = current.cardsByName.get(choice.sourceCardName);
  if (current.hooks && sourceCard) {
    const playedHook = current.hooks.emit('cardPlayed', current, {
      card: sourceCard,
      cardName: sourceCard.name,
      round: current.round,
    });
    current = playedHook.state;
    events.push(...playedHook.events);
  }

  current = finalizeWinIfDead(current, events);

  return { state: current, events };
}

/**
 * Cancels an active `pendingChoice`, returning the source card to hand and refunding its cost
 * when `returnToHandOnCancel` is set. Pure & immutable.
 */
export function cancelPendingChoice(state: BattleState): BattleActionResult {
  const choice = state.pendingChoice;
  if (!choice) {
    return { state: cloneBattleState(state), events: [] };
  }

  const current = cloneBattleState(state);
  current.pendingChoice = null;

  if (choice.returnToHandOnCancel) {
    const { cardName, cost } = choice.returnToHandOnCancel;
    const discardIdx = current.discardPile.lastIndexOf(cardName);
    if (discardIdx >= 0) {
      current.discardPile.splice(discardIdx, 1);
    }
    current.hand.push(cardName);
    current.renqing += cost;
    current.log.push(`R${current.round}:取消${cardName}`);
  }

  return { state: current, events: [] };
}

/**
 * Ends the player's turn: transitions play -> demonAct -> roundEnd -> (next round draw -> play | result).
 * Pure & immutable, returning { state, events }.
 */
export function endTurn(state: BattleState): BattleActionResult {
  if (state.phase !== 'play' || state.result !== 'ongoing' || state.pendingChoice !== null) {
    return { state: cloneBattleState(state), events: [] };
  }

  let current = cloneBattleState(state);
  const events: BattleEvent[] = [];

  if (current.hooks) {
    const turnEndHook = current.hooks.emit('turnEnd', current, { round: current.round });
    current = turnEndHook.state;
    events.push(...turnEndHook.events);
  }

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
      events.push({
        type: 'DEMON_ACT',
        round: current.round,
        ...(action?.skill ? { skill: action.skill } : {}),
        rawDamage: incomingDamage,
        absorbed: 0,
        hpDamage: 0,
        reflected: true,
      });
      events.push({
        type: 'REFLECT_TRIGGERED',
        damage: incomingDamage,
        demonHpAfter: current.demonHp,
      });
      if (current.hooks) {
        const reflectHook = current.hooks.emit('onReflect', current, {
          reflectedDamage: incomingDamage,
          round: current.round,
        });
        current = reflectHook.state;
        events.push(...reflectHook.events);
      }
      if (current.demonHp <= 0) {
        current = finalizeWinIfDead(current, events);
        return { state: current, events };
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
      events.push({
        type: 'DEMON_ACT',
        round: current.round,
        ...(action?.skill ? { skill: action.skill } : {}),
        rawDamage: incomingDamage,
        absorbed,
        hpDamage,
        reflected: false,
      });
      if (hpDamage > 0) {
        events.push({
          type: 'DAMAGE_DEALT',
          target: 'player',
          amount: hpDamage,
          source: current.demonName,
          playerHpAfter: current.playerHp,
        });
      }
      if (current.playerHp <= 0) {
        current.phase = 'result';
        current.result = 'lose_hp';
        events.push({ type: 'BATTLE_ENDED', result: 'lose_hp', round: current.round });
        return { state: current, events };
      }
    }
  } else {
    events.push({
      type: 'DEMON_ACT',
      round: current.round,
      ...(action?.skill ? { skill: action.skill } : {}),
      rawDamage: 0,
      absorbed: 0,
      hpDamage: 0,
      reflected: false,
    });
  }

  // 2. roundEnd phase
  current.phase = 'roundEnd';
  if (current.round >= current.maxRounds) {
    current.phase = 'result';
    current.result = 'lose_timeout';
    events.push({ type: 'BATTLE_ENDED', result: 'lose_timeout', round: current.round });
    return { state: current, events };
  }

  // 3. Advance to next round: reset shields/charging, refill renqing (+ next bonus), save snapshot, draw
  current.round += 1;
  current.shield = 0;
  current.demonShield = 0;
  current.bossCharging = false;
  current.renqing = current.maxRenqing + current.nextRoundRenqingBonus;
  current.nextRoundRenqingBonus = 0;
  current.roundSnapshots.push({
    playerHp: current.playerHp,
    demonHp: current.demonHp,
  });

  current.phase = 'draw';
  const drawRes = drawCardsWithEvents(current, current.balance.drawPerRound, {
    cardsByName: current.cardsByName,
    rng: current.rng,
  });
  current = drawRes.state;
  events.push(...drawRes.events);
  current.phase = 'play';
  events.push({ type: 'TURN_STARTED', round: current.round, renqing: current.renqing });

  activateRoundChargeIfAny(current, events);

  if (current.hooks) {
    const turnStartHook = current.hooks.emit('turnStart', current, { round: current.round });
    current = turnStartHook.state;
    events.push(...turnStartHook.events);
  }

  return { state: current, events };
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
    maxRounds: state.maxRounds,
    playerHp: state.playerHp,
    shield: state.shield,
    renqing: state.renqing,
    maxRenqing: state.maxRenqing,
    demonHp: state.demonHp,
    demonMaxHp: state.demonMaxHp,
    demonShield: state.demonShield,
    isBoss: state.isBoss,
    bossCharging: state.bossCharging,
    bossChargeDamage: state.bossChargeDamage,
    bossChargeThreshold: state.bossChargeThreshold,
    bossChargeInterrupted: state.bossChargeInterrupted,
    hand: [...state.hand],
    deckCount: state.drawPile.length,
    discardCount: state.discardPile.length,
    pendingChoice: clonePendingChoice(state.pendingChoice),
    result: state.result,
    demonId: state.demonId,
    demonName: state.demonName,
    demonIntroLine: state.demonIntroLine,
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
        return '回上回';
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

/**
 * Generates a clear single-line Chinese effect description from card effects (P6 C1).
 */
export function formatEffectDescription(card: CardDef): string {
  const parts = card.effects.map((e) => {
    switch (e.type) {
      case 'damage':
        return `造成${e.value ?? 0}点伤害`;
      case 'damage_conditional':
        return `造成${e.value ?? 0}点伤害，心魔行动过后改为${(e.value ?? 0) + (e.bonus ?? 0)}点`;
      case 'shield':
        return `获得${e.value ?? 0}点护盾`;
      case 'draw':
        return `抽${e.value ?? 0}张牌`;
      case 'heal':
        return `恢复${e.value ?? 0}点生命`;
      case 'renqing':
        return `获得${e.value ?? 0}点人情`;
      case 'renqing_next':
        return `下回合人情+${e.value ?? 0}`;
      case 'rewind':
        return '敌我双方回到上一回合开始时的状态';
      case 'illuminate':
        return '下次抽牌必为攻击牌';
      case 'reflect':
        return '反弹下一次受到的伤害';
      case 'reveal':
        return '查看心魔下回合意图';
      case 'discard_for_renqing':
        return `选弃1张牌，获得${e.value ?? 0}点人情`;
    }
  });
  return parts.join('，');
}
