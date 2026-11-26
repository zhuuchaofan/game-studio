import { describe, expect, it } from 'vitest';
import cardsJson from '../../src/data/cards.json';
import demonsJson from '../../src/data/demons.json';
import itemsJson from '../../src/data/items.json';
import pixelFontJson from '../../src/data/pixel-font.json';
import { CARD_PIXEL_ART, DEMON_PIXEL_ART, ITEM_PIXEL_ART } from '../../src/data/pixelart';
import {
  MAX_COLORS_PER_SPRITE,
  parsePaletteChar,
  PIXEL_PALETTE,
  RENDERED_SPRITE_SIZE,
  SPRITE_PIXEL_SCALE,
  SPRITE_SIZE,
  validatePixelRows,
} from '../../src/game/pixelart';
import { TUTORIAL_SKIP_LABEL, TUTORIAL_STEPS } from '../../src/game/tutorial';

describe('Pixel art validation (30 cards + 12 items + 4 demons)', () => {
  it('validates helper functions and rejects malformed sprites', () => {
    expect(parsePaletteChar('.')).toBe(-1);
    expect(parsePaletteChar('0')).toBe(0);
    expect(parsePaletteChar('9')).toBe(9);
    expect(parsePaletteChar('A')).toBe(10);
    expect(parsePaletteChar('f')).toBe(15);
    expect(parsePaletteChar('G')).toBeNull();
    expect(parsePaletteChar(' ')).toBeNull();

    const wrongRows = validatePixelRows(['0'.repeat(32)]);
    expect(wrongRows.valid).toBe(false);

    const wrongCols = validatePixelRows(Array.from({ length: 32 }, () => '0'.repeat(31)));
    expect(wrongCols.valid).toBe(false);

    const badChar = validatePixelRows(
      Array.from({ length: 32 }, (_, idx) => (idx === 0 ? 'Z' + '0'.repeat(31) : '0'.repeat(32))),
    );
    expect(badChar.valid).toBe(false);

    const tooManyColors = validatePixelRows(
      Array.from({ length: 32 }, () => '0123456789ABCDEF' + '.'.repeat(16)),
    );
    expect(tooManyColors.valid).toBe(false);
    expect(tooManyColors.colorCount).toBe(16);

    expect(SPRITE_SIZE).toBe(32);
    expect(SPRITE_PIXEL_SCALE).toBe(2);
    expect(RENDERED_SPRITE_SIZE).toBe(64);
  });

  it('defines valid 32x32 16-color (<=12 colors) pixel art for all 30 cards in cards.json', () => {
    expect(cardsJson).toHaveLength(30);
    expect(Object.keys(CARD_PIXEL_ART)).toHaveLength(30);

    for (const card of cardsJson) {
      const sprite = CARD_PIXEL_ART[card.id];
      expect(sprite, `Missing pixel art for card "${card.id}" (${card.name})`).toBeDefined();

      const res = validatePixelRows(sprite, SPRITE_SIZE, PIXEL_PALETTE, MAX_COLORS_PER_SPRITE);
      expect(res.errors, `Card "${card.id}" validation errors`).toEqual([]);
      expect(res.valid).toBe(true);
      expect(res.colorCount).toBeLessThanOrEqual(MAX_COLORS_PER_SPRITE);
      expect(res.colorCount).toBeGreaterThanOrEqual(2);
    }
  });

  it('defines valid 32x32 16-color (<=12 colors) pixel art for all 12 pawnshop items in items.json', () => {
    expect(itemsJson).toHaveLength(12);
    expect(Object.keys(ITEM_PIXEL_ART)).toHaveLength(12);

    for (const item of itemsJson) {
      const sprite = ITEM_PIXEL_ART[item.id];
      expect(sprite, `Missing pixel art for item "${item.id}" (${item.name})`).toBeDefined();

      const res = validatePixelRows(sprite, SPRITE_SIZE, PIXEL_PALETTE, MAX_COLORS_PER_SPRITE);
      expect(res.errors, `Item "${item.id}" validation errors`).toEqual([]);
      expect(res.valid).toBe(true);
      expect(res.colorCount).toBeLessThanOrEqual(MAX_COLORS_PER_SPRITE);
    }
  });

  it('defines valid 32x32 16-color (<=12 colors) pixel art for all 5 demons (4 regular + Ch1 Boss) in demons.json', () => {
    expect(demonsJson).toHaveLength(5);
    expect(Object.keys(DEMON_PIXEL_ART)).toHaveLength(5);

    for (const demon of demonsJson) {
      const sprite = DEMON_PIXEL_ART[demon.id];
      expect(sprite, `Missing pixel art for demon "${demon.id}" (${demon.name})`).toBeDefined();

      const res = validatePixelRows(sprite, SPRITE_SIZE, PIXEL_PALETTE, MAX_COLORS_PER_SPRITE);
      expect(res.errors, `Demon "${demon.id}" validation errors`).toEqual([]);
      expect(res.valid).toBe(true);
      expect(res.colorCount).toBeLessThanOrEqual(MAX_COLORS_PER_SPRITE);
    }
  });
});

describe('Pixel bitmap font JSON coverage', () => {
  function collectStrings(value: unknown, out: string[]): void {
    if (typeof value === 'string') {
      out.push(value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        collectStrings(item, out);
      }
    } else if (value && typeof value === 'object') {
      for (const v of Object.values(value)) {
        collectStrings(v, out);
      }
    }
  }

  it('covers every character in cards.json, items.json, demons.json, and title/UI text', () => {
    const glyphs = pixelFontJson.glyphs as Record<string, { advance: number; rows: string[] }>;
    const allStrings: string[] = [
      'PAWN SHOP CARDS',
      '当铺纸牌',
      '开始',
      '继续',
      '新手局',
      '音量:开',
      '音量:关',
      TUTORIAL_SKIP_LABEL,
      '下一天',
      '返回标题',
      '进入夜里牌局',
      '结束回合',
      '赢了！',
      '心魔还在……',
      '白天结束',
      '跳过当客',
      '没有牌可打',
      '白天未收到旧物纸牌',
      '第 1 天 · 当铺 Lv.1',
      ...Object.values(TUTORIAL_STEPS).flatMap((step) => [
        step.label,
        step.continueLabel,
        ...step.lines,
      ]),
    ];

    collectStrings(cardsJson, allStrings);
    collectStrings(itemsJson, allStrings);
    collectStrings(demonsJson, allStrings);

    const missing = new Set<string>();
    for (const str of allStrings) {
      for (const ch of str) {
        if (ch === '\n' || ch === '\r') {
          continue;
        }
        if (!(ch in glyphs)) {
          missing.add(ch);
        }
      }
    }

    expect([...missing]).toEqual([]);
  });

  it('uses 12px binary 0/1 rows matching each glyph advance width', () => {
    expect(pixelFontJson.size).toBe(12);
    const glyphs = pixelFontJson.glyphs as Record<string, { advance: number; rows: string[] }>;
    expect(Object.keys(glyphs).length).toBeGreaterThan(200);

    for (const [ch, glyph] of Object.entries(glyphs)) {
      expect(glyph.rows, `Glyph "${ch}" row count`).toHaveLength(12);
      expect(glyph.advance, `Glyph "${ch}" advance`).toBeGreaterThan(0);
      for (const row of glyph.rows) {
        expect(row.length, `Glyph "${ch}" row width`).toBe(glyph.advance);
        expect(row).toMatch(/^[01]+$/);
      }
    }
  });
});
