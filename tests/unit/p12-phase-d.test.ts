import { describe, expect, it } from 'vitest';
import cardsJson from '../../src/data/cards.json';
import chaptersJson from '../../src/data/chapters.json';
import collectionJson from '../../src/data/collection.json';
import heirloomsJson from '../../src/data/heirlooms.json';
import itemsJson from '../../src/data/items.json';
import {
  cloneChapterState,
  createInitialChapterState,
  type ChaptersDataFile,
} from '../../src/game/chapters';
import {
  COLLECTION_AFTERMATHS,
  computeCollectionCounts,
  DIARY_DECK_THRESHOLD,
  DIARY_REDEEM_THRESHOLD,
  evaluateDiaryFragmentUnlocks,
  getAftermathLine,
  getCardIdByName,
  getCollectibleCards,
  getDiaryFragments,
  getFirstSentence,
  recordCardSeen,
  recordDealCollection,
  recordRedemptionCollection,
  type CollectionDataFile,
} from '../../src/game/collection';
import type { CardDef } from '../../src/game/effects';
import type { HeirloomDef } from '../../src/game/heirlooms';
import {
  LEDGER_CLOSE_BUTTON,
  LEDGER_COLLECTION_CLIP_RECT,
  LEDGER_COLLECTION_SCROLL_DOWN_BUTTON,
  LEDGER_COLLECTION_SCROLL_UP_BUTTON,
  LEDGER_OVERLAY_RECT,
  LEDGER_TAB_BUTTONS,
  PAWNSHOP_CALENDAR_BUTTON,
  PAWNSHOP_HUD_HEIGHT,
  PAWNSHOP_LEDGER_BUTTON,
  PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON,
  PAWNSHOP_SUMMARY_LEDGER_BUTTON,
  PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON,
} from '../../src/game/layout';
import { buildLedgerSnapshot } from '../../src/game/ledgerOverlay';
import type { PawnItem } from '../../src/game/pawnshop';
import {
  applyDayResult,
  createNewGame,
  loadSaveDetailed,
  SAVE_STORAGE_KEY,
  SAVE_VERSION,
  saveGame,
  type SaveData,
  type StorageLike,
} from '../../src/game/save';
import { BASE_HEIGHT, BASE_WIDTH } from '../../src/utils/scale';

const CARDS = cardsJson as CardDef[];
const ITEMS = itemsJson as PawnItem[];
const HEIRLOOMS = heirloomsJson as HeirloomDef[];
const CHAPTERS_FILE = chaptersJson as ChaptersDataFile;
const COLLECTION_FILE = collectionJson as CollectionDataFile;

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

function rectsOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  const aLeft = a.x - a.width / 2;
  const aRight = a.x + a.width / 2;
  const aTop = a.y - a.height / 2;
  const aBottom = a.y + a.height / 2;

  const bLeft = b.x - b.width / 2;
  const bRight = b.x + b.width / 2;
  const bTop = b.y - b.height / 2;
  const bBottom = b.y + b.height / 2;

  return aLeft < bRight && aRight > bLeft && aTop < bBottom && aBottom > bTop;
}

describe('P12 阶段 D：12 条赎当后日谈映射', () => {
  it('覆盖全部 12 件旧物且逐字与 §5.2.3 表一致', () => {
    const expected: Record<string, string> = {
      watch: '父亲回来赎走了手表，说药费有着落了',
      ring: '新娘赎走了婚戒，说等的人回来了',
      old_book: '学生赎走了旧书，说考上了想回来看看',
      bicycle: '父亲赎走了自行车，说儿子回来就骑它',
      erhu: '拉琴的老人赎走了二胡，说弦还能再拉几年',
      stamp_album: '攒邮票的人赎走了册子，说最后一页满了',
      cloth_ticket: '布票赎走了，孩子的衣有着落了',
      harmonica: '工人赎走了口琴，说收了工还要用它',
      medicine_box: '药箱赎走了，救人的老头又背上它了',
      ledger: '账本赎走了，对门又开始记赊账了',
      tin_trunk: '铁皮箱赎走了，出门的人又把它背上了',
      gold_watch: '金表赎走了，当表的人说家里日子好起来了',
    };

    expect(ITEMS).toHaveLength(12);
    expect(Object.keys(COLLECTION_AFTERMATHS).sort()).toEqual(ITEMS.map((i) => i.id).sort());
    for (const [id, line] of Object.entries(expected)) {
      expect(getAftermathLine(id)).toBe(line);
      expect(COLLECTION_FILE.aftermaths[id]).toBe(line);
    }
    expect(getAftermathLine('non_existent_item')).toBeNull();
  });
});

