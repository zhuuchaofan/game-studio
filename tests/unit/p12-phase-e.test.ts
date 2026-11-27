import { describe, expect, it } from 'vitest';
import chaptersJson from '../../src/data/chapters.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import { composeBoss, getBossDemonDef } from '../../src/game/bossComposition';
import type { ChaptersDataFile } from '../../src/game/chapters';
import type { DemonDef } from '../../src/game/effects';
import {
  countEligibleDailyItems,
  DAILY_CUSTOMER_COUNT,
  DAY1_GUARANTEED_DAMAGE_ITEM_IDS,
  isItemRedeemedInChapter,
  ITEMS,
  pickDailyItems,
  type PawnItem,
} from '../../src/game/pawnshop';
import { MIN_CHAPTER_ITEM_POOL_SIZE, validateChapters } from '../../src/game/validate';
import { mulberry32 } from '../../src/utils/rng';

const DEMONS = demonsJson as DemonDef[];
const REAL_ITEMS = itemsJson as PawnItem[];
const REAL_CHAPTERS = chaptersJson as ChaptersDataFile;

function getTier(
  item: PawnItem,
  ownedCards: ReadonlySet<string>,
  redeemedDayByItem: Readonly<Record<string, number>>,
): 1 | 2 | 3 {
  if (isItemRedeemedInChapter(item.id, redeemedDayByItem)) {
    return 3;
  }
  return ownedCards.has(item.cardName) ? 2 : 1;
}

