#!/usr/bin/env python3
"""
Generate a 1-bit pixel bitmap font JSON from Fusion Pixel Font 12px TTF.

Font source: https://github.com/TakWolf/fusion-pixel-font/releases/tag/2026.11.10
Release tag: 2026.11.10
Font file:   fusion-pixel-12px-monospaced-zh_hans.ttf (stored in /tmp during generation, not committed)
License:     SIL Open Font License 1.1 (OFL-1.1); see docs/fonts/OFL.txt & docs/ASSET_LEDGER.md

Usage:
    python3 scripts/generate-pixel-font.py --ttf /tmp/fusion-pixel-font/extracted/fusion-pixel-12px-monospaced-zh_hans.ttf
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont

FONT_NAME = "Fusion Pixel 12px"
DEFAULT_VERSION = "2026.11.10"
FONT_SIZE = 12
LINE_HEIGHT = 12
THRESHOLD = 128

# Always include printable ASCII + common CJK punctuation & UI symbols
# (omit U+2212 '−' which is missing in Fusion Pixel 12px and renders as .notdef box)
BASE_CHARS = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "，。、；：？！“”‘’（）【】《》「」『』·—…×±＋－／％￥"
    + "一二三四五六七八九十零第天回钱口碑牌组当客赢输负胜"
)

# Lexer regex that skips JS/TS comments first so apostrophes inside comments
# (e.g. "player's") never swallow subsequent Chinese string literals.
TS_TOKEN_RE = re.compile(
    r"//[^\n]*"
    r"|/\*[\s\S]*?\*/"
    r"|'((?:\\.|[^'\\\n])*)'"
    r'|"((?:\\.|[^"\\\n])*)"'
    r"|`((?:\\.|[^`\\])*)`",
)

TOFU_BOX_12 = ["111111111111"] + ["100000000001"] * 10 + ["111111111111"]


def extract_json_strings(obj: object, out: set[str]) -> None:
    if isinstance(obj, str):
        out.update(obj)
    elif isinstance(obj, list):
        for item in obj:
            extract_json_strings(item, out)
    elif isinstance(obj, dict):
        for value in obj.values():
            extract_json_strings(value, out)


def extract_ts_strings(source: str, out: set[str]) -> None:
    for match in TS_TOKEN_RE.finditer(source):
        single, double, template = match.groups()
        if single is not None:
            out.update(single.replace("\\n", "\n").replace("\\t", " "))
        elif double is not None:
            out.update(double.replace("\\n", "\n").replace("\\t", " "))
        elif template is not None:
            # Scan template text and recursively scan any nested string literals inside ${...}
            out.update(template.replace("\\n", "\n").replace("\\t", " "))
            extract_ts_strings(template, out)


def collect_characters(repo_root: Path) -> list[str]:
    chars: set[str] = set(BASE_CHARS)

    src_dir = repo_root / "src"
    data_dir = src_dir / "data"

    # 1. Scan src/data/*.json (excluding pixel-font.json itself)
    if data_dir.exists():
        for json_file in sorted(data_dir.glob("*.json")):
            if json_file.name == "pixel-font.json":
                continue
            with json_file.open("r", encoding="utf-8") as fh:
                extract_json_strings(json.load(fh), chars)

    # 2. Scan all src/**/*.ts string & template literals (skipping comments & pixelart.ts raw grids)
    for ts_file in sorted(src_dir.rglob("*.ts")):
        if ts_file.name == "pixelart.ts" and ts_file.parent == data_dir:
            continue
        content = ts_file.read_text(encoding="utf-8")
        extract_ts_strings(content, chars)

    # Keep only printable characters (exclude control chars like \n, \r, \t)
    filtered = [ch for ch in chars if ord(ch) >= 0x20 and ch != "\uFEFF"]
    return sorted(set(filtered), key=ord)


def render_glyph(font: ImageFont.FreeTypeFont, ch: str) -> dict[str, object]:
    raw_adv = font.getlength(ch)
    advance = max(1, int(round(raw_adv)))

    img = Image.new("L", (advance, FONT_SIZE), 0)
    draw = ImageDraw.Draw(img)
    draw.text((0, 0), ch, font=font, fill=255)

    rows: list[str] = []
    for y in range(FONT_SIZE):
        row = "".join("1" if img.getpixel((x, y)) > THRESHOLD else "0" for x in range(advance))
        rows.append(row)

    return {
        "advance": advance,
        "xoffset": 0,
        "yoffset": 0,
        "rows": rows,
    }


def generate_font_json(
    ttf_path: Path,
    chars: Iterable[str],
    version: str,
) -> dict[str, object]:
    font = ImageFont.truetype(str(ttf_path), FONT_SIZE)
    glyphs: dict[str, dict[str, object]] = {}
    tofu_chars: list[str] = []

    for ch in chars:
        glyph = render_glyph(font, ch)
        if glyph["rows"] == TOFU_BOX_12:
            tofu_chars.append(ch)
        glyphs[ch] = glyph

    if tofu_chars:
        raise ValueError(
            f"Font rendered .notdef tofu box for characters: {tofu_chars!r}. "
            "Replace unsupported symbols or provide a fallback glyph."
        )

    return {
        "font": FONT_NAME,
        "version": version,
        "size": FONT_SIZE,
        "lineHeight": LINE_HEIGHT,
        "glyphs": glyphs,
    }


def main() -> None:
    repo_root = Path(__file__).resolve().parent.parent
    parser = argparse.ArgumentParser(
        description="Generate src/data/pixel-font.json from Fusion Pixel 12px TTF."
    )
    parser.add_argument(
        "--ttf",
        required=True,
        type=Path,
        help="Path to fusion-pixel-12px-monospaced-zh_hans.ttf (e.g. in /tmp)",
    )
    parser.add_argument(
        "--version",
        default=DEFAULT_VERSION,
        help=f"Release tag of Fusion Pixel Font (default: {DEFAULT_VERSION})",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=repo_root / "src" / "data" / "pixel-font.json",
        help="Output JSON path (default: src/data/pixel-font.json)",
    )
    args = parser.parse_args()

    if not args.ttf.exists():
        raise FileNotFoundError(f"TTF not found: {args.ttf}")

    chars = collect_characters(repo_root)
    payload = generate_font_json(args.ttf, chars, args.version)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    args.output.write_text(text + "\n", encoding="utf-8")

    size_kb = len(text.encode("utf-8")) / 1024.0
    print(
        f"Generated {args.output} ({len(chars)} glyphs, {size_kb:.1f} KB, "
        f"version={args.version})"
    )


if __name__ == "__main__":
    main()