describe('P12 阶段 D：收集持久化、六字段校验与透传', () => {
  it('createInitialChapterState 初始化为空数组且 cloneChapterState 深拷贝全部 6 个数组字段', () => {
    const initial = createInitialChapterState();
    expect(initial.heirlooms).toEqual([]);
    expect(initial.heirloomMilestonesClaimed).toEqual([]);
    expect(initial.seenItems).toEqual([]);
    expect(initial.seenCards).toEqual([]);
    expect(initial.redeemedItems).toEqual([]);
    expect(initial.diaryFragments).toEqual([]);

    const source = createInitialChapterState({
      heirlooms: ['old_abacus'],
      heirloomMilestonesClaimed: [2],
      seenItems: ['watch'],
      seenCards: ['rewind'],
      redeemedItems: ['watch'],
      diaryFragments: ['own_10_cards'],
    });
    const cloned = cloneChapterState(source);
    cloned.heirlooms!.push('quilt');
    cloned.heirloomMilestonesClaimed!.push(4);
    cloned.seenItems!.push('ring');
    cloned.seenCards!.push('promise');
    cloned.redeemedItems!.push('ring');
    cloned.diaryFragments!.push('first_clear');

    expect(source.heirlooms).toEqual(['old_abacus']);
    expect(source.heirloomMilestonesClaimed).toEqual([2]);
    expect(source.seenItems).toEqual(['watch']);
    expect(source.seenCards).toEqual(['rewind']);
    expect(source.redeemedItems).toEqual(['watch']);
    expect(source.diaryFragments).toEqual(['own_10_cards']);
  });

  it('老 v3 存档缺少 6 个可选字段时加载按空数组处理、不判损坏', () => {
    const storage = createMemoryStorage();
    const legacyV3 = createNewGame();
    const legacyChapter = { ...legacyV3.chapter } as Record<string, unknown>;
    delete legacyChapter.heirlooms;
    delete legacyChapter.heirloomMilestonesClaimed;
    delete legacyChapter.seenItems;
    delete legacyChapter.seenCards;
    delete legacyChapter.redeemedItems;
    delete legacyChapter.diaryFragments;

    storage.setItem(
      SAVE_STORAGE_KEY,
      JSON.stringify({ ...legacyV3, version: SAVE_VERSION, chapter: legacyChapter }),
    );
    const loaded = loadSaveDetailed(storage);
    expect(loaded.quarantinedCorrupt).toBe(false);
    expect(loaded.save).not.toBeNull();
    expect(loaded.save!.chapter.heirlooms).toEqual([]);
    expect(loaded.save!.chapter.heirloomMilestonesClaimed).toEqual([]);
    expect(loaded.save!.chapter.seenItems).toEqual([]);
    expect(loaded.save!.chapter.seenCards).toEqual([]);
    expect(loaded.save!.chapter.redeemedItems).toEqual([]);
    expect(loaded.save!.chapter.diaryFragments).toEqual([]);
  });

  it('isValidSaveData 严格校验 6 个字段，非法值判损坏并隔离', () => {
    const cases: { field: string; badValue: unknown }[] = [
      { field: 'heirlooms', badValue: 'old_abacus' },
      { field: 'heirlooms', badValue: [123] },
      { field: 'heirloomMilestonesClaimed', badValue: '2' },
      { field: 'heirloomMilestonesClaimed', badValue: ['2'] },
      { field: 'seenItems', badValue: { watch: true } },
      { field: 'seenItems', badValue: [null] },
      { field: 'seenCards', badValue: 42 },
      { field: 'seenCards', badValue: [false] },
      { field: 'redeemedItems', badValue: 'watch' },
      { field: 'redeemedItems', badValue: [1] },
      { field: 'diaryFragments', badValue: true },
      { field: 'diaryFragments', badValue: [{}] },
    ];

    for (const { field, badValue } of cases) {
      const storage = createMemoryStorage();
      const base = createNewGame();
      const raw = {
        ...base,
        chapter: {
          ...base.chapter,
          [field]: badValue,
        },
      };
      storage.setItem(SAVE_STORAGE_KEY, JSON.stringify(raw));
      const res = loadSaveDetailed(storage);
      expect(res.quarantinedCorrupt, `expected ${field} to be quarantined`).toBe(true);
      expect(res.save).toBeNull();
    }

    // 合法 6 字段可完整往返存档
    const okStorage = createMemoryStorage();
    const okSave = createNewGame();
    okSave.chapter.heirlooms = ['old_abacus'];
    okSave.chapter.heirloomMilestonesClaimed = [2];
    okSave.chapter.seenItems = ['watch', 'ring'];
    okSave.chapter.seenCards = ['rewind', 'promise'];
    okSave.chapter.redeemedItems = ['watch'];
    okSave.chapter.diaryFragments = ['own_10_cards'];
    saveGame(okSave, okStorage);
    const loadedOk = loadSaveDetailed(okStorage);
    expect(loadedOk.quarantinedCorrupt).toBe(false);
    expect(loadedOk.save?.chapter.heirlooms).toEqual(['old_abacus']);
    expect(loadedOk.save?.chapter.heirloomMilestonesClaimed).toEqual([2]);
    expect(loadedOk.save?.chapter.seenItems).toEqual(['watch', 'ring']);
    expect(loadedOk.save?.chapter.seenCards).toEqual(['rewind', 'promise']);
    expect(loadedOk.save?.chapter.redeemedItems).toEqual(['watch']);
    expect(loadedOk.save?.chapter.diaryFragments).toEqual(['own_10_cards']);
  });

  it('applyDayResult 四分支（普通胜/普通败/Boss胜/Boss败）透传全部 6 个字段不变', () => {
    const seededChapter = createInitialChapterState({
      dayInChapter: 3,
      heirlooms: ['old_abacus', 'quilt'],
      heirloomMilestonesClaimed: [2, 4],
      seenItems: ['watch', 'ring', 'erhu'],
      seenCards: ['rewind', 'promise', 'echo'],
      redeemedItems: ['watch'],
      diaryFragments: ['own_10_cards'],
    });

    const baseSave: SaveData = {
      ...createNewGame(),
      day: 3,
      deck: ['倒转', '守诺'],
      chapter: seededChapter,
    };

    const branches = [
      applyDayResult(baseSave, {
        outcome: 'win',
        reward: { money: 40, cardName: '钢笔', redeemTicket: 1, allOwnedBonus: false },
        isBossBattle: false,
        endHp: 22,
      }),
      applyDayResult(baseSave, {
        outcome: 'lose',
        reward: null,
        isBossBattle: false,
        endHp: 0,
      }),
      applyDayResult(
        { ...baseSave, day: 7, chapter: { ...cloneChapterState(seededChapter), dayInChapter: 7 } },
        {
          outcome: 'win',
          reward: { money: 40, cardName: '秤砣', redeemTicket: 1, allOwnedBonus: false },
          isBossBattle: true,
          endHp: 18,
        },
      ),
      applyDayResult(
        { ...baseSave, day: 7, chapter: { ...cloneChapterState(seededChapter), dayInChapter: 7 } },
        {
          outcome: 'lose',
          reward: null,
          isBossBattle: true,
          endHp: 0,
        },
      ),
    ];

    for (const after of branches) {
      expect(after.chapter.heirlooms).toEqual(['old_abacus', 'quilt']);
      expect(after.chapter.heirloomMilestonesClaimed).toEqual([2, 4]);
      expect(after.chapter.seenItems).toEqual(['watch', 'ring', 'erhu']);
      expect(after.chapter.seenCards).toEqual(['rewind', 'promise', 'echo']);
      expect(after.chapter.redeemedItems).toEqual(['watch']);
      expect(after.chapter.diaryFragments).toEqual(['own_10_cards']);
    }
  });
});

