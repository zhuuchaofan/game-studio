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
});
