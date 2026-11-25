import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import {
  createBattle,
  endTurn,
  playCard,
  resolvePendingChoice,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import {
  BATTLE_HOOK_NAMES,
  createHookRegistry,
  MAX_HOOK_DEPTH,
  type BattleHookName,
} from '../../src/game/hooks';
import { mulberry32 } from '../../src/utils/rng';

const CARDS = cardsJson as CardDef[];
const DEMONS = demonsJson as DemonDef[];
const BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

describe('Battle HookRegistry (src/game/hooks.ts)', () => {
  it('supports registration, unregistration, and triggers all 7 lifecycle hooks cleanly', () => {
    const registry = createHookRegistry();
    const fired: BattleHookName[] = [];

    const unsubs = BATTLE_HOOK_NAMES.map((name) =>
      registry.register(name, (state) => {
        fired.push(name);
        return state;
      }),
    );
    expect(registry.getHandlerCount()).toBe(7);

    // 1. battleStart + turnStart
    let state = createBattle(
      ['当票', '铜镜', '秤砣', '钢笔', '守诺'],
      'a',
      mulberry32(7),
      CARDS,
      DEMONS,
      BALANCE,
      registry,
    );
    expect(fired).toEqual(['battleStart', 'turnStart']);

    // 2. Play 当票 + choose discard -> triggers onDiscard & cardPlayed
    const ticketIdx = state.hand.indexOf('当票');
    state = playCard(state, ticketIdx).state;
    expect(state.pendingChoice).not.toBeNull();
    const discardIdx = state.hand.indexOf('守诺');
    state = resolvePendingChoice(state, discardIdx).state;
    expect(fired).toContain('onDiscard');
    expect(fired).toContain('cardPlayed');

    // 3. Play 铜镜 + endTurn -> triggers turnEnd, onReflect, and next turnStart
    const mirrorIdx = state.hand.indexOf('铜镜');
    state = playCard(state, mirrorIdx).state;
    state = endTurn(state).state;
    expect(fired).toContain('turnEnd');
    expect(fired).toContain('onReflect');

    // 4. Kill demon -> triggers battleWon
    const lowHpState = { ...state, demonHp: 4, renqing: 3, hand: ['钢笔'] };
    const winRes = playCard(lowHpState, 0);
    expect(winRes.state.result).toBe('win');
    expect(fired).toContain('battleWon');

    // Unregistering stops further callbacks
    unsubs.forEach((unsub) => unsub());
    expect(registry.getHandlerCount()).toBe(0);
  });

  it('circuit-breaks recursive hook loops at MAX_HOOK_DEPTH = 32 and records overflow logs', () => {
    expect(MAX_HOOK_DEPTH).toBe(32);

    const registry = createHookRegistry();
    let invocations = 0;

    registry.register('cardPlayed', (state, ctx) => {
      invocations += 1;
      const nested = ctx.emit('cardPlayed', state, ctx.payload);
      return { state: nested.state };
    });

    const baseState = createBattle(
      ['钢笔', '守诺', '旧书', '算盘', '秤砣'],
      'a',
      mulberry32(1),
      CARDS,
      DEMONS,
      BALANCE,
    );

    const result = registry.emit('cardPlayed', baseState, { cardName: '钢笔' });
    expect(result.circuitBroken).toBe(true);
    expect(invocations).toBe(MAX_HOOK_DEPTH);
    expect(registry.getOverflowLogs().length).toBeGreaterThanOrEqual(1);
    expect(registry.getOverflowLogs()[0].maxDepth).toBe(MAX_HOOK_DEPTH);
    expect(result.state.log.some((entry) => entry.includes('HOOK_CIRCUIT_BREAK'))).toBe(true);
  });
});
