import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import {
  createBattle,
  endTurn,
  formatEffectDescription,
  getIntent,
  playCard,
  resolveWinReward,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import { TEST_DECK } from '../../src/game/montecarlo';
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

describe('Battle state machine & BattleEvent stream', () => {
  it('draws 5 cards in R1 and 2 cards in R2/R3 from balance.json', () => {
    const rng = mulberry32(1);
    let state = createBattle(TEST_DECK, 'a', rng, CARDS, DEMONS, BALANCE);

    expect(state.phase).toBe('play');
    expect(state.round).toBe(1);
    expect(state.hand).toHaveLength(5);
    expect(state.drawPile).toHaveLength(5);
    expect(state.playerHp).toBe(30);
    expect(state.renqing).toBe(3);
    expect(state.demonHp).toBe(20);

    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.phase).toBe('play');
    expect(state.hand).toHaveLength(7);
    expect(state.drawPile).toHaveLength(3);

    state = endTurn(state).state;
    expect(state.round).toBe(3);
    expect(state.hand).toHaveLength(9);
    expect(state.drawPile).toHaveLength(1);
  });

  it('rejects card play when renqing is insufficient without mutating state or emitting events', () => {
    const rng = mulberry32(7);
    const state = createBattle(['倒转', '钢笔', '守诺', '旧书', '秤砣'], 'a', rng, CARDS, DEMONS, BALANCE);
    const lowRenqing = { ...state, renqing: 1 };
    const rewindIdx = lowRenqing.hand.indexOf('倒转');
    expect(rewindIdx).toBeGreaterThanOrEqual(0);

    const { state: attempted, events } = playCard(lowRenqing, rewindIdx);
    expect(events).toEqual([]);
    expect(attempted.renqing).toBe(1);
    expect(attempted.hand).toEqual(lowRenqing.hand);
    expect(attempted.discardPile).toEqual([]);
  });

  it('reshuffles discardPile into drawPile when drawPile is exhausted', () => {
    const rng = mulberry32(11);
    let state = createBattle(['钢笔', '秤砣', '守诺', '旧书', '暖水瓶'], 'a', rng, CARDS, DEMONS, BALANCE);
    expect(state.drawPile).toHaveLength(0);

    state = playCard(state, state.hand.indexOf('钢笔')).state;
    state = playCard(state, state.hand.indexOf('秤砣')).state;
    state = playCard(state, state.hand.indexOf('守诺')).state;
    expect(state.discardPile).toHaveLength(3);

    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.hand).toHaveLength(4);
    expect(state.drawPile).toHaveLength(1);
    expect(state.discardPile).toHaveLength(0);
  });

  it('absorbs demon damage with shield first, clears shield next round, and applies renqing_next', () => {
    const rng = mulberry32(3);
    let state = createBattle(['守诺', '手电', '暖水瓶', '钢笔', '秤砣'], 'a', rng, CARDS, DEMONS, BALANCE);

    const shieldRes = playCard(state, state.hand.indexOf('暖水瓶'));
    state = shieldRes.state;
    expect(shieldRes.events).toContainEqual({
      type: 'SHIELD_GAINED',
      amount: 4,
      shieldAfter: 4,
      source: '暖水瓶',
    });

    state = playCard(state, state.hand.indexOf('手电')).state;
    expect(state.shield).toBe(4);
    expect(state.nextRoundRenqingBonus).toBe(1);

    const turnRes = endTurn(state);
    state = turnRes.state;
    expect(turnRes.events).toContainEqual({
      type: 'DEMON_ACT',
      round: 1,
      rawDamage: 3,
      absorbed: 3,
      hpDamage: 0,
      reflected: false,
    });
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(30);
    expect(state.shield).toBe(0);
    expect(state.renqing).toBe(4);
    expect(state.nextRoundRenqingBonus).toBe(0);
  });

  it('wins immediately when card damage reduces demonHp to 0 and emits CARD_PLAYED + DAMAGE_DEALT + BATTLE_ENDED', () => {
    const rng = mulberry32(5);
    const state = createBattle(['秤砣', '钢笔', '相机', '守诺', '旧书'], 'a', rng, CARDS, DEMONS, BALANCE);
    const nearDeath = { ...state, demonHp: 5 };
    const weightIdx = nearDeath.hand.indexOf('秤砣');

    const { state: afterKill, events } = playCard(nearDeath, weightIdx);
    expect(afterKill.demonHp).toBe(0);
    expect(afterKill.phase).toBe('result');
    expect(afterKill.result).toBe('win');
    expect(afterKill.playerHp).toBe(30);
    expect(events).toContainEqual({ type: 'CARD_PLAYED', cardName: '秤砣', cost: 1, round: 1 });
    expect(events).toContainEqual({
      type: 'DAMAGE_DEALT',
      target: 'demon',
      amount: 5,
      source: '秤砣',
      demonHpAfter: 0,
    });
    expect(events).toContainEqual({ type: 'BATTLE_ENDED', result: 'win', round: 1 });
  });

  it('emits REFLECT_TRIGGERED and REWIND_APPLIED events accurately', () => {
    const rng = mulberry32(9);
    let state = createBattle(['铜镜', '倒转', '钢笔', '守诺', '旧书'], 'a', rng, CARDS, DEMONS, BALANCE);
    // Play 铜镜 (cost 2) then end turn -> Demon A 3 dmg reflected back to demon
    state = playCard(state, state.hand.indexOf('铜镜')).state;
    const reflectTurn = endTurn(state);
    expect(reflectTurn.events).toContainEqual({
      type: 'REFLECT_TRIGGERED',
      damage: 3,
      demonHpAfter: 17,
    });
    expect(reflectTurn.events).toContainEqual({
      type: 'DEMON_ACT',
      round: 1,
      rawDamage: 3,
      absorbed: 0,
      hpDamage: 0,
      reflected: true,
    });

    // In Round 2, play 倒转 -> restores demonHp 17 -> 20 and emits REWIND_APPLIED
    const rewindRes = playCard(reflectTurn.state, reflectTurn.state.hand.indexOf('倒转'));
    expect(rewindRes.events).toContainEqual({
      type: 'REWIND_APPLIED',
      playerHpBefore: 30,
      playerHpAfter: 30,
      demonHpBefore: 17,
      demonHpAfter: 20,
    });
  });

  it('loses by timeout when demon survives after Round 3 and emits BATTLE_ENDED', () => {
    const rng = mulberry32(2);
    let state = createBattle(TEST_DECK, 'a', rng, CARDS, DEMONS, BALANCE);

    state = endTurn(state).state;
    state = endTurn(state).state;
    const lastTurn = endTurn(state);
    state = lastTurn.state;

    expect(state.phase).toBe('result');
    expect(state.result).toBe('lose_timeout');
    expect(state.playerHp).toBe(21);
    expect(state.demonHp).toBe(20);
    expect(lastTurn.events).toContainEqual({ type: 'BATTLE_ENDED', result: 'lose_timeout', round: 3 });
  });

  it('loses by HP depletion when demon attack reduces playerHp to 0', () => {
    const rng = mulberry32(2);
    const state = createBattle(TEST_DECK, 'a', rng, CARDS, DEMONS, BALANCE);
    const fragile = { ...state, playerHp: 3, shield: 0 };

    const { state: defeated, events } = endTurn(fragile);
    expect(defeated.playerHp).toBe(0);
    expect(defeated.phase).toBe('result');
    expect(defeated.result).toBe('lose_hp');
    expect(events).toContainEqual({ type: 'BATTLE_ENDED', result: 'lose_hp', round: 1 });
  });

  it('telegraphs Demon B Round 3 skill "远行" in Round 2 and deals 8 damage in Round 3', () => {
    const rng = mulberry32(12);
    let state = createBattle(TEST_DECK, 'b', rng, CARDS, DEMONS, BALANCE);
    expect(state.demonHp).toBe(22);
    expect(getIntent(state).current).toEqual({ round: 1, damage: 2 });
    expect(getIntent(state).upcomingSkill).toBeNull();

    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(28);
    expect(getIntent(state).upcomingSkill).toEqual({ round: 3, damage: 8, skill: '远行' });

    state = endTurn(state).state;
    expect(state.round).toBe(3);
    expect(state.playerHp).toBe(26);
    expect(getIntent(state).current).toEqual({ round: 3, damage: 8, skill: '远行' });

    state = endTurn(state).state;
    expect(state.playerHp).toBe(18);
    expect(state.result).toBe('lose_timeout');
  });

  it('resolves victory rewards deterministically and grants +40 extra money when all cards are owned', () => {
    const reward1 = resolveWinReward(['倒转', '守诺'], CARDS, BALANCE, mulberry32(7));
    const reward2 = resolveWinReward(['倒转', '守诺'], CARDS, BALANCE, mulberry32(7));
    expect(reward1).toEqual(reward2);
    expect(reward1.money).toBe(40);
    expect(reward1.redeemTicket).toBe(1);
    expect(reward1.cardName).not.toBeNull();
    expect(['倒转', '守诺']).not.toContain(reward1.cardName);
    expect(reward1.allOwnedBonus).toBe(false);

    const allCardNames = CARDS.map((c) => c.name);
    const fullDeckReward = resolveWinReward(allCardNames, CARDS, BALANCE, mulberry32(7));
    expect(fullDeckReward).toEqual({
      money: 80,
      cardName: null,
      redeemTicket: 1,
      allOwnedBonus: true,
    });
  });

  it('triggers 铁皮青蛙 (damage_conditional) for 3 dmg in R1 and 6 dmg in R2/R3 across real turns', () => {
    const rng = mulberry32(17);
    let state = createBattle(['铁皮青蛙', '守诺', '旧书', '暖水瓶', '蒲扇'], 'a', rng, CARDS, DEMONS, BALANCE);

    expect(state.round).toBe(1);
    expect(state.demonHasActed).toBe(false);
    expect(state.demonHp).toBe(20);
    state = playCard(state, state.hand.indexOf('铁皮青蛙')).state;
    expect(state.demonHp).toBe(17);

    state = endTurn(state).state;
    expect(state.round).toBe(2);
    expect(state.demonHasActed).toBe(true);
    state = playCard(state, state.hand.indexOf('铁皮青蛙')).state;
    expect(state.demonHp).toBe(11);

    state = endTurn(state).state;
    expect(state.round).toBe(3);
    state = playCard(state, state.hand.indexOf('铁皮青蛙')).state;
    expect(state.demonHp).toBe(5);
  });

  it('plays P4 new cards (飞驰, 余音, 集邮) using existing effect types', () => {
    const rng = mulberry32(19);
    let state = createBattle(
      ['飞驰', '余音', '集邮', '守诺', '旧书', '钢笔'],
      'c',
      rng,
      CARDS,
      DEMONS,
      BALANCE,
    );

    expect(state.demonId).toBe('c');
    expect(state.demonName).toBe('房租');
    expect(state.demonHp).toBe(26);

    const stampIdx = state.hand.indexOf('集邮');
    if (stampIdx >= 0) {
      const prevHandLen = state.hand.length;
      state = playCard(state, stampIdx).state;
      expect(state.renqing).toBe(3);
      expect(state.hand).toHaveLength(prevHandLen);
    }

    const echoIdx = state.hand.indexOf('余音');
    expect(echoIdx).toBeGreaterThanOrEqual(0);
    const hpBeforeEcho = state.demonHp;
    state = playCard(state, echoIdx).state;
    expect(state.demonHp).toBe(hpBeforeEcho - 3);
    expect(state.renqing).toBe(3);

    const gallopIdx = state.hand.indexOf('飞驰');
    expect(gallopIdx).toBeGreaterThanOrEqual(0);
    const hpBeforeGallop = state.demonHp;
    state = playCard(state, gallopIdx).state;
    expect(state.demonHp).toBe(hpBeforeGallop - 6);
    expect(state.renqing).toBe(1);
  });

  it('verifies Demon C (房租) escalating damage 3->4->5 and Demon D (学费) Round 3 skill "开学" 10 damage', () => {
    let stateC = createBattle(TEST_DECK, 'c', mulberry32(21), CARDS, DEMONS, BALANCE);
    expect(stateC.demonHp).toBe(26);
    expect(getIntent(stateC).current).toEqual({ round: 1, damage: 3 });
    stateC = endTurn(stateC).state;
    expect(stateC.playerHp).toBe(27);
    expect(getIntent(stateC).current).toEqual({ round: 2, damage: 4 });
    stateC = endTurn(stateC).state;
    expect(stateC.playerHp).toBe(23);
    expect(getIntent(stateC).current).toEqual({ round: 3, damage: 5 });
    stateC = endTurn(stateC).state;
    expect(stateC.playerHp).toBe(18);
    expect(stateC.result).toBe('lose_timeout');

    let stateD = createBattle(TEST_DECK, 'd', mulberry32(22), CARDS, DEMONS, BALANCE);
    expect(stateD.demonHp).toBe(20);
    expect(getIntent(stateD).current).toEqual({ round: 1, damage: 1 });
    stateD = endTurn(stateD).state;
    expect(stateD.playerHp).toBe(29);
    expect(getIntent(stateD).upcomingSkill).toEqual({ round: 3, damage: 10, skill: '开学' });
    stateD = endTurn(stateD).state;
    expect(stateD.playerHp).toBe(27);
    expect(getIntent(stateD).current).toEqual({ round: 3, damage: 10, skill: '开学' });
    stateD = endTurn(stateD).state;
    expect(stateD.playerHp).toBe(17);
    expect(stateD.result).toBe('lose_timeout');
  });

  it('provides clear effect descriptions for every card including 倒转 (C1) and intro/victory lines for all demons (C5)', () => {
    const rewind = CARDS.find((c) => c.id === 'rewind')!;
    expect(formatEffectDescription(rewind)).toBe('敌我双方回到上一回合开始时的状态');

    for (const card of CARDS) {
      const desc = formatEffectDescription(card);
      expect(desc.length, `Card ${card.name} should have non-empty effect description`).toBeGreaterThan(2);
    }

    expect(DEMONS.find((d) => d.id === 'a')?.introLine).toBe('这个月的药费单，又来了。');
    expect(DEMONS.find((d) => d.id === 'b')?.introLine).toBe('远行的车票攥在手里，舍不得放。');
    expect(DEMONS.find((d) => d.id === 'c')?.introLine).toBe('房东在门口敲了三下。');
    expect(DEMONS.find((d) => d.id === 'd')?.introLine).toBe('开学的日子，越来越近了。');
  });
});
