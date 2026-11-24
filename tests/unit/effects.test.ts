import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import {
  applyEffect,
  buildCardMap,
  canPlayCard,
  createBattle,
  endTurn,
  getIntent,
  playCard,
  type BattleBalanceConfig,
  type BattleState,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
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
const CARDS_BY_NAME = buildCardMap(CARDS);

function makeState(overrides: Partial<BattleState> = {}): BattleState {
  const rng = mulberry32(42);
  const base = createBattle(['钢笔', '守诺', '旧书', '算盘', '暖水瓶'], 'a', rng, CARDS, DEMONS, BALANCE);
  return {
    ...base,
    ...overrides,
  };
}

describe('cards.json integrity', () => {
  it('contains all 23 unique cards including P1 & P4 item cards', () => {
    expect(CARDS).toHaveLength(23);
    const ids = new Set(CARDS.map((c) => c.id));
    const names = new Set(CARDS.map((c) => c.name));
    expect(ids.size).toBe(23);
    expect(names.size).toBe(23);
    expect(names.has('倒转')).toBe(true);
    expect(names.has('守诺')).toBe(true);
    expect(names.has('旧书')).toBe(true);
    expect(names.has('飞驰')).toBe(true);
    expect(names.has('余音')).toBe(true);
    expect(names.has('集邮')).toBe(true);
    expect(CARDS.filter((c) => c.cost === 0).map((c) => c.name)).toEqual(['拨浪鼓', '当票']);
  });
});

describe('EffectRunner (applyEffect)', () => {
  it('damage reduces demonHp immutably and clamps at 0', () => {
    const initial = makeState({ demonHp: 10 });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const after4 = applyEffect(initial, { type: 'damage', value: 4 }, ctx);
    expect(after4.demonHp).toBe(6);
    expect(initial.demonHp).toBe(10);

    const overkill = applyEffect(after4, { type: 'damage', value: 12 }, ctx);
    expect(overkill.demonHp).toBe(0);
  });

  it('shield adds shield points', () => {
    const initial = makeState({ shield: 2 });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const next = applyEffect(initial, { type: 'shield', value: 5 }, ctx);
    expect(next.shield).toBe(7);
    expect(initial.shield).toBe(2);
  });

  it('draw pulls cards from drawPile into hand and reshuffles discardPile if needed', () => {
    const initial = makeState({
      hand: ['钢笔'],
      drawPile: ['守诺'],
      discardPile: ['旧书', '秤砣'],
    });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(99) };

    const next = applyEffect(initial, { type: 'draw', value: 2 }, ctx);
    expect(next.hand).toHaveLength(3);
    expect(next.hand[1]).toBe('守诺');
    expect(['旧书', '秤砣']).toContain(next.hand[2]);
    expect(next.discardPile).toHaveLength(0);
    expect(next.drawPile).toHaveLength(1);
    expect(initial.hand).toEqual(['钢笔']);
  });

  it('heal restores playerHp up to maxPlayerHp', () => {
    const initial = makeState({ playerHp: 22, maxPlayerHp: 30 });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const healed = applyEffect(initial, { type: 'heal', value: 6 }, ctx);
    expect(healed.playerHp).toBe(28);

    const capped = applyEffect(healed, { type: 'heal', value: 6 }, ctx);
    expect(capped.playerHp).toBe(30);
  });

  it('renqing grants immediate action points in current turn', () => {
    const initial = makeState({ renqing: 2, maxRenqing: 3 });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const next = applyEffect(initial, { type: 'renqing', value: 2 }, ctx);
    expect(next.renqing).toBe(4);
  });

  it('renqing_next accumulates bonus renqing for the next round', () => {
    const initial = makeState({ nextRoundRenqingBonus: 0 });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const next = applyEffect(initial, { type: 'renqing_next', value: 1 }, ctx);
    expect(next.nextRoundRenqingBonus).toBe(1);
  });

  it('rewind restores playerHp and demonHp to previous round start snapshot without rolling back renqing, hand, or shield', () => {
    const initial = makeState({
      round: 2,
      playerHp: 24,
      demonHp: 12,
      shield: 5,
      renqing: 1,
      hand: ['钢笔', '旧书'],
      roundSnapshots: [
        { playerHp: 30, demonHp: 20 },
        { playerHp: 27, demonHp: 16 },
      ],
    });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const rewound = applyEffect(initial, { type: 'rewind' }, ctx);
    expect(rewound.playerHp).toBe(30);
    expect(rewound.demonHp).toBe(20);
    // 人情、手牌、护盾均不回溯
    expect(rewound.renqing).toBe(1);
    expect(rewound.hand).toEqual(['钢笔', '旧书']);
    expect(rewound.shield).toBe(5);
  });

  it('reflect bounces the next incoming demon damage back to demon and clears after one trigger', () => {
    const initial = makeState({
      round: 1,
      playerHp: 30,
      shield: 0,
      demonHp: 20,
      hand: ['铜镜'],
      renqing: 3,
      drawPile: ['守诺', '旧书', '钢笔', '秤砣'],
    });

    const afterPlay = playCard(initial, 0);
    expect(afterPlay.reflectNextDamage).toBe(true);

    const afterR1 = endTurn(afterPlay);
    // 心魔 A 第 1 回合 3 伤反弹给心魔
    expect(afterR1.playerHp).toBe(30);
    expect(afterR1.demonHp).toBe(17);
    expect(afterR1.reflectNextDamage).toBe(false);

    // 第 2 回合不再反弹
    const afterR2 = endTurn(afterR1);
    expect(afterR2.playerHp).toBe(27);
    expect(afterR2.demonHp).toBe(17);
  });

  it('illuminate brings the first attack card to top of drawPile on next draw and clears after one use', () => {
    const initial = makeState({
      hand: [],
      drawPile: ['守诺', '旧书', '秤砣', '暖水瓶'],
      illuminateNextDraw: false,
    });
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    const illuminated = applyEffect(initial, { type: 'illuminate' }, ctx);
    expect(illuminated.illuminateNextDraw).toBe(true);

    const afterFirstDraw = applyEffect(illuminated, { type: 'draw', value: 1 }, ctx);
    expect(afterFirstDraw.hand).toEqual(['秤砣']);
    expect(afterFirstDraw.illuminateNextDraw).toBe(false);
    expect(afterFirstDraw.drawPile).toEqual(['守诺', '旧书', '暖水瓶']);

    // 无攻击牌时正常抽牌并清除标志
    const noAttackState = makeState({
      hand: [],
      drawPile: ['守诺', '旧书'],
      illuminateNextDraw: true,
    });
    const normalDraw = applyEffect(noAttackState, { type: 'draw', value: 1 }, ctx);
    expect(normalDraw.hand).toEqual(['守诺']);
    expect(normalDraw.illuminateNextDraw).toBe(false);
  });

  it('reveal sets revealedNextIntent and exposes next round action via getIntent', () => {
    const initial = makeState({ round: 1, revealedNextIntent: false });
    expect(getIntent(initial).next).toBeNull();

    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };
    const revealed = applyEffect(initial, { type: 'reveal' }, ctx);
    expect(revealed.revealedNextIntent).toBe(true);
    expect(getIntent(revealed).next).toEqual({ round: 2, damage: 3 });
  });

  it('damage_conditional (铁皮青蛙) deals base 3 when demon has not acted and 6 when demon has acted in a prior round', () => {
    const ctx = { cardsByName: CARDS_BY_NAME, rng: mulberry32(1) };

    // 心魔尚未行动
    const beforeAct = makeState({ demonHp: 20, demonHasActed: false });
    const dmgBefore = applyEffect(beforeAct, { type: 'damage_conditional', value: 3, bonus: 3 }, ctx);
    expect(dmgBefore.demonHp).toBe(17);

    // 此前回合已行动
    const afterAct = makeState({ demonHp: 20, demonHasActed: true });
    const dmgAfter = applyEffect(afterAct, { type: 'damage_conditional', value: 3, bonus: 3 }, ctx);
    expect(dmgAfter.demonHp).toBe(14);
  });

  it('discard_for_renqing (当票) discards leftmost non-self card for +2 renqing and is unplayable when alone in hand', () => {
    // 只有当票本身：不可打出
    const solo = makeState({ hand: ['当票'], renqing: 1, discardPile: [] });
    expect(canPlayCard(solo, 0)).toBe(false);
    const soloAttempt = playCard(solo, 0);
    expect(soloAttempt.hand).toEqual(['当票']);
    expect(soloAttempt.renqing).toBe(1);

    // 当票在最左：弃掉剩余手牌最左一张（钢笔），两张均进弃牌堆，人情 +2
    const atLeft = makeState({ hand: ['当票', '钢笔', '旧书'], renqing: 1, discardPile: [] });
    expect(canPlayCard(atLeft, 0)).toBe(true);
    const afterLeft = playCard(atLeft, 0);
    expect(afterLeft.hand).toEqual(['旧书']);
    expect(afterLeft.discardPile).toEqual(['钢笔', '当票']);
    expect(afterLeft.renqing).toBe(3);

    // 当票在中间：弃掉最左的守诺
    const inMiddle = makeState({ hand: ['守诺', '当票', '旧书'], renqing: 2, discardPile: [] });
    const afterMiddle = playCard(inMiddle, 1);
    expect(afterMiddle.hand).toEqual(['旧书']);
    expect(afterMiddle.discardPile).toEqual(['守诺', '当票']);
    expect(afterMiddle.renqing).toBe(4);
  });
});
