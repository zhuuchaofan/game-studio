import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import {
  applyEffect,
  buildCardMap,
  createBattle,
  formatEffectDescription,
  formatEffectShort,
  playCard,
  type BattleBalanceConfig,
  type BattleState,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import { hasItemCardInHand } from '../../src/game/effects';
import { validateCards, validateDemons } from '../../src/game/validate';
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
const BY_NAME = buildCardMap(CARDS);
const card = (name: string): CardDef => BY_NAME.get(name)!;

function makeState(overrides: Partial<BattleState> = {}): BattleState {
  const base = createBattle(['钢笔', '守诺', '旧书', '算盘', '暖水瓶'], 'a', mulberry32(42), CARDS, DEMONS, BALANCE);
  return { ...base, renqing: 5, ...overrides };
}

describe('P12 阶段 A：数据地基', () => {
  it('6 件新旧物与 6 张新牌的名称、关联与组合表一致', () => {
    expect(CARDS).toHaveLength(30);
    expect(itemsJson).toHaveLength(12);
    const boss = DEMONS.find((d) => d.id === 'boss_ch1')!;
    expect(boss.composition!.components).toHaveLength(12);
    expect(boss.composition!.maxCompositionHp).toBe(36);
    expect(boss.composition!.absoluteMaxHp).toBe(40);
    for (const id of ['cloth_ticket', 'harmonica', 'medicine_box', 'ledger', 'tin_trunk', 'gold_watch']) {
      const item = itemsJson.find((i) => i.id === id)!;
      const c = CARDS.find((x) => x.id === id)!;
      expect(c.name).toBe(item.cardName);
      expect(c.cost).toBe(item.cardCost);
      expect(c.item).toBe(item.name);
      expect(boss.composition!.components.some((x) => x.itemId === id && x.cardName === item.cardName)).toBe(true);
    }
    expect(validateCards(CARDS).errors).toEqual([]);
    expect(validateDemons(DEMONS).errors).toEqual([]);
  });

  it('hasItemCardInHand 边界：空手牌 / 无旧物 / 有旧物 / 打出本张后只剩本张', () => {
    expect(hasItemCardInHand([])).toBe(false);
    expect(hasItemCardInHand(['当票', '欠条'])).toBe(false);
    expect(hasItemCardInHand(['当票', '旧书'])).toBe(true);
    // 本张口琴打出时已离开手牌：手里只有别的非旧物牌 → 不触发
    const solo = playCard(makeState({ hand: ['口琴', '当票'], demonHp: 20 }), 0).state;
    expect(solo.demonHp).toBe(18);
    // 手里另有一张旧物牌 → 触发
    const withOther = playCard(makeState({ hand: ['口琴', '旧书'], demonHp: 20 }), 0).state;
    expect(withOther.demonHp).toBe(16);
  });

  it('口琴 / 金表 / 顶住 / 账本 / 布票 / 药箱 效果与边界', () => {
    const ctx = { cardsByName: BY_NAME, rng: mulberry32(3) };
    // 金表：敌方生命 10 触发，11 不触发
    const w = card('金表').effects[0];
    expect(applyEffect(makeState({ demonHp: 10 }), w, ctx).demonHp).toBe(1);
    expect(applyEffect(makeState({ demonHp: 11 }), w, ctx).demonHp).toBe(6);
    // 顶住：无盾 4，已有盾再 +3
    const t = card('顶住').effects[0];
    expect(applyEffect(makeState({ shield: 0 }), t, ctx).shield).toBe(4);
    expect(applyEffect(makeState({ shield: 1 }), t, ctx).shield).toBe(8);
    // 账本：无旧物抽 1，有旧物抽 2
    const lg = card('账本').effects[0];
    const pile = ['a', 'b', 'c', 'd'];
    const noItem = applyEffect(makeState({ hand: ['当票'], drawPile: [...pile], discardPile: [] }), lg, ctx);
    expect(noItem.hand).toHaveLength(2);
    const hasItem = applyEffect(makeState({ hand: ['旧书'], drawPile: [...pile], discardPile: [] }), lg, ctx);
    expect(hasItem.hand).toHaveLength(3);
    // 布票：抽 1 + 盾 2
    const cloth = playCard(makeState({ hand: ['布票'], drawPile: [...pile], discardPile: [], shield: 0 }), 0).state;
    expect(cloth.hand).toHaveLength(1);
    expect(cloth.shield).toBe(2);
    // 药箱：回 4，封顶 30
    const h = card('药箱').effects[0];
    expect(applyEffect(makeState({ playerHp: 20, maxPlayerHp: 30 }), h, ctx).playerHp).toBe(24);
    expect(applyEffect(makeState({ playerHp: 28, maxPlayerHp: 30 }), h, ctx).playerHp).toBe(30);
    // 铁皮青蛙（无 condition）保持心魔行动口径
    const f = card('铁皮青蛙').effects[0];
    expect(applyEffect(makeState({ demonHp: 20, demonHasActed: false }), f, ctx).demonHp).toBe(17);
    expect(applyEffect(makeState({ demonHp: 20, demonHasActed: true }), f, ctx).demonHp).toBe(14);
  });

  it('formatEffectShort / formatEffectDescription 逐张断言', () => {
    const expected: Record<string, [string, string]> = {
      布票: ['抽1盾2', '抽1张牌，获得2点护盾'],
      口琴: ['伤2/4', '造成2点伤害，手中有旧物牌时改为4点'],
      药箱: ['回4', '恢复4点生命'],
      账本: ['抽1/2', '抽1张牌，手中有旧物牌时再抽1张'],
      顶住: ['盾4/7', '获得4点护盾，已有护盾时再获得3点护盾'],
      金表: ['伤5/9', '造成5点伤害，敌方生命10以下时改为9点'],
      铁皮青蛙: ['伤3/6', '造成3点伤害，心魔行动过后改为6点'],
    };
    for (const [name, [short, desc]] of Object.entries(expected)) {
      expect(formatEffectShort(card(name)), name).toBe(short);
      expect(formatEffectDescription(card(name)), name).toBe(desc);
    }
  });

  it('validate：condition 白名单 / threshold 规则 / 新类型 bonus 必填', () => {
    const base = card('金表');
    const run = (effects: CardDef['effects']) => validateCards([{ ...base, effects }]).errors.join('|');
    expect(run([{ type: 'damage_conditional', value: 5, bonus: 4, condition: 'enemy_hp_le' }])).toContain('threshold');
    expect(run([{ type: 'damage_conditional', value: 5, bonus: 4, condition: 'enemy_hp_le', threshold: -1 }])).toContain('threshold');
    expect(run([{ type: 'damage_conditional', value: 5, bonus: 4, condition: 'demon_acted', threshold: 3 }])).toContain('threshold');
    expect(run([{ type: 'damage_conditional', value: 5, bonus: 4, condition: 'bogus' as never }])).toContain('unknown condition');
    expect(run([{ type: 'shield_conditional', value: 4, condition: 'has_shield' }])).toContain('requires non-negative bonus');
    expect(run([{ type: 'draw_conditional', value: 1 }])).toContain('requires non-negative bonus');
  });
});
