// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import { NAV_BOTTOM, RAIL_INSET } from "@/components/originkit/ui/hero-35/stage";

function asset(file: string) {
  return `/originkit/hero-35/${file}`;
}

/**
 * The light the burst comes out of — Figma's "Star 22" glow (2452:7887), at
 * Figma's own numbers:
 *
 *   width 4381.478  height 4714.114  rotate 31.718deg
 *   blur 109.90972  opacity 0.59     plus-lighter
 *   fill conic-gradient(from 180deg at 44.21% 0.71%, …)
 *
 * All of it is literal. The layer is 4381px wide against a 1440 frame — three
 * times the frame — so what lands on screen is a corner of a very large star,
 * not a small one placed in the corner. That is the whole character of it: the
 * spikes converge to a point a few pixels across and the arms run out for
 * hundreds, which is why an earlier version scaled to a 380px box read as one
 * soft smear. Scaling the box and the blur together produces the same *image* at
 * a different size, and the size is exactly what was wrong.
 *
 * `mask-image` carries the star and `background-image` the fill, which is a
 * split Figma does not make — there the conic *is* the vector's fill. It is
 * forced by the export: Figma paints that fill through a `foreignObject`, and
 * browsers refuse to rasterise one when an SVG arrives as an image, so a
 * `public/` copy of the export draws nothing at all (the path itself is
 * `fill="none"`). Inlining the rig works but leans on `foreignObject` surviving
 * an SVG filter, which Safari has never been reliable about. Split this way the
 * asset is geometry alone and rasterises anywhere.
 *
 * The mask is Figma's *un-rotated* layer, so `rotate(31.718deg)` is Figma's own
 * transform rather than something folded into the path. The export bakes the
 * rotation in; turning it back out about the star's centre gives a bounding box
 * of 4381.479 x 4714.111, which is the width and height above to three decimals
 * — that agreement is what confirms this is the same layer and not a re-derived
 * lookalike.
 *
 * The blur has to sit outside the mask. CSS applies `filter` to an element
 * before its own mask, so blurring the masked element cuts the soft glow back to
 * a hard star edge; on a parent it acts on the masked result, the way Figma's
 * layer blur does. The rotation goes on that parent too — under it, the
 * conic's `44.21% 0.71%` origin would be measured in an already-turned box.
 *
 * Placement is the burst's origin: the corner where the right rail's inner edge
 * meets the nav rule, which is where `star-field.tsx` puts `centerX/centerY`.
 * The star centres there and nothing clips it, so it spills up across the nav
 * band, out past the rail and down into the hero. `z-[25]` keeps it over the
 * hero copy and the shuttle (`z-20`) and under the nav (`z-30`), whose wordmark
 * and CTA are the one thing additive white should not bleach.
 */
const CONIC =
  "conic-gradient(from 180deg at 44.21% 0.71%, #ffffff 0deg, rgba(255,255,255,0.25) 16.93223deg, rgba(255,255,255,0.2) 30.45614deg, rgba(255,255,255,0) 41.38300deg, rgba(255,255,255,0.2) 348.76824deg, rgba(255,255,255,0.8) 353.26102deg, rgba(255,255,255,0.5) 360deg)";

/** Figma's un-rotated star, geometry only. */
const STAR_MASK = `url(${asset("star-glow.svg")})`;

/**
 * Figma's box, centred on the burst's origin. The offsets are half of each side
 * — what `translate-x-1/2 -translate-y-1/2` would give — taken as margins so the
 * element's `transform` carries Figma's rotation and nothing else, and the
 * 31.718deg is legible as the one transform on it.
 */
const BOX = "h-[4714.114px] w-[4381.478px] mt-[-3257.057px] mr-[-3190.739px]";

export const StarGlow = () => (
  <div
    aria-hidden
    className={`pointer-events-none absolute bottom-0 z-[25] ${RAIL_INSET} ${NAV_BOTTOM}`}
  >
    <div
      className={`absolute top-0 right-0 ${BOX} rotate-[31.718deg] opacity-[0.59] mix-blend-plus-lighter`}
      style={{ filter: "blur(109.90972px)" }}
    >
      <div
        className="size-full"
        style={{
          backgroundImage: CONIC,
          maskImage: STAR_MASK,
          WebkitMaskImage: STAR_MASK,
          maskSize: "100% 100%",
          WebkitMaskSize: "100% 100%",
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
        }}
      />
    </div>
  </div>
);
