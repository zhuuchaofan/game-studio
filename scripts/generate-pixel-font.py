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
BASE_CHARS = (
    "".join(chr(c) for c in range(0x20, 0x7F))
    + "，。、；：？！“”‘’（）【】《》「」『』·—…×±−＋－／％￥"
    + "一二三四五六七八九十零第天回钱口碑牌组当客赢输负胜"
)

TS_STRING_RE = re.compile(
    r"""'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"|`((?:\\.|[^`\\])*)`""",
    re.DOTALL,
)


def extract_json_strings(obj: object, out: set[str]) -> None:
    if isinstance(obj, str):
        out.update(obj)
    elif isinstance(obj, list):
        for item in obj:
            extract_json_strings(item, out)
    elif isinstance(obj, dict):
        for value in obj.values():
            extract_json_strings(value, out)


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

    # 2. Scan all src/**/*.ts string literals (excluding pixelart.ts raw grid literals)
    for ts_file in sorted(src_dir.rglob("*.ts")):
        if ts_file.name == "pixelart.ts" and ts_file.parent == data_dir:
            continue
        content = ts_file.read_text(encoding="utf-8")
        for match in TS_STRING_RE.finditer(content):
            literal = next((g for g in match.groups() if g is not None), "")
            # Strip simple escape markers without corrupting CJK text
            literal = literal.replace("\\n", "\n").replace("\\t", " ")
            chars.update(literal)

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
    for ch in chars:
        glyphs[ch] = render_glyph(font, ch)

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
