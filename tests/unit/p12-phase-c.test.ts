import { describe, expect, it } from 'vitest';
import balanceJson from '../../src/data/balance.json';
import cardsJson from '../../src/data/cards.json';
import chaptersJson from '../../src/data/chapters.json';
import demonsJson from '../../src/data/demons.json';
import heirloomsJson from '../../src/data/heirlooms.json';
import itemsJson from '../../src/data/items.json';
import {
  createBattle,
  createBattleWithEvents,
  endTurn,
  playCard,
  resolvePendingChoice,
  resolveWinReward,
  type BattleBalanceConfig,
  type CardDef,
  type DemonDef,
} from '../../src/game/battle';
import {
  cloneChapterState,
  createInitialChapterState,
  isValidPactId,
  VALID_PACT_IDS,
  type ChaptersDataFile,
} from '../../src/game/chapters';
import {
  addHeirloom,
  createHeirloomHookRegistry,
  getNewlyReachedMilestones,
  HEIRLOOM_CAP,
  HEIRLOOMS,
  isItemSetCard,
  isRenqingCard,
  pickRandomUnownedHeirloom,
  replaceHeirloomAtIndex,
  type HeirloomDef,
} from '../../src/game/heirlooms';
import { pickDailyItems, type PawnItem } from '../../src/game/pawnshop';
import {
  applyDayResult,
  applyPactToSave,
  createNewGame,
  loadSaveDetailed,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  type SaveData,
  type StorageLike,
} from '../../src/game/save';
import {
  validateAllGameData,
  validateChapters,
  validateHeirlooms,
} from '../../src/game/validate';
import { mulberry32 } from '../../src/utils/rng';

const CARDS = cardsJson as CardDef[];
const DEMONS = demonsJson as DemonDef[];
const ITEMS = itemsJson as PawnItem[];
const CHAPTERS = chaptersJson as ChaptersDataFile;
const REAL_HEIRLOOMS = heirloomsJson as HeirloomDef[];
const BALANCE: BattleBalanceConfig = {
  startingHp: balanceJson.startingHp,
  startingRenqing: balanceJson.startingRenqing,
  maxRenqing: balanceJson.maxRenqing,
  drawFirst: balanceJson.drawFirst,
  drawPerRound: balanceJson.drawPerRound,
  winRewardMoney: balanceJson.winRewardMoney,
};

function createMemoryStorage(): StorageLike & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

