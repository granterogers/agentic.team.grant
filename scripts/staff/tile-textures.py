#!/usr/bin/env python3
"""Make the generated textures tile, and make them weigh almost nothing.

    python3 scripts/staff/tile-textures.py

Issue #206. `npm run textures -- --go` writes 1024x1024 PNGs to
web/studio/textures/raw/. Those are photographs of a material: two to three
megabytes each, in colour, and not seamless. None of that is usable as a UI
overlay. This is the step in between.

## Seamless

The model will not produce a tileable image and cannot be asked to. The fix is
older than the model: roll the image by half its width and height, which moves
the four outer edges into a cross through the middle, then heal that cross by
blending a heavily blurred copy of the image across a feathered band. On an
organic material with no repeating structure the join disappears.

## Two files per material, and why that is not waste

A texture is INK, and the palette decides what colour ink is. `skins.css`
already has `--tex-ink`: near-black for the light palettes, near-white for the
dark ones, with a comment saying a texture must never be "a grey film over a
warm page".

So each material becomes two alpha-only images:

  <id>.webp        black, alpha from the material's SHADOWS      (light schemes)
  <id>-light.webp  white, alpha from the material's HIGHLIGHTS   (dark schemes)

Using only the shadows on a pale ground and only the highlights on a dark one
is how a material actually reads in each case — a lit surface shows its pits,
a dark one shows its raised grain. Half the information each, deliberately.

## Alpha, not luminance

Carried in the alpha channel rather than as a greyscale image used with
`mask-mode: luminance`, because alpha masking is what every browser does by
default and this project ships no build step to polyfill anything.
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

RAW = Path("web/studio/textures/raw")
OUT = Path("web/studio/textures")

# The tile the browser repeats. 384 rather than the model's 1024: at the sizes
# these are painted (90px on a button, 640px on the ground) the extra detail is
# never resolved, and it is seven times the bytes to carry it. Measured at 512
# and 384 and compared by eye at both — the difference is not visible under a
# 12% overlay, and it is 25 KB a material.
TILE = 384

# How much of the material's own contrast survives into the overlay.
#
# The material is normalised to its own standard deviation first, so a flat
# plaster and a busy travertine arrive at comparable strength — without that,
# the picker would offer six textures of which two are invisible and one is a
# rash. PEAK is then the strongest any pixel may be.
#
# The first pass used 0.38 and 0.30. The capture was a page with grey clouds
# smeared over it — Grant asked for "subtle, but beautiful" and it was neither.
# A material overlay lives at a few percent; anything you can point at and
# name as a texture is already too strong.
PEAK_DARK = 0.095
PEAK_LIGHT = 0.075
# Deviations beyond this many standard deviations are clipped rather than
# scaled, so one dark pit does not flatten the whole material.
CLIP_SIGMA = 2.4


def seamless(img: Image.Image) -> Image.Image:
    """Roll the seams into the middle, then blur them away."""
    w, h = img.size
    rolled = Image.fromarray(np.roll(np.array(img), (h // 2, w // 2), axis=(0, 1)))

    # A feathered cross over where the seams now are.
    band = max(8, w // 14)
    mask = Image.new("L", (w, h), 0)
    px = np.array(mask)
    px[h // 2 - band : h // 2 + band, :] = 255
    px[:, w // 2 - band : w // 2 + band] = 255
    mask = Image.fromarray(px).filter(ImageFilter.GaussianBlur(band / 2.2))

    healed = Image.composite(rolled.filter(ImageFilter.GaussianBlur(band / 2.6)), rolled, mask)
    return healed


def high_pass(grey: np.ndarray, radius: float) -> np.ndarray:
    """Keep the surface, drop the cloud.

    A photograph of plaster carries two things: the tooth of the material, and
    slow variation across the wall from how it was lit and how it was applied.
    Tiled behind a page the second one is not texture, it is a stain — the
    second capture of this work had grey patches drifting across the top of the
    screen and read as dirt.

    Subtracting a heavily blurred copy removes everything slower than the blur
    radius and leaves the material itself. It is the reason all six can sit at
    the same strength: what varies between them is now grain, not lighting.
    """
    blurred = np.array(
        Image.fromarray(grey.astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius)),
        dtype=np.float32,
    )
    return grey - blurred + float(grey.mean())


def ink(grey: np.ndarray, *, lighter: bool, peak: float) -> Image.Image:
    """One side of the material's deviation, as an alpha-only image."""
    d = grey - grey.mean()
    sigma = max(d.std(), 1e-6)
    d = np.clip(d / (sigma * CLIP_SIGMA), -1.0, 1.0)

    # Highlights for a dark scheme, shadows for a light one.
    side = np.clip(d if lighter else -d, 0.0, 1.0)

    alpha = (side * peak * 255).astype(np.uint8)
    value = 255 if lighter else 0
    rgba = np.zeros((*grey.shape, 4), dtype=np.uint8)
    rgba[..., 0:3] = value
    rgba[..., 3] = alpha
    return Image.fromarray(rgba, "RGBA")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for src in sorted(RAW.glob("*.png")):
        img = Image.open(src).convert("L").resize((TILE, TILE), Image.LANCZOS)
        grey = high_pass(np.array(seamless(img), dtype=np.float32), TILE / 7)

        for lighter, suffix, peak in ((False, "", PEAK_DARK), (True, "-light", PEAK_LIGHT)):
            out = OUT / f"{src.stem}{suffix}.webp"
            # `alpha_quality`, not `quality`. The RGB plane is one flat colour and
            # costs nothing whatever it is set to; the whole file is the alpha
            # channel, and only this dial moves it. Measured: 82 KB at
            # alpha_quality 100 against 30 KB at 45, with no visible difference
            # in a texture that is never painted above 14% opacity.
            ink(grey, lighter=lighter, peak=peak).save(
                out, "WEBP", quality=80, alpha_quality=45, method=6
            )
            size = out.stat().st_size
            total += size
            print(f"  {out.name:22} {size // 1024:4} KB")

    print(f"\n{total // 1024} KB in total for every material and both schemes")


if __name__ == "__main__":
    main()
