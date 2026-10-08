"""Generates web/studio/textures/microcement.webp: an ORIGINAL, seamless, 1024px warm-grey microcement texture.

Procedural (no source photograph, so nothing to licence). Every layer is built from FFT-filtered noise, which is
periodic by construction, so the tile has no seam at any scale. Output is mid-grey with low contrast: it is meant to be
laid over a token colour with a blend mode, so one file serves light and dark.

    python3 scripts/art/microcement.py            # writes the webp
"""
import sys
import numpy as np
from PIL import Image

N = 1024
rng = np.random.default_rng(20261008)


def spectrum_noise(beta, aniso=(1.0, 1.0), cutoff=None):
    """Periodic noise with a 1/f^beta power spectrum; aniso stretches it along an axis (trowel marks)."""
    white = rng.standard_normal((N, N))
    f = np.fft.fft2(white)
    fy = np.fft.fftfreq(N)[:, None] * aniso[0]
    fx = np.fft.fftfreq(N)[None, :] * aniso[1]
    r = np.sqrt(fx * fx + fy * fy)
    r[0, 0] = 1.0
    filt = r ** (-beta / 2.0)
    filt[0, 0] = 0.0
    if cutoff is not None:
        filt *= np.exp(-((r / cutoff) ** 2))
    out = np.real(np.fft.ifft2(f * filt))
    out -= out.mean()
    return out / out.std()


def blur(a, sigma):
    f = np.fft.fft2(a)
    fy = np.fft.fftfreq(N)[:, None]
    fx = np.fft.fftfreq(N)[None, :]
    g = np.exp(-2 * (np.pi ** 2) * (sigma ** 2) * (fx * fx + fy * fy))
    return np.real(np.fft.ifft2(f * g))


cloud = spectrum_noise(2.4)                       # large soft mottling
mid = spectrum_noise(1.6)                         # medium patchiness
grain = spectrum_noise(0.6, cutoff=0.35)          # fine cement grain
trowel = spectrum_noise(2.0, aniso=(0.12, 1.0))   # long soft strokes, mostly horizontal
trowel2 = spectrum_noise(2.0, aniso=(1.0, 0.15))  # and a few vertical ones, weaker

pores = np.zeros((N, N))
ys = rng.integers(0, N, 2600)
xs = rng.integers(0, N, 2600)
pores[ys, xs] = rng.uniform(0.4, 1.0, 2600)
pores = blur(pores, 0.9)
pores /= pores.max()
flecks = np.zeros((N, N))
ys = rng.integers(0, N, 900)
xs = rng.integers(0, N, 900)
flecks[ys, xs] = rng.uniform(0.3, 1.0, 900)
flecks = blur(flecks, 0.7)
flecks /= flecks.max()

img = (
    0.55 * cloud
    + 0.30 * mid
    + 0.20 * trowel
    + 0.08 * trowel2
    + 0.26 * grain
)
img = img / img.std()
img = 128 + 13 * img - 46 * pores + 26 * flecks
img = np.clip(img, 0, 255)

Image.fromarray(img.astype(np.uint8), "L").save(
    sys.argv[1] if len(sys.argv) > 1 else "web/studio/textures/microcement.webp", "WEBP", quality=84, method=6
)
print("written", img.mean().round(1), img.std().round(1))
