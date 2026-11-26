import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import chaptersJson from '../../src/data/chapters.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import {
  countItemCardsInHand,
  createBattle,
  endTurn,
  getIntent,
  hasItemCardInHand,
  playCard,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import {
  getItemObsessionHint,
  resolveDemonNarrative,
  resolveDemonObsession,
} from '../../src/game/bossComposition';
import { type ChaptersDataFile } from '../../src/game/chapters';
import {
  countEligibleDailyItems,
  createInitialState,
  createRedemptionOffer,
  pickDailyItems,
  resolveRedemption,
  settle,
  skipCustomer,
  type PawnItem,
} from '../../src/game/pawnshop';
import { validateAllGameData, validateCards, validateDemons } from '../../src/game/validate';
import { mulberry32 } from '../../src/utils/rng';

const CARDS = cardsJson as CardDef[];
const DEMONS = demonsJson as DemonDef[];
const ITEMS = itemsJson as PawnItem[];
const CHAPTERS = chaptersJson as ChaptersDataFile;
const BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

describe('P12 阶段 B：执念提前 + 心魔机制 + 牌组合', () => {
  it('cards.json 恰好 12 张旧物牌带 set: "旧物"，validate 校验 set/shield/mechanicLine/linkedItemIds', () => {
    const setCards = CARDS.filter((c) => c.set === '旧物');
    expect(setCards).toHaveLength(12);
    const itemCardNames = new Set(ITEMS.map((i) => i.cardName));
    expect(setCards.every((c) => itemCardNames.has(c.name))).toBe(true);
    expect(CARDS.filter((c) => c.set !== undefined && !itemCardNames.has(c.name))).toEqual([]);

    const badSetCard: CardDef = { ...CARDS[0], set: '错标签' as never };
    expect(validateCards([badSetCard]).errors.some((e) => e.includes('invalid set'))).toBe(true);

    const badDemonShield: DemonDef = {
      ...DEMONS[0],
      actions: [
        { round: 1, damage: 2, shield: -1 },
        { round: 2, damage: 2 },
        { round: 3, damage: 3 },
      ],
    };
    expect(validateDemons([badDemonShield]).errors.some((e) => e.includes('shield must be non-negative'))).toBe(true);

    const missingMechanic: DemonDef = {
      ...DEMONS[0],
      mechanicLine: '',
    };
    expect(validateDemons([missingMechanic]).errors.some((e) => e.includes('mechanicLine'))).toBe(true);

    const badNarrativeKey: DemonDef = {
      ...DEMONS[1],
      linkedItemNarratives: {
        ...(DEMONS[1].linkedItemNarratives ?? {}),
        unknown_item: { customerLink: '测试', aftermathLine: '测试' },
      },
    };
    expect(
      validateDemons([badNarrativeKey]).errors.some((e) => e.includes('must be present in linkedItemIds')),
    ).toBe(true);

    const emptyNarrativeLink: DemonDef = {
      ...DEMONS[1],
      linkedItemNarratives: {
        harmonica: { customerLink: '', aftermathLine: '测试' },
      },
    };
    expect(
      validateDemons([emptyNarrativeLink]).errors.some((e) => e.includes('customerLink must be non-empty')),
    ).toBe(true);

    const emptyNarrativeAftermath: DemonDef = {
      ...DEMONS[1],
      linkedItemNarratives: {
        harmonica: { customerLink: '测试', aftermathLine: '  ' },
      },
    };
    expect(
      validateDemons([emptyNarrativeAftermath]).errors.some((e) => e.includes('aftermathLine must be non-empty')),
    ).toBe(true);

    expect(validateAllGameData(CARDS, ITEMS, DEMONS, CHAPTERS).errors).toEqual([]);
  });

  it('countItemCardsInHand & hasItemCardInHand 边界（空手牌 / 全非旧物 / 全旧物 / 混合）', () => {
    expect(countItemCardsInHand([])).toBe(0);
    expect(hasItemCardInHand([])).toBe(false);

    expect(countItemCardsInHand(['钢笔', '算盘', '当票', '欠条'])).toBe(0);
    expect(hasItemCardInHand(['钢笔', '算盘', '当票', '欠条'])).toBe(false);

    expect(countItemCardsInHand(['旧书', '口琴', '金表'])).toBe(3);
    expect(hasItemCardInHand(['旧书', '口琴', '金表'])).toBe(true);

    expect(countItemCardsInHand(['钢笔', '布票', '欠条', '顶住'])).toBe(2);
    expect(hasItemCardInHand(['钢笔', '布票', '欠条', '顶住'])).toBe(true);
  });

  it('§3.1 执念提前：第 1 天豁免、第 2 天起命中任一关联牌生效一次不叠加、赎回后消失、三处提示匹配', () => {
    const demonA = DEMONS.find((d) => d.id === 'a')!;
    const demonB = DEMONS.find((d) => d.id === 'b')!;
    const demonC = DEMONS.find((d) => d.id === 'c')!;
    const demonD = DEMONS.find((d) => d.id === 'd')!;

    // Demon A has no obsession even with watch/medicine_box on Day 1 or Day 2
    expect(resolveDemonObsession(demonA, ['倒转', '药箱'], 1, ITEMS).active).toBe(false);
    expect(resolveDemonObsession(demonA, ['倒转', '药箱'], 2, ITEMS).active).toBe(false);
    expect(getItemObsessionHint('watch', 1, 'a', DEMONS)).toBeNull();

    // Day 1 is exempt even for B/C/D linked items
    expect(resolveDemonObsession(demonB, ['守诺', '口琴'], 1, ITEMS).active).toBe(false);
    expect(getItemObsessionHint('harmonica', 1, 'b', DEMONS)).toBeNull();

    // Day 2 Demon B with 口琴 -> R3 8->10; with multiple linked items (守诺+口琴+金表) STILL 10 (no stacking)
    const obsBSingle = resolveDemonObsession(demonB, ['口琴'], 2, ITEMS);
    expect(obsBSingle.active).toBe(true);
    expect(obsBSingle.effectLabel).toBe('远行伤害 10');
    expect(obsBSingle.demonDef.actions.find((a) => a.round === 3)?.damage).toBe(10);

    const obsBMulti = resolveDemonObsession(demonB, ['守诺', '口琴', '金表'], 2, ITEMS);
    expect(obsBMulti.active).toBe(true);
    expect(obsBMulti.matchedItemIds).toEqual(['ring', 'harmonica', 'gold_watch']);
    expect(obsBMulti.demonDef.actions.find((a) => a.round === 3)?.damage).toBe(10);

    // Redeemed (no longer in deck) -> obsession gone (R3 back to 8)
    const obsBRedeemed = resolveDemonObsession(demonB, ['钢笔'], 2, ITEMS);
    expect(obsBRedeemed.active).toBe(false);
    expect(obsBRedeemed.demonDef.actions.find((a) => a.round === 3)?.damage).toBe(8);

    // Day 3 Demon C with 铁皮箱(顶住) or 账本 -> HP 26->28 (no stacking)
    const obsC = resolveDemonObsession(demonC, ['顶住', '账本', '旧书'], 3, ITEMS);
    expect(obsC.active).toBe(true);
    expect(obsC.effectLabel).toBe('血量 28');
    expect(obsC.demonDef.hp).toBe(28);

    // Day 4 Demon D with 布票 or 飞驰 -> R3 开学 10->12
    const obsD = resolveDemonObsession(demonD, ['布票'], 4, ITEMS);
    expect(obsD.active).toBe(true);
    expect(obsD.effectLabel).toBe('开学伤害 12');
    expect(obsD.demonDef.actions.find((a) => a.round === 3)?.damage).toBe(12);

    // Pawnshop hints on Day 2+
    expect(getItemObsessionHint('harmonica', 2, 'b', DEMONS)).toBe('收下它，今晚车票远行 10 伤');
    expect(getItemObsessionHint('tin_trunk', 3, 'c', DEMONS)).toBe('收下它，今晚房租多 2 血');
    expect(getItemObsessionHint('cloth_ticket', 4, 'd', DEMONS)).toBe('收下它，今晚学费开学 12 伤');
    expect(getItemObsessionHint('watch', 2, 'b', DEMONS)).toBeNull();

    // Narrative linkedItemIds checks multiple items
    const narrC = resolveDemonNarrative(demonC, ['顶住'], ['tin_trunk'], ITEMS);
    expect(narrC.isLinked).toBe(true);
    expect(narrC.linkedItemId).toBe('tin_trunk');
  });

  it('Block 2 分件叙事：6 件非首选关联牌返回各自两行文案，4 件首选牌仍返回心魔级文案', () => {
    const demonA = DEMONS.find((d) => d.id === 'a')!;
    const demonB = DEMONS.find((d) => d.id === 'b')!;
    const demonC = DEMONS.find((d) => d.id === 'c')!;
    const demonD = DEMONS.find((d) => d.id === 'd')!;

    const nonPrimaryCases = [
      {
        demon: demonA,
        itemId: 'medicine_box',
        cardName: '药箱',
        expectedLink: '白天当了药箱的老头的难处',
        expectedAftermath: '白天药箱还在柜里，下月账单还在。',
      },
      {
        demon: demonB,
        itemId: 'harmonica',
        cardName: '口琴',
        expectedLink: '白天当了口琴的工人的难处',
        expectedAftermath: '白天口琴仍在铺里，远路还得自己走。',
      },
      {
        demon: demonB,
        itemId: 'gold_watch',
        cardName: '金表',
        expectedLink: '白天当了金表的人的难处',
        expectedAftermath: '白天金表仍在铺里，远路还得自己走。',
      },
      {
        demon: demonC,
        itemId: 'tin_trunk',
        cardName: '顶住',
        expectedLink: '白天当了铁皮箱的打工人的难处',
        expectedAftermath: '白天铁皮箱仍堆在柜后，下月房租还在。',
      },
      {
        demon: demonC,
        itemId: 'ledger',
        cardName: '账本',
        expectedLink: '白天当了账本的人的难处',
        expectedAftermath: '白天账本仍堆在柜后，下月房租还在。',
      },
      {
        demon: demonD,
        itemId: 'cloth_ticket',
        cardName: '布票',
        expectedLink: '白天当了布票的母亲的难处',
        expectedAftermath: '白天布票仍在铺里，学费单子还在。',
      },
    ];

    for (const c of nonPrimaryCases) {
      const res = resolveDemonNarrative(c.demon, [c.cardName], [c.itemId], ITEMS);
      expect(res.isLinked).toBe(true);
      expect(res.linkedItemId).toBe(c.itemId);
      expect(res.customerLink).toBe(c.expectedLink);
      expect(res.aftermathLine).toBe(c.expectedAftermath);
      expect(res.customerLink).not.toBe(c.demon.customerLink);
    }

    const primaryCases = [
      { demon: demonA, itemId: 'watch', cardName: '倒转' },
      { demon: demonB, itemId: 'ring', cardName: '守诺' },
      { demon: demonC, itemId: 'old_book', cardName: '旧书' },
      { demon: demonD, itemId: 'bicycle', cardName: '飞驰' },
    ];

    for (const c of primaryCases) {
      const res = resolveDemonNarrative(c.demon, [c.cardName], [c.itemId], ITEMS);
      expect(res.isLinked).toBe(true);
      expect(res.linkedItemId).toBe(c.itemId);
      expect(res.customerLink).toBe(c.demon.customerLink);
      expect(res.aftermathLine).toBe(c.demon.aftermathLine);
    }
  });

  it('§3.2 四心魔各自机制：A 3/3/5、B R1/R2 各 1 盾、C 3/5/7、D R1/R2 各 2 盾（含 R2 盾刷新）', () => {
    // Demon A: R1=3, R2=3, R3=5 (total 11 dmg)
    let stA = createBattle(['钢笔', '守诺', '旧书', '算盘', '暖水瓶'], 'a', mulberry32(1), CARDS, DEMONS, BALANCE);
    expect(stA.demonMechanicLine).toBe('第三回合伤害 5');
    expect(getIntent(stA).current?.damage).toBe(3);
    stA = endTurn(stA).state;
    expect(stA.playerHp).toBe(27);
    expect(getIntent(stA).current?.damage).toBe(3);
    stA = endTurn(stA).state;
    expect(stA.playerHp).toBe(24);
    expect(getIntent(stA).current?.damage).toBe(5);
    stA = endTurn(stA).state;
    expect(stA.playerHp).toBe(19);

    // Demon B: R1 shield 1 -> break it in R1 -> R2 refreshes shield 1 -> R3 shield 0
    let stB = createBattle(['钢笔', '钢笔', '钢笔', '钢笔', '钢笔'], 'b', mulberry32(1), CARDS, DEMONS, BALANCE);
    expect(stB.demonMechanicLine).toBe('两回合都得 1 盾');
    expect(stB.demonShield).toBe(1);
    expect(stB.log).toContain('R1:心魔获1盾');
    stB = playCard(stB, 0).state; // 4 dmg: 1 shield absorbed, 3 hp dmg (22 -> 19)
    expect(stB.demonShield).toBe(0);
    expect(stB.demonHp).toBe(19);
    stB = endTurn(stB).state;
    expect(stB.round).toBe(2);
    expect(stB.demonShield).toBe(1);
    expect(stB.log).toContain('R2:心魔获1盾');
    stB = endTurn(stB).state;
    expect(stB.round).toBe(3);
    expect(stB.demonShield).toBe(0);

    // Demon C: 3 / 5 / 7 (total 15 dmg)
    let stC = createBattle(['守诺', '旧书', '算盘', '暖水瓶', '蒲扇'], 'c', mulberry32(1), CARDS, DEMONS, BALANCE);
    expect(stC.demonMechanicLine).toBe('伤害每回合涨，3/5/7');
    stC = endTurn(stC).state;
    expect(stC.playerHp).toBe(27);
    stC = endTurn(stC).state;
    expect(stC.playerHp).toBe(22);
    stC = endTurn(stC).state;
    expect(stC.playerHp).toBe(15);

    // Demon D: R1 shield 2 -> break -> R2 shield 2 -> R3 shield 0
    let stD = createBattle(['钢笔', '钢笔', '钢笔', '钢笔', '钢笔'], 'd', mulberry32(1), CARDS, DEMONS, BALANCE);
    expect(stD.demonMechanicLine).toBe('两回合都得 2 盾');
    expect(stD.demonShield).toBe(2);
    expect(stD.log).toContain('R1:心魔获2盾');
    stD = playCard(stD, 0).state; // 4 dmg: 2 shield absorbed, 2 hp dmg (20 -> 18)
    expect(stD.demonShield).toBe(0);
    expect(stD.demonHp).toBe(18);
    stD = endTurn(stD).state;
    expect(stD.round).toBe(2);
    expect(stD.demonShield).toBe(2);
    expect(stD.log).toContain('R2:心魔获2盾');
    stD = endTurn(stD).state;
    expect(stD.round).toBe(3);
    expect(stD.demonShield).toBe(0);
  });

  it('跟进 1 收当不重复：已拥有硬排除、拒绝/跳过可再出现、D1 冷却不变、池不足少出不补、全拥有直入 summary', () => {
    // 1. Owned item never appears across 50 seeds
    const deckWithWatch = ['倒转'];
    for (let s = 1; s <= 50; s += 1) {
      const picked = pickDailyItems(ITEMS, 3, mulberry32(s), 3, { deck: deckWithWatch });
      expect(picked.some((i) => i.id === 'watch')).toBe(false);
    }

    // 2. Rejected or skipped item (not in deck) can still appear on a later day
    const state = createInitialState({ day: 1, items: [ITEMS[0]], money: 200 });
    const rejected = settle(state, 'low', false);
    expect(rejected.deck).toEqual([]);
    const skipped = skipCustomer(state);
    expect(skipped.deck).toEqual([]);
    let watchReturned = false;
    for (let s = 1; s <= 50; s += 1) {
      const picked = pickDailyItems(ITEMS, 2, mulberry32(s), 3, { deck: rejected.deck });
      if (picked.some((i) => i.id === 'watch')) {
        watchReturned = true;
        break;
      }
    }
    expect(watchReturned).toBe(true);

    // 3. D1 2-day cooldown still excludes redeemed items even when not in deck
    for (let s = 1; s <= 30; s += 1) {
      const picked = pickDailyItems(ITEMS, 3, mulberry32(s), 3, {
        deck: [],
        redeemedDayByItem: { ring: 2 },
      });
      expect(picked.some((i) => i.id === 'ring')).toBe(false);
    }

    // 4. Pool < 3 returns exact remaining count (no padding with owned or cooldown items)
    const deck10 = ITEMS.slice(0, 10).map((i) => i.cardName);
    expect(countEligibleDailyItems(ITEMS, 5, { deck: deck10 })).toBe(2);
    const picked2 = pickDailyItems(ITEMS, 5, mulberry32(7), 3, { deck: deck10 });
    expect(picked2).toHaveLength(2);
    expect(picked2.map((i) => i.id).sort()).toEqual(['gold_watch', 'tin_trunk']);

    // If 1 of the remaining 2 is on D1 cooldown, only 1 customer appears
    const picked1 = pickDailyItems(ITEMS, 5, mulberry32(7), 3, {
      deck: deck10,
      redeemedDayByItem: { gold_watch: 4 },
    });
    expect(picked1.map((i) => i.id)).toEqual(['tin_trunk']);

    // 5. All 12 owned -> 0 customers -> createInitialState & resolveRedemption transition cleanly to summary
    const all12Deck = ITEMS.map((i) => i.cardName);
    const emptyPicked = pickDailyItems(ITEMS, 6, mulberry32(9), 3, { deck: all12Deck });
    expect(emptyPicked).toEqual([]);
    const emptyState = createInitialState({ day: 6, deck: all12Deck, items: emptyPicked });
    expect(emptyState.phase).toBe('summary');

    const offer = createRedemptionOffer(all12Deck, 1, {}, mulberry32(1), ITEMS)!;
    const redeemState = createInitialState({
      day: 6,
      deck: all12Deck,
      items: emptyPicked,
      redeemTickets: 1,
      redemptionOffer: offer,
    });
    expect(redeemState.phase).toBe('redemption');
    const afterRedeem = resolveRedemption(redeemState, false);
    expect(afterRedeem.phase).toBe('summary');
  });
});
