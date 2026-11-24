import type Phaser from 'phaser';

/**
 * 16 色主调色板索引表（0–F），严格对应 docs/ART_STYLE.md 定稿 v1.0。
 */
export const PIXEL_PALETTE: readonly string[] = [
  '#17120C', // 0 墨黑
  '#2E2118', // 1 深木
  '#5A3A22', // 2 木棕
  '#8A5A33', // 3 铜棕
  '#C9973F', // 4 黄铜
  '#E8B34B', // 5 灯黄
  '#F2E3C6', // 6 烛光
  '#FBF6E9', // 7 纸白
  '#10182B', // 8 夜黑
  '#1B2A4A', // 9 深蓝
  '#2E4A73', // A 夜蓝
  '#4E739E', // B 雾蓝
  '#8FA8C8', // C 银蓝
  '#B03A2E', // D 朱红
  '#4E7A5A', // E 玉绿
  '#D9A066', // F 旧纸
] as const;

export const MAX_COLORS_PER_SPRITE = 12;
export const SPRITE_SIZE = 32;

export interface PixelArtValidationResult {
  valid: boolean;
  errors: string[];
  colorCount: number;
  usedColors: string[];
}

/**
 * Maps a single palette character ('0'-'9', 'A'-'F', case-insensitive) to palette index 0..15,
 * or returns -1 for transparent ('.') and null for invalid characters.
 */
export function parsePaletteChar(ch: string): number | null {
  if (ch === '.') {
    return -1;
  }
  if (ch.length !== 1) {
    return null;
  }
  const code = ch.toUpperCase().charCodeAt(0);
  if (code >= 48 && code <= 57) {
    return code - 48; // '0'-'9'
  }
  if (code >= 65 && code <= 70) {
    return code - 55; // 'A'-'F' -> 10..15
  }
  return null;
}

/**
 * Pure validator for pixel art rows: checks dimensions, palette bounds, and <=12 color limit.
 */
export function validatePixelRows(
  rows: readonly string[],
  expectedSize = SPRITE_SIZE,
  palette: readonly string[] = PIXEL_PALETTE,
  maxColors = MAX_COLORS_PER_SPRITE,
): PixelArtValidationResult {
  const errors: string[] = [];
  const usedIndices = new Set<number>();

  if (rows.length !== expectedSize) {
    errors.push(`Expected ${expectedSize} rows, got ${rows.length}`);
  }

  for (let y = 0; y < rows.length; y += 1) {
    const row = rows[y];
    if (row.length !== expectedSize) {
      errors.push(`Row ${y} expected length ${expectedSize}, got ${row.length}`);
    }
    for (let x = 0; x < row.length; x += 1) {
      const idx = parsePaletteChar(row[x]);
      if (idx === null) {
        errors.push(`Invalid char '${row[x]}' at (${x}, ${y})`);
      } else if (idx >= 0) {
        if (idx >= palette.length) {
          errors.push(`Palette index ${idx} out of bounds at (${x}, ${y})`);
        } else {
          usedIndices.add(idx);
        }
      }
    }
  }

  if (usedIndices.size === 0) {
    errors.push('Sprite has no visible pixels');
  }

  if (usedIndices.size > maxColors) {
    errors.push(`Sprite uses ${usedIndices.size} colors, exceeding max ${maxColors}`);
  }

  const usedColors = [...usedIndices].sort((a, b) => a - b).map((i) => palette[i]);

  return {
    valid: errors.length === 0,
    errors,
    colorCount: usedIndices.size,
    usedColors,
  };
}

/**
 * Renders 32x32 palette-indexed rows onto an in-memory canvas and registers it as a Phaser texture.
 * Idempotent: skips generation if `key` already exists in `scene.textures`.
 */
export function pixelRowsToTexture(
  scene: Phaser.Scene,
  key: string,
  rows: readonly string[],
  palette: readonly string[] = PIXEL_PALETTE,
): string {
  if (scene.textures.exists(key)) {
    return key;
  }

  const validation = validatePixelRows(rows, rows.length, palette, palette.length);
  if (!validation.valid) {
    throw new Error(`Invalid pixel art for texture "${key}": ${validation.errors.join('; ')}`);
  }

  const height = rows.length;
  const width = rows[0]?.length ?? 0;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error(`Failed to acquire 2D context for pixel art "${key}"`);
  }

  ctx.clearRect(0, 0, width, height);

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const idx = parsePaletteChar(row[x]);
      if (idx !== null && idx >= 0) {
        ctx.fillStyle = palette[idx];
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  const texture = scene.textures.addCanvas(key, canvas);
  // Phaser.Textures.FilterMode.NEAREST === 1
  texture?.setFilter(1);
  return key;
}
