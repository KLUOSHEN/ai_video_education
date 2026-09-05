// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

"use client";

import AsciiImage from "@/components/originkit/ui/hero-35/ascii-reveal";

function asset(file: string) {
  return `/originkit/hero-35/${file}`;
}

/**
 * The shuttle, rendered as ASCII (Figma "image 3083579" — 2428:7810 / 7747 /
 * 7687).
 *
 * The shuttle is angled 48.1deg, but the canvas is not — the source image is
 * pre-rotated instead (`rocket-rotated.png`, generated from `rocket.png`) and
 * the canvas stays axis-aligned. That is what makes the hover reveal usable: the
 * component maps the pointer through getBoundingClientRect, which reports an
 * axis-aligned box, so under a CSS rotation the revealed blob lands rotated away
 * from the cursor. Rotating the pixels instead of the element keeps the pointer
 * maths exact. The cost is that the glyph rows run horizontally where Figma runs
 * them along the shuttle.
 *
 * Sizes follow from that. The canvas is the box the shuttle's own ink occupies
 * on screen once rotated — 374.24x352.56, and 0.5868 of that on the phone —
 * measured by rotating Figma's own ASCII render and taking its alpha bounds. It
 * has to be the rotated *ink*: the shuttle never filled its 520x546 canvas, so
 * turning that canvas corner-to-corner gives 498x480 and draws it a third too
 * big. Rotation about the centre preserves
 * the centre, so the anchor offsets are unchanged: the canvas is placed on its
 * Figma centre with `left/top-1/2` plus the offset from the box's own centre,
 * which keeps it put when the box is narrower than its Figma width.
 *
 *   phone  centred at (+16.71, -27.28) of a 318.62x213 box
 *   tablet centred at (+28.5, -46.5) of a 543x363 box
 *   desktop centred on the box itself, 1.5625x the tablet canvas
 *
 * Desktop drops the anchor offsets and sits on its box centre. Figma's offsets
 * are what place the shuttle against a 1440 frame, but this stage now runs to
 * 1920, and carried across they read as the shuttle hanging off-centre in its
 * own half of the row rather than as a considered placement. It is also 1.5625x
 * the tablet canvas — 1.25 applied twice: the ipad numbers held all the way up,
 * so on a wide screen the shuttle kept the size it has on a 744 frame and read
 * small against a hero that had grown around it, and one step of that was still
 * short of the weight the right half of the row wants.
 *
 * Only the canvas grows; the 679px box does not. The box is what the row
 * measures, and the two blocks in it (586 copy + 679) already exceed the content
 * width below about 1533, where flex shrinks both — widening it would take that
 * straight out of the headline column. At 584.75 the canvas still clears the
 * shrunk box at 1280, which is the narrowest width this layout runs at. The box
 * height follows the canvas instead, since height costs the row nothing.
 *
 * `columns` is a fixed count, not the usual count-from-a-fixed-pitch, and that
 * is deliberate: Figma scales one 1008px render to both sizes, so the column
 * count holds while the glyphs shrink with the box. Deriving from a pitch
 * instead would hold glyph size and drop the phone to ~85 columns, losing detail
 * the frames keep. Measured off Figma's render the count is 144; 200 draws the
 * shuttle finer than the frames do.
 *
 * Pointer events are the reason `reveal` behaves differently per frame, and the
 * split is deliberate. The rotated canvas takes a 754x752 bounding box, which on
 * the phone covers the two CTAs sitting above it and on desktop reaches up over
 * the nav. So the box stays inert until `desktop-sm`, where the only thing it
 * overlaps is the nav — and the nav is z-30 above it, so its button still takes
 * the click. That also puts the reveal exactly where it is useful: it is a
 * pointermove effect, so it has nothing to do on a touch frame.
 *
 * Caveat worth knowing: the component maps the pointer through
 * getBoundingClientRect, which reports the axis-aligned box and ignores the
 * 48.1deg rotation, so the revealed blob sits rotated away from the cursor —
 * close to the centre, further out toward the edges.
 */
const BOX =
  "pointer-events-none relative h-[213px] w-full max-w-[318.62px] ipad:h-[363px] ipad:w-[543px] ipad:max-w-none desktop-sm:h-[551px] desktop-sm:w-[679px] desktop-sm:pointer-events-auto ";

const CANVAS =
  "absolute top-1/2 left-1/2 mt-[-27.28px] h-[206.88px] w-[219.6px] -translate-x-1/2 -translate-y-1/2 ipad:mt-[-46.5px] ipad:h-[352.56px] ipad:w-[374.24px] desktop-sm:mt-0 desktop-sm:-ml-40 desktop-sm:h-[650.88px] desktop-sm:w-[684.75px]";

export const AsciiRocket = () => (
  <div className={BOX}>
    <div className={CANVAS}>
      <AsciiImage
        image={{
          src: asset("rocket-rotated.png"),
          alt: "A space shuttle drawn in ASCII characters, angled upward as if climbing",
        }}
        /*
         * `contain`, not the component's `cover`: rocket.png is 639x1000 against
         * a near-square box, so cover would crop the nose and the boosters.
         * Contain is also what Figma's render shows — the whole shuttle with
         * clear margin either side.
         */
        fit="contain"
        columns={200}
        ramp=" .:-=+*#%@"
        invert={false}
        contrast={100}
        colorMode="mono"
        inkColor="#FFFFFF"
        reveal={true}
        revealOptions={{
          size: 80,
          softness: 16,
        }}
      />
    </div>
  </div>
);
