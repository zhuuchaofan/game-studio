import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildBitmapFontData,
  computeAtlasLayout,
  PIXEL_FONT_DATA,
  type PixelFontJson,
} from '../../src/game/pixelFont';

describe('pixelFont pure layout & Phaser BitmapFontData builder', () => {
  it('packs glyphs with 0 spacing and wraps rows when exceeding maxRowWidth', () => {
    const sample: PixelFontJson = {
      font: 'Test Pixel 12px',
      version: 'test',
      size: 12,
      lineHeight: 12,
      glyphs: {
        A: { advance: 6, xoffset: 0, yoffset: 0, rows: Array.from({ length: 12 }, () => '001100') },
        B: { advance: 6, xoffset: 0, yoffset: 0, rows: Array.from({ length: 12 }, () => '111110') },
        当: {
          advance: 12,
          xoffset: 0,
          yoffset: 0,
          rows: Array.from({ length: 12 }, () => '000011110000'),
        },
      },
    };

    // With maxRowWidth = 12, A (6) + B (6) fit on row 0, and '当' (12) wraps to row 1 (y = 12)
    const layout = computeAtlasLayout(sample, 12);
    expect(layout.width).toBe(12);
    expect(layout.height).toBe(24);
    expect(layout.placements).toHaveLength(3);

    const a = layout.placements.find((p) => p.char === 'A')!;
    const b = layout.placements.find((p) => p.char === 'B')!;
    const dang = layout.placements.find((p) => p.char === '当')!;

    expect({ x: a.x, y: a.y, width: a.width, height: a.height }).toEqual({
      x: 0,
      y: 0,
      width: 6,
      height: 12,
    });
    expect({ x: b.x, y: b.y, width: b.width, height: b.height }).toEqual({
      x: 6,
      y: 0,
      width: 6,
      height: 12,
    });
    expect({ x: dang.x, y: dang.y, width: dang.width, height: dang.height }).toEqual({
      x: 0,
      y: 12,
      width: 12,
      height: 12,
    });

    const fontData = buildBitmapFontData(sample, layout);
    expect(fontData.font).toBe('Test Pixel 12px');
    expect(fontData.size).toBe(12);
    expect(fontData.lineHeight).toBe(12);
    expect(fontData.retroFont).toBe(false);

    const charA = fontData.chars['A'.charCodeAt(0)];
    expect(charA.x).toBe(0);
    expect(charA.y).toBe(0);
    expect(charA.width).toBe(6);
    expect(charA.height).toBe(12);
    expect(charA.xAdvance).toBe(6);
    expect(charA.xOffset).toBe(0);
    expect(charA.yOffset).toBe(0);
    expect(charA.u0).toBe(0);
    expect(charA.u1).toBe(0.5);
    expect(charA.v0).toBe(0);
    expect(charA.v1).toBe(0.5);

    const charDang = fontData.chars['当'.charCodeAt(0)];
    expect(charDang.x).toBe(0);
    expect(charDang.y).toBe(12);
    expect(charDang.xAdvance).toBe(12);
    expect(charDang.u0).toBe(0);
    expect(charDang.u1).toBe(1);
    expect(charDang.v0).toBe(0.5);
    expect(charDang.v1).toBe(1);
  });

  it('builds valid Phaser BitmapFontData for the real pixel-font.json dataset', () => {
    const layout = computeAtlasLayout(PIXEL_FONT_DATA);
    const data = buildBitmapFontData(PIXEL_FONT_DATA, layout);

    expect(data.size).toBe(12);
    expect(data.chars['P'.charCodeAt(0)]?.xAdvance).toBe(6);
    expect(data.chars['当'.charCodeAt(0)]?.xAdvance).toBe(12);
    expect(Object.keys(data.chars).length).toBe(Object.keys(PIXEL_FONT_DATA.glyphs).length);
  });

  it('covers every Chinese character across src/data/*.json, src/scenes/*.ts, and src/game/*.ts with zero tofu boxes (A1)', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const dataDir = path.join(repoRoot, 'src', 'data');
    const scanDirs = [path.join(repoRoot, 'src', 'scenes'), path.join(repoRoot, 'src', 'game')];

    const hanzi = new Set<string>();
    const cjkRe = /[\u4e00-\u9fff]/g;

    // 1. Extract all Hanzi from every src/data/*.json (except pixel-font.json)
    const collectJson = (val: unknown): void => {
      if (typeof val === 'string') {
        for (const match of val.matchAll(cjkRe)) {
          hanzi.add(match[0]);
        }
      } else if (Array.isArray(val)) {
        for (const item of val) {
          collectJson(item);
        }
      } else if (val && typeof val === 'object') {
        for (const v of Object.values(val)) {
          collectJson(v);
        }
      }
    };

    for (const file of fs.readdirSync(dataDir)) {
      if (!file.endsWith('.json') || file === 'pixel-font.json') {
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      collectJson(parsed);
    }

    // 2. Extract all Hanzi from string & template literals in src/scenes/*.ts & src/game/*.ts (skip comments)
    const tsTokenRe =
      /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;

    const collectTs = (source: string): void => {
      for (const m of source.matchAll(tsTokenRe)) {
        const lit = m[1] ?? m[2] ?? m[3];
        if (lit === undefined) {
          continue;
        }
        for (const ch of lit.matchAll(cjkRe)) {
          hanzi.add(ch[0]);
        }
      }
    };

    for (const dir of scanDirs) {
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.ts')) {
          continue;
        }
        collectTs(fs.readFileSync(path.join(dir, file), 'utf8'));
      }
    }

    // 3. Explicitly verify C5's 8 narrative sentences are included
    const c5Lines = [
      '这个月的药费单，又来了。',
      '远行的车票攥在手里，舍不得放。',
      '房东在门口敲了三下。',
      '开学的日子，越来越近了。',
      '今晚，药费被扛过去了。当了手表的父亲，能睡个安稳觉了。',
      '今晚，车票被扛过去了。当了婚戒的新娘，离回家又近了一步。',
      '今晚，房租被扛过去了。当了旧书的学生，不用再为下个月发愁了。',
      '今晚，学费被扛过去了。骑永久自行车送儿子的父亲，值了。',
    ];
    for (const line of c5Lines) {
      for (const ch of line.matchAll(cjkRe)) {
        hanzi.add(ch[0]);
      }
    }

    expect(hanzi.size).toBeGreaterThan(250);

    const tofuRows = [
      '111111111111',
      ...Array.from({ length: 10 }, () => '100000000001'),
      '111111111111',
    ];

    const missing: string[] = [];
    const tofu: string[] = [];
    const blank: string[] = [];

    for (const ch of [...hanzi].sort()) {
      const glyph = PIXEL_FONT_DATA.glyphs[ch];
      if (!glyph) {
        missing.push(ch);
        continue;
      }
      if (glyph.rows.length === 12 && glyph.rows.every((r, i) => r === tofuRows[i])) {
        tofu.push(ch);
      }
      const inkPixels = glyph.rows.reduce((acc, r) => acc + (r.match(/1/g)?.length ?? 0), 0);
      if (inkPixels === 0) {
        blank.push(ch);
      }
    }

    expect(missing, `Missing Hanzi in pixel-font.json: ${missing.join('')}`).toEqual([]);
    expect(tofu, `Tofu box glyphs in pixel-font.json: ${tofu.join('')}`).toEqual([]);
    expect(blank, `Blank glyphs in pixel-font.json: ${blank.join('')}`).toEqual([]);

    // Also verify NO glyph anywhere in pixel-font.json is a 12x12 .notdef tofu box
    const allTofu = Object.entries(PIXEL_FONT_DATA.glyphs)
      .filter(([, g]) => g.rows.length === 12 && g.rows.every((r, i) => r === tofuRows[i]))
      .map(([ch]) => ch);
    expect(allTofu).toEqual([]);
  });
});
