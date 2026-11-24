import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import {
  createBattle,
  endTurn,
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

describe('Battle state machine', () => {
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

    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('play');
    expect(state.hand).toHaveLength(7);
    expect(state.drawPile).toHaveLength(3);

    state = endTurn(state);
    expect(state.round).toBe(3);
    expect(state.hand).toHaveLength(9);
    expect(state.drawPile).toHaveLength(1);
  });

  it('rejects card play when renqing is insufficient without mutating state', () => {
    const rng = mulberry32(7);
    const state = createBattle(['倒转', '钢笔', '守诺', '旧书', '秤砣'], 'a', rng, CARDS, DEMONS, BALANCE);
    const lowRenqing = { ...state, renqing: 1 };
    const rewindIdx = lowRenqing.hand.indexOf('倒转');
    expect(rewindIdx).toBeGreaterThanOrEqual(0);

    const attempted = playCard(lowRenqing, rewindIdx);
    expect(attempted.renqing).toBe(1);
    expect(attempted.hand).toEqual(lowRenqing.hand);
    expect(attempted.discardPile).toEqual([]);
  });

  it('reshuffles discardPile into drawPile when drawPile is exhausted', () => {
    const rng = mulberry32(11);
    let state = createBattle(['钢笔', '秤砣', '守诺', '旧书', '暖水瓶'], 'a', rng, CARDS, DEMONS, BALANCE);
    // R1 draws all 5 cards -> drawPile is 0
    expect(state.drawPile).toHaveLength(0);

    // Play 3 cards so they go to discardPile
    const penIdx = state.hand.indexOf('钢笔');
    state = playCard(state, penIdx);
    const weightIdx = state.hand.indexOf('秤砣');
    state = playCard(state, weightIdx);
    const shieldIdx = state.hand.indexOf('守诺');
    state = playCard(state, shieldIdx);
    expect(state.discardPile).toHaveLength(3);

    // End turn -> R2 draws 2 cards by reshuffling discardPile
    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.hand).toHaveLength(4);
    expect(state.drawPile).toHaveLength(1);
    expect(state.discardPile).toHaveLength(0);
  });

  it('absorbs demon damage with shield first, clears shield next round, and applies renqing_next', () => {
    const rng = mulberry32(3);
    let state = createBattle(['守诺', '手电', '暖水瓶', '钢笔', '秤砣'], 'a', rng, CARDS, DEMONS, BALANCE);

    // Play 暖水瓶 (shield 4) and 手电 (renqing_next +1)
    state = playCard(state, state.hand.indexOf('暖水瓶'));
    state = playCard(state, state.hand.indexOf('手电'));
    expect(state.shield).toBe(4);
    expect(state.nextRoundRenqingBonus).toBe(1);

    // Demon A deals 3 dmg -> fully absorbed by 4 shield; next round shield resets to 0 and renqing = 3 + 1 = 4
    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(30);
    expect(state.shield).toBe(0);
    expect(state.renqing).toBe(4);
    expect(state.nextRoundRenqingBonus).toBe(0);
  });

  it('wins immediately when card damage reduces demonHp to 0 without waiting for demon action', () => {
    const rng = mulberry32(5);
    const state = createBattle(['秤砣', '钢笔', '相机', '守诺', '旧书'], 'a', rng, CARDS, DEMONS, BALANCE);
    const nearDeath = { ...state, demonHp: 5 };
    const weightIdx = nearDeath.hand.indexOf('秤砣');

    const afterKill = playCard(nearDeath, weightIdx);
    expect(afterKill.demonHp).toBe(0);
    expect(afterKill.phase).toBe('result');
    expect(afterKill.result).toBe('win');
    expect(afterKill.playerHp).toBe(30);
  });

  it('loses by timeout when demon survives after Round 3', () => {
    const rng = mulberry32(2);
    let state = createBattle(TEST_DECK, 'a', rng, CARDS, DEMONS, BALANCE);

    state = endTurn(state); // R1 -> R2 (hp 27)
    state = endTurn(state); // R2 -> R3 (hp 24)
    state = endTurn(state); // R3 demon acts (hp 21), demon still alive -> lose_timeout

    expect(state.phase).toBe('result');
    expect(state.result).toBe('lose_timeout');
    expect(state.playerHp).toBe(21);
    expect(state.demonHp).toBe(20);
  });

  it('loses by HP depletion when demon attack reduces playerHp to 0', () => {
    const rng = mulberry32(2);
    const state = createBattle(TEST_DECK, 'a', rng, CARDS, DEMONS, BALANCE);
    const fragile = { ...state, playerHp: 3, shield: 0 };

    const defeated = endTurn(fragile);
    expect(defeated.playerHp).toBe(0);
    expect(defeated.phase).toBe('result');
    expect(defeated.result).toBe('lose_hp');
  });

  it('telegraphs Demon B Round 3 skill "远行" in Round 2 and deals 8 damage in Round 3', () => {
    const rng = mulberry32(12);
    let state = createBattle(TEST_DECK, 'b', rng, CARDS, DEMONS, BALANCE);
    expect(state.demonHp).toBe(18);
    expect(getIntent(state).current).toEqual({ round: 1, damage: 2 });
    expect(getIntent(state).upcomingSkill).toBeNull();

    // End R1 -> takes 2 dmg (hp 28), enters R2 with upcomingSkill "远行"
    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.playerHp).toBe(28);
    expect(getIntent(state).upcomingSkill).toEqual({ round: 3, damage: 8, skill: '远行' });

    // End R2 -> takes 2 dmg (hp 26), enters R3 where current intent is "远行" 8 dmg
    state = endTurn(state);
    expect(state.round).toBe(3);
    expect(state.playerHp).toBe(26);
    expect(getIntent(state).current).toEqual({ round: 3, damage: 8, skill: '远行' });

    // Play 暖水瓶 (4 shield) if in hand or just take 8 dmg
    state = endTurn(state);
    expect(state.playerHp).toBe(18);
    expect(state.result).toBe('lose_timeout');
  });

  it('resolves victory rewards deterministically and grants +20 extra money when all 20 cards are owned', () => {
    const reward1 = resolveWinReward(['倒转', '守诺'], CARDS, BALANCE, mulberry32(7));
    const reward2 = resolveWinReward(['倒转', '守诺'], CARDS, BALANCE, mulberry32(7));
    expect(reward1).toEqual(reward2);
    expect(reward1.money).toBe(20);
    expect(reward1.redeemTicket).toBe(1);
    expect(reward1.cardName).not.toBeNull();
    expect(['倒转', '守诺']).not.toContain(reward1.cardName);
    expect(reward1.allOwnedBonus).toBe(false);

    const allCardNames = CARDS.map((c) => c.name);
    const fullDeckReward = resolveWinReward(allCardNames, CARDS, BALANCE, mulberry32(7));
    expect(fullDeckReward).toEqual({
      money: 40,
      cardName: null,
      redeemTicket: 1,
      allOwnedBonus: true,
    });
  });

  it('triggers 铁皮青蛙 (damage_conditional) for 3 dmg in R1 and 6 dmg in R2/R3 across real turns', () => {
    const rng = mulberry32(17);
    let state = createBattle(['铁皮青蛙', '守诺', '旧书', '暖水瓶', '蒲扇'], 'a', rng, CARDS, DEMONS, BALANCE);

    // R1：心魔尚未行动，铁皮青蛙造成基础 3 点伤害
    expect(state.round).toBe(1);
    expect(state.demonHasActed).toBe(false);
    expect(state.demonHp).toBe(20);
    const frogIdxR1 = state.hand.indexOf('铁皮青蛙');
    expect(frogIdxR1).toBeGreaterThanOrEqual(0);

    state = playCard(state, frogIdxR1);
    expect(state.demonHp).toBe(17);
    expect(state.demonHasActed).toBe(false);

    // 结束 R1 -> 心魔行动并将 demonHasActed 置为 true，进入 R2 时不重置，且弃牌堆洗回抽到铁皮青蛙
    state = endTurn(state);
    expect(state.round).toBe(2);
    expect(state.phase).toBe('play');
    expect(state.demonHasActed).toBe(true);
    const frogIdxR2 = state.hand.indexOf('铁皮青蛙');
    expect(frogIdxR2).toBeGreaterThanOrEqual(0);

    // R2：心魔此前回合已行动，铁皮青蛙触发条件分支造成 6 点伤害
    state = playCard(state, frogIdxR2);
    expect(state.demonHp).toBe(11);

    // 结束 R2 -> 进入 R3，demonHasActed 仍保持 true，再次打出仍为 6 点伤害
    state = endTurn(state);
    expect(state.round).toBe(3);
    expect(state.demonHasActed).toBe(true);
    const frogIdxR3 = state.hand.indexOf('铁皮青蛙');
    expect(frogIdxR3).toBeGreaterThanOrEqual(0);

    state = playCard(state, frogIdxR3);
    expect(state.demonHp).toBe(5);
  });

  it('plays P4 new cards (飞驰, 余音, 集邮) using existing effect types without introducing new mechanics', () => {
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
    expect(state.demonHp).toBe(22);

    // 集邮 (cost 1): draw 1 + renqing +1 (net 0 renqing, hand size unchanged)
    const stampIdx = state.hand.indexOf('集邮');
    if (stampIdx >= 0) {
      const prevHandLen = state.hand.length;
      state = playCard(state, stampIdx);
      expect(state.renqing).toBe(3);
      expect(state.hand).toHaveLength(prevHandLen);
    }

    // 余音 (cost 1): damage 3 + renqing +1 (net 0 renqing)
    const echoIdx = state.hand.indexOf('余音');
    expect(echoIdx).toBeGreaterThanOrEqual(0);
    const hpBeforeEcho = state.demonHp;
    state = playCard(state, echoIdx);
    expect(state.demonHp).toBe(hpBeforeEcho - 3);
    expect(state.renqing).toBe(3);

    // 飞驰 (cost 2): damage 6
    const gallopIdx = state.hand.indexOf('飞驰');
    expect(gallopIdx).toBeGreaterThanOrEqual(0);
    const hpBeforeGallop = state.demonHp;
    state = playCard(state, gallopIdx);
    expect(state.demonHp).toBe(hpBeforeGallop - 6);
    expect(state.renqing).toBe(1);
  });

  it('verifies Demon C (房租) escalating damage 3->4->5 and Demon D (学费) Round 3 skill "开学" 10 damage', () => {
    // Demon C: 22 HP, 3 -> 4 -> 5
    let stateC = createBattle(TEST_DECK, 'c', mulberry32(21), CARDS, DEMONS, BALANCE);
    expect(stateC.demonHp).toBe(22);
    expect(getIntent(stateC).current).toEqual({ round: 1, damage: 3 });
    stateC = endTurn(stateC);
    expect(stateC.playerHp).toBe(27);
    expect(getIntent(stateC).current).toEqual({ round: 2, damage: 4 });
    stateC = endTurn(stateC);
    expect(stateC.playerHp).toBe(23);
    expect(getIntent(stateC).current).toEqual({ round: 3, damage: 5 });
    stateC = endTurn(stateC);
    expect(stateC.playerHp).toBe(18);
    expect(stateC.result).toBe('lose_timeout');

    // Demon D: 16 HP, 1 -> 2 -> 10 (skill: 开学)
    let stateD = createBattle(TEST_DECK, 'd', mulberry32(22), CARDS, DEMONS, BALANCE);
    expect(stateD.demonHp).toBe(16);
    expect(getIntent(stateD).current).toEqual({ round: 1, damage: 1 });
    expect(getIntent(stateD).upcomingSkill).toBeNull();
    stateD = endTurn(stateD);
    expect(stateD.playerHp).toBe(29);
    expect(getIntent(stateD).current).toEqual({ round: 2, damage: 2 });
    expect(getIntent(stateD).upcomingSkill).toEqual({ round: 3, damage: 10, skill: '开学' });
    stateD = endTurn(stateD);
    expect(stateD.playerHp).toBe(27);
    expect(getIntent(stateD).current).toEqual({ round: 3, damage: 10, skill: '开学' });
    stateD = endTurn(stateD);
    expect(stateD.playerHp).toBe(17);
    expect(stateD.result).toBe('lose_timeout');
  });
});
