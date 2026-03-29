#!/usr/bin/env python3
#
# resize-logos.py — Generate all derived logo assets from the master logo.png.
#
# Single-source pattern: only the root logo.png (high-res RGBA) is maintained.
# This script produces all derived sizes for public/ and src/app/.
#
# Usage:
#   python3 scripts/resize-logos.py
#
# Requirements:
#   pip install Pillow

from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "logo.png"
PUBLIC = ROOT / "packages" / "web" / "public"
APP = ROOT / "packages" / "web" / "src" / "app"

BRAND_BG = (195, 150, 12)  # #C3960C — deep golden yellow from logo


def resize(img: Image.Image, size: int) -> Image.Image:
    """Resize to square, LANCZOS resampling, preserve RGBA."""
    return img.resize((size, size), Image.LANCZOS)


def make_opengraph(img: Image.Image) -> Image.Image:
    """Create 1200×630 OG image: brand background + centered logo at ~40% height."""
    width, height = 1200, 630
    canvas = Image.new("RGB", (width, height), BRAND_BG)

    logo_h = int(height * 0.4)  # ~40% of canvas height
    logo = resize(img, logo_h)

    # Convert RGBA logo to paste-able with alpha mask
    if logo.mode == "RGBA":
        # Paste onto canvas using alpha channel as mask
        x = (width - logo_h) // 2
        y = (height - logo_h) // 2
        canvas.paste(logo, (x, y), logo)
    else:
        x = (width - logo_h) // 2
        y = (height - logo_h) // 2
        canvas.paste(logo, (x, y))

    return canvas


def main() -> None:
    if not SOURCE.exists():
        raise FileNotFoundError(f"Master logo not found: {SOURCE}")

    img = Image.open(SOURCE).convert("RGBA")
    print(f"Source: {SOURCE} ({img.size[0]}×{img.size[1]}, {img.mode})")

    PUBLIC.mkdir(parents=True, exist_ok=True)
    APP.mkdir(parents=True, exist_ok=True)

    # ── public/ — component <img> references ──────────────────────
    # B-3 Basalt spec: logo-24.png (24×24) and logo-80.png (80×80).
    # logo-24.png:  sidebar icon & login header
    # logo-80.png:  login avatar & landing hero
    outputs: list[tuple[Path, Image.Image]] = []

    logo_24 = resize(img, 24)
    outputs.append((PUBLIC / "logo-24.png", logo_24))

    logo_80 = resize(img, 80)
    outputs.append((PUBLIC / "logo-80.png", logo_80))

    # ── src/app/ — Next.js file-based metadata convention ─────────
    icon_32 = resize(img, 32)
    outputs.append((APP / "icon.png", icon_32))

    apple_180 = resize(img, 180)
    outputs.append((APP / "apple-icon.png", apple_180))

    og = make_opengraph(img)
    outputs.append((APP / "opengraph-image.png", og))

    # Write PNG assets
    for path, asset in outputs:
        asset.save(path, format="PNG", optimize=True)
        w, h = asset.size
        print(f"  ✓ {path.relative_to(ROOT)}  ({w}×{h})")

    # ── favicon.ico — multi-size (16 + 32) ────────────────────────
    ico_16 = resize(img, 16)
    ico_32 = resize(img, 32)
    ico_path = APP / "favicon.ico"
    ico_16.save(ico_path, format="ICO", append_images=[ico_32], sizes=[(16, 16), (32, 32)])
    print(f"  ✓ {ico_path.relative_to(ROOT)}  (16+32 multi-size)")

    print(f"\nDone — {len(outputs) + 1} assets generated.")


if __name__ == "__main__":
    main()
