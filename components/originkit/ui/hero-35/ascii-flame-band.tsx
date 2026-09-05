// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

"use client";

import AsciiFire from "@/components/originkit/ui/hero-35/ascii-flame";
import { RAIL_INSET } from "@/components/originkit/ui/hero-35/stage";

/**
 * ASCII fire along the bottom edge (Figma "image 3083614" / "3083615", plus the
 * wedge-masked "image 3083582" above them).
 *
 * Figma ships three baked crops of one render. Desktop splits the band into a
 * 790px and a 507px slice at different vertical offsets, which leaves a visible
 * seam at x861, and hangs a second copy above it clipped by a hand-drawn wedge
 * to fake extra sparse dots trailing up the right side. One live field replaces
 * all three: thinning upward is what the fire simulation does, so the wedge has
 * nothing left to describe — and it was a 1440-only shape that would not have
 * survived any other width.
 *
 * The band spans rail to rail in every frame (317 of 318 on the phone, 639 of
 * 640 on the tablet, 1297 of 1296 on desktop — Figma is a pixel out either way),
 * so it is expressed as the rail inset rather than as three widths.
 *
 * Glyph size is not a prop: the component draws at a fixed 10px monospace, which
 * measures 6px per column and 10.5px per row. Sampling the frames gives exactly
 * that pitch, so the band needs no scaling at any breakpoint.
 */
const BAND = `pointer-events-none absolute z-[2] h-[544px] bottom-[0px] ipad:bottom-0 desktop-sm:bottom-[0px] ${RAIL_INSET}`;

export const AsciiFlameBand = () => (
  <div aria-hidden className={BAND}>
    <AsciiFire
      /*
       * `intensity` and `decay` are read off the frames together, because they
       * set two different things and only move independently once both are
       * pinned.
       *
       * `decay` sets how far the ink reaches — it is subtracted from a cell's
       * heat per row, so the front dies at roughly `intensity / decay` rows up.
       * The component's 13 carries fire the full height of the band; Figma inks
       * roughly the bottom third, which across this box's ~52 rows means heat has
       * to fall to the palette floor inside about 15 of them, and 35 is what puts
       * it there.
       *
       * 28 instead: a fifth slower, so the front reaches about 19 rows — some
       * 50px more at the 10.5px row pitch. That is a deliberate departure from
       * the frames, which sit at 15; the band reads low against the shuttle at
       * the size it is drawn here. It is the one number to move for this, since
       * the box is already ~52 rows tall and a taller box only adds rows the fire
       * never reaches.
       *
       * `intensity` sets which glyph the base lands on. At 100 the bottom rows
       * sit near the top of the ramp and the band renders about twice Figma's
       * ink; 70 puts base heat near 0.55, which is where the frames sit.
       */
      decay={16}
      intensity={70}
      turbulence={30}
      windDirection="right"
      windForce={10}
      embers={false}
      sparks={false}
      pulse={false}
      /* The frames are white-on-black, not the component's default orange. */
      palette="mono"
      /*
       * `minimal` (" .:*#"), not the component's `dense`. The frames render the
       * band as dots and colons; the 65-glyph dense ramp puts a letter in every
       * cell above zero heat, which reads as a wall of text and roughly doubles
       * the field's apparent density because nothing ever blanks out.
       *
       * Embers and sparks are off for the same reason — both spawn glyphs that
       * drift clear of the flame front, and the frames have no loose specks
       * above the band.
       */
      charset="minimal"
      /*
       * Transparent, not #0a0a0a: Figma composites this over the star field, and
       * an opaque plate here would cut the streaks out of the bottom third.
       */
      backgroundColor="transparent"
      style={{ width: "100%", height: "100%" }}
    />
  </div>
);
