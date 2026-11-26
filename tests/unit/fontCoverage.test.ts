import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PIXEL_FONT_DATA } from '../../src/game/pixelFont';

/**
 * Full character coverage guardrail ported from `scripts/generate-pixel-font.py` (`collect_characters`).
 *
 * Known blind spots (documented per §7.4):
 * 1. Does NOT scan `index.html` (DOM overlay uses system fonts, never BitmapText).
 * 2. Does NOT scan `docs/*.md` or `tests/**` (only runtime source under `src/`).
 * 3. Dynamic concatenation (e.g. `'第' + n + '天'`) is safe because ASCII digits/printable symbols
 *    are covered by `BASE_CHARS` and static string fragments are scanned directly.
 * 4. If future copy is extracted into a new JSON file or directory outside `src/data/*.json` and
 *    TypeScript sources under `src/`, update `collectCharactersFromSource` accordingly.
 */

const BASE_CHARS =
  Array.from({ length: 0x7f - 0x20 }, (_, i) => String.fromCharCode(0x20 + i)).join('') +
  '，。、；：？！“”‘’（）【】《》「」『』·—…×±＋－／％￥' +
  '一二三四五六七八九十零第天回钱口碑牌组当客赢输负胜';

const TS_TOKEN_RE =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|'((?:\\.|[^'\\\n])*)'|"((?:\\.|[^"\\\n])*)"|`((?:\\.|[^`\\])*)`/g;

const TOFU_BOX_12 = [
  '111111111111',
  ...Array.from({ length: 10 }, () => '100000000001'),
  '111111111111',
];

function extractJsonStrings(val: unknown, out: Set<string>): void {
  if (typeof val === 'string') {
    for (const ch of val) {
      out.add(ch);
    }
  } else if (Array.isArray(val)) {
    for (const item of val) {
      extractJsonStrings(item, out);
    }
  } else if (val && typeof val === 'object') {
    for (const v of Object.values(val)) {
      extractJsonStrings(v, out);
    }
  }
}

function unescapeBasic(raw: string): string {
  return raw.replace(/\\n/g, '\n').replace(/\\t/g, ' ');
}

function extractTsStrings(source: string, out: Set<string>): void {
  for (const match of source.matchAll(TS_TOKEN_RE)) {
    const [, single, double, template] = match;
    if (single !== undefined) {
      for (const ch of unescapeBasic(single)) {
        out.add(ch);
      }
    } else if (double !== undefined) {
      for (const ch of unescapeBasic(double)) {
        out.add(ch);
      }
    } else if (template !== undefined) {
      for (const ch of unescapeBasic(template)) {
        out.add(ch);
      }
      // Recursively scan nested string literals inside ${...}
      extractTsStrings(template, out);
    }
  }
}

function walkTsFiles(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
}

function collectCharactersFromSource(repoRoot: PathLikeString): string[] {
  const chars = new Set<string>(BASE_CHARS);
  const srcDir = path.join(repoRoot, 'src');
  const dataDir = path.join(srcDir, 'data');

  if (fs.existsSync(dataDir)) {
    for (const file of fs.readdirSync(dataDir).sort()) {
      if (!file.endsWith('.json') || file === 'pixel-font.json') {
        continue;
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
      extractJsonStrings(parsed, chars);
    }
  }

  const tsFiles: string[] = [];
  walkTsFiles(srcDir, tsFiles);
  tsFiles.sort();
  for (const tsFile of tsFiles) {
    if (tsFile === path.join(dataDir, 'pixelart.ts')) {
      continue;
    }
    extractTsStrings(fs.readFileSync(tsFile, 'utf8'), chars);
  }

  return [...chars]
    .filter((ch) => ch.charCodeAt(0) >= 0x20 && ch !== '\uFEFF')
    .sort((a, b) => a.charCodeAt(0) - b.charCodeAt(0));
}

type PathLikeString = string;

describe('Pixel font full coverage guardrail (§7.4)', () => {
  it('ensures every printable character in src/data/*.json and src/**/*.ts exists in pixel-font.json without tofu boxes', () => {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const collected = collectCharactersFromSource(repoRoot);
    expect(collected.length).toBeGreaterThan(700);

    const missing: string[] = [];
    const tofu: string[] = [];
    for (const ch of collected) {
      const glyph = PIXEL_FONT_DATA.glyphs[ch];
      if (!glyph) {
        missing.push(ch);
        continue;
      }
      if (glyph.rows.length === 12 && glyph.rows.every((r, idx) => r === TOFU_BOX_12[idx])) {
        tofu.push(ch);
      }
    }

    expect(missing, `Missing characters in pixel-font.json: ${missing.join(' ')}`).toEqual([]);
    expect(tofu, `Tofu box glyphs found in pixel-font.json: ${tofu.join(' ')}`).toEqual([]);
  });
});