describe('P12 阶段 D：日记碎片解锁、收集写入与动态计数', () => {
  it('3 条日记碎片解锁条件与碎片(i)文案对齐 chapters.json diary.body 首句', () => {
    const fragments = getDiaryFragments();
    expect(fragments).toHaveLength(3);
    const ch1FirstSentence = getFirstSentence(CHAPTERS_FILE.chapters[0].diary.body);
    expect(ch1FirstSentence).toBe('腊月前的账总算平了');
    expect(fragments[0]).toEqual({ id: 'first_clear', text: ch1FirstSentence });
    expect(fragments[1]).toEqual({
      id: 'redeem_5_items',
      text: '赎出去的东西，总有人回来拿',
    });
    expect(fragments[2]).toEqual({
      id: 'own_10_cards',
      text: '柜子里的牌，越攒越好',
    });

    // 未达门槛时不解锁
    expect(
      evaluateDiaryFragmentUnlocks({
        chapter1Completed: false,
        redeemedItems: ['watch', 'ring', 'old_book', 'bicycle'],
        deckLength: DIARY_DECK_THRESHOLD - 1,
      }),
    ).toEqual([]);

    // 分别达标 & 重复触发不重复写入
    expect(
      evaluateDiaryFragmentUnlocks({
        chapter1Completed: true,
        redeemedItems: ['watch', 'ring', 'old_book', 'bicycle', 'erhu'],
        deckLength: DIARY_DECK_THRESHOLD,
        existingFragments: ['first_clear'],
      }),
    ).toEqual(['first_clear', 'redeem_5_items', 'own_10_cards']);

    // 去重校验：同一旧物多次赎回只算 1 件
    expect(
      evaluateDiaryFragmentUnlocks({
        chapter1Completed: false,
        redeemedItems: ['watch', 'watch', 'watch', 'watch', 'watch'],
        deckLength: 5,
      }),
    ).toEqual([]);
    expect(DIARY_REDEEM_THRESHOLD).toBe(5);
  });

  it('收集写入纯函数正确更新 seenItems/seenCards/redeemedItems 与碎片解锁', () => {
    let ch = createInitialChapterState();
    ch = recordDealCollection(ch, 'watch', '倒转', 1);
    expect(ch.seenItems).toEqual(['watch']);
    expect(ch.seenCards).toEqual(['rewind']);

    // 重复成交不重复追加
    ch = recordDealCollection(ch, 'watch', '倒转', 2);
    expect(ch.seenItems).toEqual(['watch']);
    expect(ch.seenCards).toEqual(['rewind']);

    // 欠条（unplayable）不进 seenCards
    expect(getCardIdByName('欠条')).toBeNull();
    ch = recordCardSeen(ch, '欠条');
    expect(ch.seenCards).toEqual(['rewind']);

    // 胜利奖励可收集牌计入 seenCards
    ch = recordCardSeen(ch, '钢笔');
    expect(ch.seenCards).toEqual(['rewind', 'fountain_pen']);

    // 满 10 张牌成交触发 own_10_cards
    ch = recordDealCollection(ch, 'gold_watch', '金表', 10);
    expect(ch.diaryFragments).toContain('own_10_cards');

    // 赎当写入 redeemedItems + seenItems，满 5 件触发 redeem_5_items
    for (const id of ['ring', 'old_book', 'bicycle', 'erhu']) {
      ch = recordRedemptionCollection(ch, id, 6);
    }
    expect(ch.diaryFragments).not.toContain('redeem_5_items');
    ch = recordRedemptionCollection(ch, 'stamp_album', 5);
    expect(ch.redeemedItems).toHaveLength(5);
    expect(ch.seenItems).toContain('stamp_album');
    expect(ch.diaryFragments).toContain('redeem_5_items');
  });

  it('收集计数动态排除不可出牌（29 张牌 = cards.filter(!unplayable).length）', () => {
    const collectible = getCollectibleCards(CARDS);
    expect(collectible).toHaveLength(CARDS.filter((c) => !c.unplayable).length);
    expect(collectible).toHaveLength(29);
    expect(collectible.some((c) => c.id === 'debt_note')).toBe(false);

    const counts = computeCollectionCounts(
      {
        seenItems: ['watch', 'ring', 'unknown_item'],
        seenCards: ['rewind', 'debt_note', 'gallop', 'echo'],
        heirlooms: ['old_abacus', 'quilt'],
      },
      ITEMS,
      CARDS,
      HEIRLOOMS,
    );
    expect(counts).toEqual({
      seenItemsCount: 2,
      totalItems: 12,
      seenCardsCount: 3,
      totalCards: 29,
      ownedHeirloomsCount: 2,
      totalHeirlooms: 7,
    });
  });

  it('账本快照与 HUD/结算/覆层布局坐标全部在 640×360 内且无重叠', () => {
    expect(LEDGER_OVERLAY_RECT).toEqual({ x: 320, y: 180, width: 552, height: 288 });
    expect(PAWNSHOP_LEDGER_BUTTON.y - PAWNSHOP_LEDGER_BUTTON.height / 2).toBeGreaterThanOrEqual(0);
    expect(PAWNSHOP_LEDGER_BUTTON.y + PAWNSHOP_LEDGER_BUTTON.height / 2).toBeLessThanOrEqual(
      PAWNSHOP_HUD_HEIGHT,
    );
    expect(rectsOverlap(PAWNSHOP_LEDGER_BUTTON, PAWNSHOP_CALENDAR_BUTTON)).toBe(false);

    expect(rectsOverlap(PAWNSHOP_SUMMARY_LEDGER_BUTTON, PAWNSHOP_SUMMARY_ENTER_NIGHT_BUTTON)).toBe(
      false,
    );
    expect(rectsOverlap(PAWNSHOP_SUMMARY_LEDGER_BUTTON, PAWNSHOP_SUMMARY_RETURN_TITLE_BUTTON)).toBe(
      false,
    );

    for (const r of [
      LEDGER_TAB_BUTTONS.deck,
      LEDGER_TAB_BUTTONS.heirlooms,
      LEDGER_TAB_BUTTONS.collection,
      LEDGER_CLOSE_BUTTON,
      LEDGER_COLLECTION_SCROLL_UP_BUTTON,
      LEDGER_COLLECTION_SCROLL_DOWN_BUTTON,
    ]) {
      expect(r.x - r.width / 2).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width / 2).toBeLessThanOrEqual(BASE_WIDTH);
      expect(r.y - r.height / 2).toBeGreaterThanOrEqual(0);
      expect(r.y + r.height / 2).toBeLessThanOrEqual(BASE_HEIGHT);
    }
    expect(rectsOverlap(LEDGER_TAB_BUTTONS.collection, LEDGER_CLOSE_BUTTON)).toBe(false);
    expect(LEDGER_COLLECTION_CLIP_RECT.x + LEDGER_COLLECTION_CLIP_RECT.width).toBeLessThan(
      LEDGER_COLLECTION_SCROLL_UP_BUTTON.x - LEDGER_COLLECTION_SCROLL_UP_BUTTON.width / 2,
    );

    const ch = createInitialChapterState({
      heirlooms: ['old_abacus'],
      seenItems: ['watch', 'ring'],
      seenCards: ['rewind', 'promise'],
      redeemedItems: ['watch'],
      diaryFragments: ['first_clear'],
    });
    const snap = buildLedgerSnapshot(true, 'collection', 0, {
      deck: ['倒转', '守诺', '余音', '飞驰', '旧书', '集邮', '布票', '口琴'],
      chapter: ch,
    });
    expect(snap.open).toBe(true);
    expect(snap.visibleDeckCardNames).toHaveLength(8);
    expect(snap.ownedHeirloomIds).toEqual(['old_abacus']);
    expect(snap.unownedHeirloomIds).toHaveLength(6);
    expect(snap.countBarText).toBe('收集 2/12 | 牌 2/29 | 老物件 1/7');
    expect(snap.visibleAftermaths).toEqual({ watch: '父亲回来赎走了手表，说药费有着落了' });
    expect(snap.diarySlots.map((s) => s.text)).toEqual([
      '腊月前的账总算平了',
      '未找到',
      '未找到',
    ]);
  });
});
