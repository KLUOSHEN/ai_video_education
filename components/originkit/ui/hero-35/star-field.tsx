// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

"use client";

import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

import StarBurst from "@/components/originkit/ui/hero-35/starburst";
import { NAV_BOTTOM, RAIL_INSET } from "@/components/originkit/ui/hero-35/stage";

/**
 * Drifting light streaks (Figma "Star 22" 2428:7757 / 7706 / 7701).
 *
 * Figma bakes this as a 9.4MB PNG, so it is rebuilt with the live component.
 *
 * The burst originates at the top-right corner of the content area — where the
 * right rail's inner edge meets the nav rule — and fans down and left across the
 * section. `centerX`/`centerY` are percentages of this host and the component
 * clamps them to 0-100, so rather than compute a centre, the host *is* the
 * content area: rails on either side, nav rule on top, stage bottom below. Its
 * top-right corner is then the origin, which is what 100/0 means, and the box
 * needs no numbers of its own. Spoke length is the host's diagonal, so the rays
 * die exactly as they reach the far corner at any viewport size.
 *
 * The light those streaks come out of is the same Figma node but a separate
 * layer here — see `star-glow.tsx`, which paints on that corner at `z-30` while
 * the field stays at `z-[1]` under the copy.
 *
 * Taking Figma's rotation off the burst costs nothing — the spokes are radially
 * symmetric with seeded random phases.
 *
 * Blending is `plus-lighter` as in Figma, which also makes the component's
 * opaque black background a no-op instead of something to work around.
 */
const HOST = `pointer-events-none absolute bottom-0 z-[1] mix-blend-plus-lighter ${RAIL_INSET} ${NAV_BOTTOM}`;

export const StarField = () => {
  const reduceMotion = useReducedMotion();
  /*
   * The burst mounts after hydration, never during it. `useReducedMotion` reads
   * the media query on the client's first render but has nothing to read on the
   * server, so gating the component on it directly makes the two renders
   * disagree and React throws away the tree. Waiting a tick costs nothing here —
   * the canvas measures itself on mount either way.
   */
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <div aria-hidden className={HOST}>
      {mounted && !reduceMotion && (
        <StarBurst
          speed={10}
          starCount={66}
          color="#FFFFFF"
          centerX={100}
          centerY={0}
          starSize={2}
          opacity={50}
          /*
           * No bloom from the component. Figma does draw the burst's source in
           * this same node, but the component's version of it is sized off the
           * host's shorter side and kept deliberately contained — around 80px on
           * a host this wide, half of it off-frame, which is far too small and
           * dim to read as the light the streaks come from. It is painted by
           * `star-glow.tsx` instead, where it can be sized and z-ordered on its
           * own; leaving this above 0 would only put a second, weaker source
           * underneath it.
           */
          flowerIntensity={0}
          twinkleSpeed={4}
        />
      )}
    </div>
  );
};