describe('P12 阶段 C：7 件传家宝效果与边界', () => {
  it('heirlooms.json 包含 7 件传家宝且字库与分类定义准确', () => {
    expect(HEIRLOOMS).toHaveLength(7);
    expect(HEIRLOOMS.map((h) => h.id)).toEqual([
      'old_abacus',
      'gold_signboard',
      'old_scale',
      'quilt',
      'copper_tray',
      'paper_lantern',
      'old_newspaper',
    ]);
    expect(HEIRLOOMS.map((h) => h.shortLabel)).toEqual(['算', '招', '秤', '被', '盘', '灯', '报']);
    for (const h of HEIRLOOMS) {
      expect(h.name).not.toContain('宝');
      expect(h.effectText).not.toContain('宝');
      expect(h.story).not.toContain('宝');
    }

    const renqingNames = CARDS.filter((c) => isRenqingCard(c)).map((c) => c.name).sort();
    expect(renqingNames).toEqual(['余音', '手电', '当票', '算盘', '集邮'].sort());

    const itemSetCards = CARDS.filter((c) => isItemSetCard(c));
    expect(itemSetCards).toHaveLength(12);
  });

  it('1. 老算盘 old_abacus：每夜首次打出人情牌 +1 人情，同夜第二张不触发，新局重置', () => {
    const deck = ['手电', '余音', '集邮', '钢笔', '守诺'];
    const hooks1 = createHeirloomHookRegistry(['old_abacus']);
    let st = createBattle(deck, 'a', mulberry32(1), CARDS, DEMONS, BALANCE, hooks1);

    const flashIdx = st.hand.indexOf('手电');
    expect(flashIdx).toBeGreaterThanOrEqual(0);
    const rqBefore = st.renqing;
    st = playCard(st, flashIdx).state;
    // 手电 cost 1, old_abacus +1 -> net 0
    expect(st.renqing).toBe(rqBefore);
    expect(st.log.some((l) => l.includes('老算盘') && l.includes('人情+1'))).toBe(true);

    // 同夜第二张人情牌（余音：cost 1, effect +1 -> net 0，不应再得老算盘 +1）
    const echoIdx = st.hand.indexOf('余音');
    expect(echoIdx).toBeGreaterThanOrEqual(0);
    const rqBeforeSecond = st.renqing;
    const logCountBefore = st.log.filter((l) => l.includes('老算盘')).length;
    st = playCard(st, echoIdx).state;
    expect(st.renqing).toBe(rqBeforeSecond);
    expect(st.log.filter((l) => l.includes('老算盘'))).toHaveLength(logCountBefore);

    // 跨回合仍为同夜，不应重置
    st = endTurn(st).state;
    const stampIdx = st.hand.indexOf('集邮');
    if (stampIdx >= 0) {
      const rqR2 = st.renqing;
      st = playCard(st, stampIdx).state;
      expect(st.renqing).toBe(rqR2);
      expect(st.log.filter((l) => l.includes('老算盘'))).toHaveLength(1);
    }

    // 当票（discard_for_renqing）也属于人情牌，新局应重置并触发
    const hooks2 = createHeirloomHookRegistry(['old_abacus']);
    let st2 = createBattle(
      ['当票', '钢笔', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(2),
      CARDS,
      DEMONS,
      BALANCE,
      hooks2,
    );
    const ticketIdx = st2.hand.indexOf('当票');
    st2 = playCard(st2, ticketIdx).state;
    expect(st2.pendingChoice?.kind).toBe('discard');
    st2 = resolvePendingChoice(st2, 0).state;
    // 起始 3 情 + 当票 +2 + 老算盘 +1 = 6
    expect(st2.renqing).toBe(6);
    expect(st2.log.some((l) => l.includes('老算盘'))).toBe(true);
  });

  it('2. 金招牌 gold_signboard：每打出一张旧物牌得 1 点护盾，非旧物牌不触发', () => {
    const hooks = createHeirloomHookRegistry(['gold_signboard']);
    let st = createBattle(
      ['守诺', '布票', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(3),
      CARDS,
      DEMONS,
      BALANCE,
      hooks,
    );

    st = playCard(st, st.hand.indexOf('钢笔')).state;
    expect(st.shield).toBe(0);

    st = playCard(st, st.hand.indexOf('守诺')).state; // 守诺 +5 + 金招牌 +1 = 6
    expect(st.shield).toBe(6);

    st = playCard(st, st.hand.indexOf('布票')).state; // 布票 +2 + 金招牌 +1 = 9
    expect(st.shield).toBe(9);
    expect(st.log.filter((l) => l.includes('金招牌'))).toHaveLength(2);
  });

  it('3. 老秤 old_scale：每夜首次打出旧物牌时抽 1 张牌，非旧物牌不触发，同夜不重复，新局重置', () => {
    const hooks1 = createHeirloomHookRegistry(['old_scale']);
    let st = createBattle(
      ['钢笔', '守诺', '守诺', '守诺', '秤砣', '秤砣'],
      'a',
      mulberry32(4),
      CARDS,
      DEMONS,
      { ...BALANCE, drawFirst: 5 },
      hooks1,
    );
    if (!st.hand.includes('钢笔') || !st.hand.includes('守诺')) {
      st = { ...st, hand: ['钢笔', '守诺', '守诺'], drawPile: ['秤砣', '秤砣', '秤砣'] };
    }

    const penIdx = st.hand.indexOf('钢笔');
    if (penIdx >= 0) {
      const handBeforePen = st.hand.length;
      st = playCard(st, penIdx).state;
      expect(st.hand.length).toBe(handBeforePen - 1);
    }

    const promiseIdx = st.hand.indexOf('守诺');
    expect(promiseIdx).toBeGreaterThanOrEqual(0);
    const handBeforeItem = st.hand.length;
    st = playCard(st, promiseIdx).state;
    // 打出 1 张 (-1) + 老秤抽 1 (+1) = 不变
    expect(st.hand.length).toBe(handBeforeItem);
    expect(st.log.filter((l) => l.includes('老秤'))).toHaveLength(1);

    // 下一回合再打旧物牌不再触发老秤
    st = endTurn(st).state;
    const secondItemIdx = st.hand.findIndex((n) => n === '守诺' || n === '旧书');
    if (secondItemIdx >= 0 && st.hand[secondItemIdx] === '守诺') {
      const beforeSecond = st.hand.length;
      st = playCard(st, secondItemIdx).state;
      expect(st.hand.length).toBe(beforeSecond - 1);
      expect(st.log.filter((l) => l.includes('老秤'))).toHaveLength(1);
    }

    // 新建一场战斗与 hookRegistry，计数器必须重置
    const hooks2 = createHeirloomHookRegistry(['old_scale']);
    let st2 = createBattle(
      ['守诺', '守诺', '守诺', '守诺', '秤砣', '秤砣'],
      'a',
      mulberry32(5),
      CARDS,
      DEMONS,
      { ...BALANCE, drawFirst: 4 },
      hooks2,
    );
    const beforeNewBattle = st2.hand.length;
    st2 = playCard(st2, 0).state;
    expect(st2.hand.length).toBe(beforeNewBattle);
    expect(st2.log.filter((l) => l.includes('老秤'))).toHaveLength(1);
  });

  it('4. 棉被 quilt：每夜开始恢复 3 点生命（封顶 30），createBattleWithEvents 透出 HEAL_APPLIED 事件', () => {
    const res = createBattleWithEvents(
      ['钢笔', '守诺', '旧书', '算盘', '暖水瓶'],
      'a',
      mulberry32(6),
      CARDS,
      DEMONS,
      BALANCE,
      createHeirloomHookRegistry(['quilt']),
      { initialPlayerHp: 20 },
    );
    expect(res.state.playerHp).toBe(23);
    expect(res.state.log.some((l) => l.includes('棉被') && l.includes('回血+3'))).toBe(true);
    expect(res.events).toContainEqual({
      type: 'HEAL_APPLIED',
      amount: 3,
      playerHpAfter: 23,
    });

    // 接近满血时封顶 30
    const capped = createBattleWithEvents(
      ['钢笔', '守诺', '旧书', '算盘', '暖水瓶'],
      'a',
      mulberry32(6),
      CARDS,
      DEMONS,
      BALANCE,
      createHeirloomHookRegistry(['quilt']),
      { initialPlayerHp: 29 },
    );
    expect(capped.state.playerHp).toBe(30);
    expect(capped.events).toContainEqual({
      type: 'HEAL_APPLIED',
      amount: 1,
      playerHpAfter: 30,
    });
  });

  it('5. 铜盘 copper_tray：回合末未花完的人情每点转 3 盾，0 人情不触发', () => {
    const hooks = createHeirloomHookRegistry(['copper_tray']);
    let st = createBattle(
      ['钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(7),
      CARDS,
      DEMONS,
      BALANCE,
      hooks,
    );
    // 打 1 张 1 费牌，剩 2 人情；铜盘转 6 盾，足够挡下心魔 A 的 3 伤
    st = playCard(st, 0).state;
    expect(st.renqing).toBe(2);
    const endRes = endTurn(st);
    st = endRes.state;
    expect(st.playerHp).toBe(30); // 6 盾全吸收 3 伤
    expect(st.log.some((l) => l.includes('铜盘') && l.includes('2人情换6盾'))).toBe(true);

    // R2 花光 3 点人情，回合末不触发铜盘
    st = playCard(st, 0).state;
    st = playCard(st, 0).state;
    st = playCard(st, 0).state;
    expect(st.renqing).toBe(0);
    const endR2 = endTurn(st);
    expect(endR2.state.log.filter((l) => l.includes('铜盘'))).toHaveLength(1);
    expect(endR2.state.playerHp).toBe(27); // 未花完人情为 0，吃 3 伤
  });

  it('6. 纸灯 paper_lantern：每回合打出的第一张牌额外抽 1 张，第二张不触发，下回合重置', () => {
    const hooks = createHeirloomHookRegistry(['paper_lantern']);
    let st = createBattle(
      ['钢笔', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(8),
      CARDS,
      DEMONS,
      { ...BALANCE, drawFirst: 3, drawPerRound: 2 },
      hooks,
    );

    expect(st.hand).toHaveLength(3);
    st = playCard(st, 0).state; // R1 第 1 张 -> -1 +1 = 3
    expect(st.hand).toHaveLength(3);
    st = playCard(st, 0).state; // R1 第 2 张 -> 不抽 = 2
    expect(st.hand).toHaveLength(2);

    st = endTurn(st).state; // R2 抽 2 -> 4
    expect(st.round).toBe(2);
    expect(st.hand).toHaveLength(4);
    st = playCard(st, 0).state; // R2 第 1 张 -> 再次触发纸灯 = 4
    expect(st.hand).toHaveLength(4);
    expect(st.log.filter((l) => l.includes('纸灯'))).toHaveLength(2);
  });

  it('7. 旧报纸 old_newspaper：每次当票弃牌得 3 点护盾', () => {
    const hooks = createHeirloomHookRegistry(['old_newspaper']);
    let st = createBattle(
      ['当票', '钢笔', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(9),
      CARDS,
      DEMONS,
      BALANCE,
      hooks,
    );

    const ticketIdx = st.hand.indexOf('当票');
    st = playCard(st, ticketIdx).state;
    expect(st.shield).toBe(0);
    st = resolvePendingChoice(st, 0).state;
    expect(st.shield).toBe(3);
    expect(st.log.some((l) => l.includes('旧报纸') && l.includes('弃牌护盾+3'))).toBe(true);
  });

  it('钩子不递归：金招牌护盾不触发铜盘，纸灯抽牌不触发老秤', () => {
    // 金招牌 + 铜盘：打出旧物牌获 1 盾时，不触发 turnEnd 铜盘
    const hooks1 = createHeirloomHookRegistry(['gold_signboard', 'copper_tray']);
    let st1 = createBattle(
      ['守诺', '钢笔', '钢笔', '钢笔', '钢笔'],
      'a',
      mulberry32(10),
      CARDS,
      DEMONS,
      BALANCE,
      hooks1,
    );
    st1 = playCard(st1, st1.hand.indexOf('守诺')).state;
    expect(st1.shield).toBe(6);
    expect(st1.renqing).toBe(2); // 3 - 1 = 2，未清零
    expect(st1.log.some((l) => l.includes('铜盘'))).toBe(false);

    // 纸灯 + 老秤：打出非旧物牌钢笔时，纸灯抽 1 张（抽到守诺）不得递归触发老秤
    const hooks2 = createHeirloomHookRegistry(['paper_lantern', 'old_scale']);
    // drawPile 顶部是 守诺（reverse/shuffle deterministic via 全部为 守诺 在牌堆）
    let st2 = createBattle(
      ['钢笔', '守诺', '守诺', '守诺', '守诺'],
      'a',
      mulberry32(11),
      CARDS,
      DEMONS,
      { ...BALANCE, drawFirst: 2 },
      hooks2,
    );
    // 保证手牌有钢笔且牌堆有守诺
    if (!st2.hand.includes('钢笔')) {
      st2 = { ...st2, hand: ['钢笔', '钢笔'], drawPile: ['守诺', '守诺', '守诺'] };
    }
    const handBefore = st2.hand.length;
    st2 = playCard(st2, st2.hand.indexOf('钢笔')).state;
    // 仅纸灯抽 1 张：手牌总数不变 (-1 +1)
    expect(st2.hand.length).toBe(handBefore);
    expect(st2.log.filter((l) => l.includes('纸灯'))).toHaveLength(1);
    expect(st2.log.some((l) => l.includes('老秤'))).toBe(false);
  });
});

describe('P12 阶段 C：校验、存档透传、奖励排除与上限管理', () => {
  it('validateHeirlooms 与 validateAllGameData 校验真实数据并拦截非法传家宝配置', () => {
    expect(validateHeirlooms(REAL_HEIRLOOMS).errors).toEqual([]);
    expect(validateAllGameData(CARDS, ITEMS, DEMONS, CHAPTERS, REAL_HEIRLOOMS).errors).toEqual([]);

    const broken: HeirloomDef[] = [
      ...REAL_HEIRLOOMS,
      {
        id: 'old_abacus', // duplicate id
        name: '重复算盘',
        shortLabel: '算', // duplicate shortLabel
        hook: 'unknownHook' as never,
        value: -2,
        effectText: '',
        story: '测试',
      },
    ];
    const res = validateHeirlooms(broken);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes('duplicate heirloom id'))).toBe(true);
    expect(res.errors.some((e) => e.includes('duplicate shortLabel'))).toBe(true);
    expect(res.errors.some((e) => e.includes('unknown hook'))).toBe(true);
    expect(res.errors.some((e) => e.includes('value must be a non-negative number'))).toBe(true);
    expect(res.errors.some((e) => e.includes('effectText must be a non-empty string'))).toBe(true);
  });

  it('validateChapters 允许 3-4 个第 4 天契约、拦截 5 个，且 street_favor 合法', () => {
    expect(VALID_PACT_IDS).toContain('street_favor');
    expect(isValidPactId('street_favor')).toBe(true);
    expect(validateChapters(CHAPTERS, DEMONS, ITEMS).valid).toBe(true);

    const threePacts: ChaptersDataFile = {
      chapters: [
        {
          ...CHAPTERS.chapters[0],
          day4Pacts: CHAPTERS.chapters[0].day4Pacts.slice(0, 3),
        },
      ],
    };
    expect(validateChapters(threePacts, DEMONS, ITEMS).valid).toBe(true);

    const fivePacts: ChaptersDataFile = {
      chapters: [
        {
          ...CHAPTERS.chapters[0],
          day4Pacts: [
            ...CHAPTERS.chapters[0].day4Pacts,
            { ...CHAPTERS.chapters[0].day4Pacts[0], id: 'steady_shop' },
          ],
        },
      ],
    };
    const res5 = validateChapters(fivePacts, DEMONS, ITEMS);
    expect(res5.valid).toBe(false);
    expect(res5.errors.some((e) => e.includes('day4Pacts must contain 3 to 4 pacts'))).toBe(true);
  });

  it('存档校验、老存档兼容、深拷贝、applyDayResult 四分支透传与第 4 契约', () => {
    const storage = createMemoryStorage();
    expect(SAVE_VERSION).toBe(3);

    // 1. 老 v3 存档缺 2 字段 -> 不判损坏、默认空数组
    const legacySave = createNewGame();
    const rawLegacy = JSON.parse(JSON.stringify(legacySave)) as Record<string, unknown>;
    delete (rawLegacy.chapter as Record<string, unknown>).heirlooms;
    delete (rawLegacy.chapter as Record<string, unknown>).heirloomMilestonesClaimed;
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(rawLegacy));
    const legacyLoaded = loadSaveDetailed(storage);
    expect(legacyLoaded.quarantinedCorrupt).toBe(false);
    expect(legacyLoaded.save?.chapter.heirlooms).toEqual([]);
    expect(legacyLoaded.save?.chapter.heirloomMilestonesClaimed).toEqual([]);

    // 2. 非法类型必须隔离损坏存档
    const badHeirlooms = {
      ...legacySave,
      chapter: { ...legacySave.chapter, heirlooms: [123] },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(badHeirlooms));
    expect(loadSaveDetailed(storage).quarantinedCorrupt).toBe(true);

    const badMilestones = {
      ...legacySave,
      chapter: { ...legacySave.chapter, heirloomMilestonesClaimed: ['2'] },
    };
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(badMilestones));
    expect(loadSaveDetailed(storage).quarantinedCorrupt).toBe(true);

    // 3. cloneChapterState 深拷贝不共享引用
    const ch = createInitialChapterState({
      heirlooms: ['old_abacus', 'quilt'],
      heirloomMilestonesClaimed: [2],
    });
    const cloned = cloneChapterState(ch);
    expect(cloned.heirlooms).toEqual(['old_abacus', 'quilt']);
    expect(cloned.heirlooms).not.toBe(ch.heirlooms);
    expect(cloned.heirloomMilestonesClaimed).not.toBe(ch.heirloomMilestonesClaimed);

    // 4. applyDayResult 四分支（普通胜/普通负/Boss胜/Boss负）透传不丢且不共享引用
    const day3Save: SaveData = {
      ...createNewGame(),
      day: 3,
      deck: ['钢笔', '守诺'],
      chapter: createInitialChapterState({
        dayInChapter: 3,
        heirlooms: ['old_abacus', 'gold_signboard'],
        heirloomMilestonesClaimed: [2, 4],
      }),
    };
    const branches = [
      applyDayResult(day3Save, {
        outcome: 'win',
        isBossBattle: false,
        endHp: 24,
        reward: { money: 40, cardName: '相机', redeemTicket: 1, allOwnedBonus: false },
      }),
      applyDayResult(day3Save, { outcome: 'lose', isBossBattle: false, endHp: 10 }),
      applyDayResult(day3Save, {
        outcome: 'win',
        isBossBattle: true,
        endHp: 18,
        reward: { money: 40, cardName: '相机', redeemTicket: 1, allOwnedBonus: false },
      }),
      applyDayResult(day3Save, { outcome: 'lose', isBossBattle: true, endHp: 0 }),
    ];
    for (const out of branches) {
      expect(out.chapter.heirlooms).toEqual(['old_abacus', 'gold_signboard']);
      expect(out.chapter.heirloomMilestonesClaimed).toEqual([2, 4]);
      expect(out.chapter.heirlooms).not.toBe(day3Save.chapter.heirlooms);
      expect(out.chapter.heirloomMilestonesClaimed).not.toBe(
        day3Save.chapter.heirloomMilestonesClaimed,
      );
    }

    // 5. 选择第 4 契约 street_favor 后存盘再读档不判损坏
    const day4Save = applyPactToSave(day3Save, 'street_favor');
    expect(day4Save.chapter.pactChoice).toBe('street_favor');
    expect(day4Save.money).toBe(day3Save.money);
    expect(day4Save.reputation).toBe(day3Save.reputation);
    storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(day4Save));
    const pactReloaded = loadSaveDetailed(storage);
    expect(pactReloaded.quarantinedCorrupt).toBe(false);
    expect(pactReloaded.save?.chapter.pactChoice).toBe('street_favor');
  });

  it('resolveWinReward 与 pickDailyItems 均不出传家宝', () => {
    const heirloomIds = new Set(HEIRLOOMS.map((h) => h.id));
    const heirloomNames = new Set(HEIRLOOMS.map((h) => h.name));

    for (let s = 1; s <= 100; s += 1) {
      const reward = resolveWinReward([], CARDS, BALANCE, mulberry32(s));
      if (reward.cardName) {
        expect(heirloomIds.has(reward.cardName)).toBe(false);
        expect(heirloomNames.has(reward.cardName)).toBe(false);
      }
    }

    for (let day = 1; day <= 7; day += 1) {
      for (let s = 1; s <= 20; s += 1) {
        const picked = pickDailyItems(ITEMS, day, mulberry32(s * 31 + day), 3);
        for (const item of picked) {
          expect(heirloomIds.has(item.id)).toBe(false);
          expect(heirloomNames.has(item.name)).toBe(false);
        }
      }
    }
  });

  it('口碑里程碑触发一次、持有上限 3 件与替换纯函数', () => {
    expect(getNewlyReachedMilestones(1, [])).toEqual([]);
    expect(getNewlyReachedMilestones(2, [])).toEqual([2]);
    expect(getNewlyReachedMilestones(2, [2])).toEqual([]);
    expect(getNewlyReachedMilestones(4, [2])).toEqual([4]);
    expect(getNewlyReachedMilestones(4, [])).toEqual([2, 4]);
    expect(getNewlyReachedMilestones(5, [2, 4])).toEqual([]);

    const picked = pickRandomUnownedHeirloom(['old_abacus', 'quilt'], mulberry32(1));
    expect(picked).not.toBeNull();
    expect(['old_abacus', 'quilt']).not.toContain(picked!.id);

    const added3 = addHeirloom(['old_abacus', 'quilt'], 'copper_tray', HEIRLOOM_CAP);
    expect(added3.added).toBe(true);
    expect(added3.needsReplace).toBe(false);
    expect(added3.heirlooms).toHaveLength(3);

    const overflow = addHeirloom(added3.heirlooms, 'paper_lantern', HEIRLOOM_CAP);
    expect(overflow.added).toBe(false);
    expect(overflow.needsReplace).toBe(true);
    expect(overflow.heirlooms).toHaveLength(3);

    const replaced = replaceHeirloomAtIndex(added3.heirlooms, 1, 'paper_lantern');
    expect(replaced).toEqual(['old_abacus', 'paper_lantern', 'copper_tray']);
    expect(added3.heirlooms).toEqual(['old_abacus', 'quilt', 'copper_tray']);
  });
});
