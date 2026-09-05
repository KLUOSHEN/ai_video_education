// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import { NAV_BOTTOM } from "@/components/originkit/ui/hero-35/stage";

function asset(file: string) {
  return `/originkit/hero-35/${file}`;
}

/**
 * Top-left light shard (Figma "Polygon 1" 2428:7754 / 7703 / 7657) — a small
 * white triangle under six stacked gaussian drop-shadows plus a 100px
 * foreground blur. That filter stack is the whole effect and it does not reduce
 * to a CSS wash, so it ships as the SVG; everything around it is CSS.
 *
 * Figma masks the glow with two opaque #0a0a0a rectangles: one the width of the
 * left rail, one the height of the nav band. Both exist only to cut the glow
 * off, and both leave a hard edge that is clearly visible in the frames. Here
 * the same two edges come from clipping this box to the nav's bottom and the
 * rail's inner edge, which is the same pixels without painting two black plates
 * over the background.
 *
 * The inner nesting is Figma's own: a 178x188 centring box, a 138.34deg
 * rotation, and the SVG hung off a 70.683x189 core at the percentage insets its
 * blur padding needs. Left and top are re-based by the rail width and the nav
 * height, since this box now starts at that corner rather than at the frame's:
 * Figma's (-58,-31) / (-85,-21.01) / (-35,-11) less (42,56) / (52,79) / (72,96).
 */
export const CornerGlow = () => (
  <div
    aria-hidden
    className={`pointer-events-none absolute right-0 bottom-0 left-[42px] z-0 overflow-hidden ipad:left-[52px] desktop-sm:left-[72px] ${NAV_BOTTOM}`}
  >
    <div className="absolute top-[-87px] left-[-100px] flex h-[188.19px] w-[178.433px] items-center justify-center ipad:top-[-100.01px] ipad:left-[-137px] desktop-sm:top-[-107px] desktop-sm:left-[-107px]">
      <div className="rotate-[138.34deg]">
        <div className="relative h-[189px] w-[70.683px]">
          {/*
            The inset belongs on a wrapper, with the image filling it. Putting
            both on one element lets `size-full` win over the inset and collapses
            the glow to the 70x189 core, which reads as a hard blob well right of
            the corner instead of a wash bleeding out of it.
          */}
          <div className="absolute inset-[-132.28%_-346.99%_-107.28%_-346.99%]">
            <img
              src={asset("corner-glow.svg")}
              alt=""
              className="block size-full max-w-none"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
);
