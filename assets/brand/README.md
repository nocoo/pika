# Pika brand assets

A charge held still. The exact existing transparent source bytes and native canvas are retained. No image-generation request was made; the before/after foregrounds deliberately match.

## Use by surface

| Surface | Asset | Treatment |
| --- | --- | --- |
| README / large gallery | `assets/brand/icon-rounded.png` | Selected rounded presentation at 128 px in README |
| Sidebar, both states | `packages/web/public/logo-24.png` | Exact retained foreground resized to 24 px; no mask |
| Browser favicon | `packages/web/public/favicon.png and favicon.ico` | Transparent 32 px PNG and decoded 16/32/48 ICO |
| Apple touch | `packages/web/public/apple-touch-icon.png` | Opaque square 180 px presentation |
| Social | `packages/web/public/opengraph-image.png` | Rounded presentation on a 1200 × 630 canvas |

Root `logo.png` is the canonical 2048 × 2048 transparent foreground. `assets/brand/icon.png` and `icon-rounded.png` preserve the independent square and rounded presentation. Small UI and browser marks use the foreground with its original proportions and alpha, without a background tile, glow, color filter or additional mask. Native app and touch icons follow their platform's separate masking contract.

## Rebuild and evidence

```sh
uv run --with pillow python scripts/resize-logos.py
```

Selected study `2026-09-07-01`, finishing `01`. Existing native margins are preserved exactly (26.5 px nearest rounded-outline clearance; no clipping). They are not retroactively changed to meet a new-drawing inset.

The presentation uses **Charge steps**, with base `#918451`, light `#c1b783`, shade `#5f542f` and motif `#463b20`. Geometry, fine grain and shallow shadows remain separate from the foreground; product UI colors remain independent. [source.json](source.json) records exact master checksums and the previous identity.

- [Individual before/after page](https://hexly.ai/logos/pika)
- [Complete artwork and finishing archive](https://github.com/nocoo/hexly.ai/tree/main/artwork/logo-family/pika/2026-09-07-01)
- [Local static review](https://index.dev.hexly.ai/artwork/logo-family/pika/2026-09-07-01/review.html)
- [Shared usage SOP](https://github.com/nocoo/hexly.ai/blob/main/docs/07-logo-usage-sop.md)