describe('P12 阶段 E：D1/D2 硬版三档兜底、池校验与 Boss 方案 C', () => {
  it('D1-A：已赎旧物在本章内第 2..7 天均不再出现（跨越原 2 天冷却）', () => {
    const redeemedDayByItem = { ring: 2 };
    for (let s = 1; s <= 50; s += 1) {
      for (const day of [2, 3, 4, 5, 6, 7]) {
        const picked = pickDailyItems(ITEMS, day, mulberry32(s), 3, {
          deck: [],
          redeemedDayByItem,
        });
        expect(picked).toHaveLength(3);
        expect(picked.some((it) => it.id === 'ring')).toBe(false);
      }
    }
  });

  it('pickDailyItems 边界组合：全未拥有 / 全已拥有 / 全已赎回 / 混合组合恒取满 3 位且严格按三档排序', () => {
    const allCardNames = ITEMS.map((i) => i.cardName);
    const allRedeemed: Record<string, number> = Object.fromEntries(
      ITEMS.map((item, idx) => [item.id, (idx % 6) + 1]),
    );

    const boundaryCases: {
      label: string;
      day: number;
      deck: string[];
      redeemedDayByItem: Record<string, number>;
    }[] = [
      { label: '全未拥有', day: 2, deck: [], redeemedDayByItem: {} },
      { label: '全已拥有', day: 7, deck: allCardNames, redeemedDayByItem: {} },
      { label: '全已赎回', day: 7, deck: [], redeemedDayByItem: allRedeemed },
      {
        label: '10 已拥有 + 2 未拥有',
        day: 5,
        deck: ITEMS.slice(0, 10).map((i) => i.cardName),
        redeemedDayByItem: {},
      },
      {
        label: '11 已拥有 + 1 已赎回',
        day: 6,
        deck: ITEMS.slice(0, 11).map((i) => i.cardName),
        redeemedDayByItem: { [ITEMS[11].id]: 4 },
      },
      {
        label: '8 已拥有 + 4 已赎回（最坏第 7 天场景）',
        day: 7,
        deck: ITEMS.slice(0, 8).map((i) => i.cardName),
        redeemedDayByItem: {
          [ITEMS[8].id]: 2,
          [ITEMS[9].id]: 4,
          [ITEMS[10].id]: 5,
          [ITEMS[11].id]: 6,
        },
      },
      {
        label: '0 未拥有 + 2 已拥有 + 10 已赎回',
        day: 7,
        deck: ITEMS.slice(0, 2).map((i) => i.cardName),
        redeemedDayByItem: Object.fromEntries(ITEMS.slice(2).map((i, idx) => [i.id, idx + 1])),
      },
      {
        label: '已拥有与已赎回重叠（10 个既在牌库又记为已赎回 + 2 未拥有未赎回）',
        day: 6,
        deck: ITEMS.slice(0, 10).map((i) => i.cardName),
        redeemedDayByItem: Object.fromEntries(ITEMS.slice(0, 10).map((i, idx) => [i.id, idx + 1])),
      },
    ];

    for (const c of boundaryCases) {
      const owned = new Set(c.deck);
      for (const seed of [1, 7, 42, 99]) {
        const picked = pickDailyItems(ITEMS, c.day, mulberry32(seed), DAILY_CUSTOMER_COUNT, {
          deck: c.deck,
          redeemedDayByItem: c.redeemedDayByItem,
        });
        expect(picked, `${c.label} seed=${seed}`).toHaveLength(DAILY_CUSTOMER_COUNT);
        expect(new Set(picked.map((i) => i.id)).size, `${c.label} unique`).toBe(DAILY_CUSTOMER_COUNT);
        const tiers = picked.map((i) => getTier(i, owned, c.redeemedDayByItem));
        expect(tiers[0]).toBeLessThanOrEqual(tiers[1]);
        expect(tiers[1]).toBeLessThanOrEqual(tiers[2]);
      }
    }
  });

  it('pickDailyItems 300 组随机 (owned, redeemed) 组合恒取满 3 位且严格遵守三档优先级', () => {
    const rng = mulberry32(20261127);
    for (let trial = 0; trial < 300; trial += 1) {
      const deck: string[] = [];
      const redeemedDayByItem: Record<string, number> = {};
      for (const item of ITEMS) {
        if (rng() < 0.55) {
          deck.push(item.cardName);
        }
        if (rng() < 0.45) {
          redeemedDayByItem[item.id] = 1 + Math.floor(rng() * 6);
        }
      }
      const owned = new Set(deck);
      const day = 2 + Math.floor(rng() * 6);
      const picked = pickDailyItems(ITEMS, day, mulberry32(trial + 100), DAILY_CUSTOMER_COUNT, {
        deck,
        redeemedDayByItem,
      });
      expect(picked).toHaveLength(DAILY_CUSTOMER_COUNT);
      expect(new Set(picked.map((i) => i.id)).size).toBe(DAILY_CUSTOMER_COUNT);

      const tier1Total = countEligibleDailyItems(ITEMS, day, { deck, redeemedDayByItem });
      const tier2Total = ITEMS.filter(
        (i) => !isItemRedeemedInChapter(i.id, redeemedDayByItem) && owned.has(i.cardName),
      ).length;

      const tiers = picked.map((i) => getTier(i, owned, redeemedDayByItem));
      expect(tiers[0]).toBeLessThanOrEqual(tiers[1]);
      expect(tiers[1]).toBeLessThanOrEqual(tiers[2]);

      const expectedTier1 = Math.min(3, tier1Total);
      const expectedTier2 = Math.min(3 - expectedTier1, tier2Total);
      const expectedTier3 = 3 - expectedTier1 - expectedTier2;
      expect(tiers.filter((t) => t === 1)).toHaveLength(expectedTier1);
      expect(tiers.filter((t) => t === 2)).toHaveLength(expectedTier2);
      expect(tiers.filter((t) => t === 3)).toHaveLength(expectedTier3);
    }
  });

  it('第 3 档兜底按赎回日升序回流：最早赎回的先回，最近赎回的最后回', () => {
    // Only 1 unredeemed item (watch) -> Tier 3 must fill 2 slots from redeemed items by ascending redeemedDay
    const redeemedDayByItem: Record<string, number> = {
      ring: 6,
      old_book: 2,
      bicycle: 5,
      erhu: 1,
      stamp_album: 4,
      cloth_ticket: 3,
      harmonica: 6,
      medicine_box: 5,
      ledger: 4,
      tin_trunk: 3,
      gold_watch: 6,
    };

    for (let s = 1; s <= 20; s += 1) {
      const picked = pickDailyItems(ITEMS, 7, mulberry32(s), 3, {
        deck: [],
        redeemedDayByItem,
      });
      expect(picked).toHaveLength(3);
      expect(picked[0].id).toBe('watch');
      expect(picked[1].id).toBe('erhu'); // redeemed Day 1 (earliest)
      expect(picked[2].id).toBe('old_book'); // redeemed Day 2 (2nd earliest)
    }

    // All 12 redeemed on distinct/ordered days -> earliest 3 return first
    const allRedeemedDistinct: Record<string, number> = Object.fromEntries(
      ITEMS.map((item, idx) => [item.id, idx + 1]),
    );
    const pickedAllRedeemed = pickDailyItems(ITEMS, 7, mulberry32(77), 3, {
      deck: [],
      redeemedDayByItem: allRedeemedDistinct,
    });
    expect(pickedAllRedeemed.map((i) => i.id)).toEqual([
      ITEMS[0].id,
      ITEMS[1].id,
      ITEMS[2].id,
    ]);
  });

  it('validateChapters 新池子校验：去重后 >= 5 且兜底链恒满 3 位通过，去重后 < 5 失败', () => {
    expect(MIN_CHAPTER_ITEM_POOL_SIZE).toBe(5);
    expect(validateChapters(REAL_CHAPTERS, DEMONS, REAL_ITEMS).valid).toBe(true);

    // Exactly 5 unique items -> passes
    const fivePoolChapters: ChaptersDataFile = {
      chapters: [
        {
          ...REAL_CHAPTERS.chapters[0],
          itemPool: REAL_ITEMS.slice(0, 5).map((i) => i.id),
        },
      ],
    };
    expect(validateChapters(fivePoolChapters, DEMONS, REAL_ITEMS).valid).toBe(true);

    // 4 unique items -> fails
    const fourPoolChapters: ChaptersDataFile = {
      chapters: [
        {
          ...REAL_CHAPTERS.chapters[0],
          itemPool: REAL_ITEMS.slice(0, 4).map((i) => i.id),
        },
      ],
    };
    const res4 = validateChapters(fourPoolChapters, DEMONS, REAL_ITEMS);
    expect(res4.valid).toBe(false);
    expect(res4.errors.some((e) => e.includes('at least 5 unique items'))).toBe(true);

    // 5 entries with duplicate IDs (4 unique) -> fails
    const dupFourChapters: ChaptersDataFile = {
      chapters: [
        {
          ...REAL_CHAPTERS.chapters[0],
          itemPool: ['watch', 'watch', 'ring', 'old_book', 'bicycle'],
        },
      ],
    };
    const resDup = validateChapters(dupFourChapters, DEMONS, REAL_ITEMS);
    expect(resDup.valid).toBe(false);
    expect(resDup.errors.some((e) => e.includes('4 unique items'))).toBe(true);
  });

  it('Boss 方案 C：新 6 件 hpBonus=0 仅加效果，原 6 件 hpBonus=1，上限 36/40', () => {
    const baseBoss = getBossDemonDef(DEMONS);
    expect(baseBoss.composition!.maxCompositionHp).toBe(36);
    expect(baseBoss.composition!.absoluteMaxHp).toBe(40);

    const newIds = new Set([
      'cloth_ticket',
      'harmonica',
      'medicine_box',
      'ledger',
      'tin_trunk',
      'gold_watch',
    ]);
    for (const comp of baseBoss.composition!.components) {
      expect(comp.hpBonus).toBe(newIds.has(comp.itemId) ? 0 : 1);
    }

    const all12Deck = ITEMS.map((i) => i.cardName);
    const full = composeBoss(all12Deck, null, baseBoss);
    expect(full.componentCount).toBe(12);
    expect(full.finalHp).toBe(36);
    expect(full.hpCapped).toBe(false);
    expect(full.r1Shield).toBe(4);
    expect(full.chargeThreshold).toBe(13);

    const fullCredit = composeBoss(all12Deck, 'credit_stock', baseBoss);
    expect(fullCredit.rawTotalHp).toBe(42);
    expect(fullCredit.finalHp).toBe(40);
    expect(fullCredit.hpCapped).toBe(true);
  });

  it('Q12 第 1 天保底白名单包含 harmonica，且任意 seed 第 1 天至少包含白名单之一', () => {
    expect(DAY1_GUARANTEED_DAMAGE_ITEM_IDS).toEqual(['bicycle', 'erhu', 'harmonica']);

    // When harmonica is already in the first 3 shuffled slots (without bicycle/erhu), no replacement is forced
    const nonDamage = ITEMS.filter((i) => !DAY1_GUARANTEED_DAMAGE_ITEM_IDS.includes(i.id));
    const harmonica = ITEMS.find((i) => i.id === 'harmonica')!;
    const bicycle = ITEMS.find((i) => i.id === 'bicycle')!;
    const erhu = ITEMS.find((i) => i.id === 'erhu')!;
    // With rng returning 0.999999, Fisher-Yates keeps array order nearly identical
    const ordered = [nonDamage[0], nonDamage[1], harmonica, ...nonDamage.slice(2), bicycle, erhu];
    const picked = pickDailyItems(ordered, 1, () => 0.999999, DAILY_CUSTOMER_COUNT);
    expect(picked).toHaveLength(3);
    expect(picked.some((i) => i.id === 'harmonica')).toBe(true);
  });
});
