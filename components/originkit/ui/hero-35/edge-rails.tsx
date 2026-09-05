// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

/**
 * Ruled edge rails (Figma "Mask group" 2428:7759 / 7762 and their phone and
 * tablet twins).
 *
 * Figma ships these as a #d9d9d9 plate at 20% clipped by a texture PNG. Sampling
 * that PNG shows it is not a texture at all but a strict repeat: one 2px stripe
 * at full mask alpha, then a second at 30% alpha exactly half a period later.
 * So it rebuilds as one repeating-linear-gradient, which matters here because
 * the rails run the whole height of a min-h-dvh section — a stretched PNG mask
 * would re-pitch itself every time the viewport height changed, while the
 * gradient holds Figma's spacing at any height.
 *
 * The period is re-pitched per frame, not scaled: 23 / 29 / 40. Rail width and
 * the hairline on the inner edge follow the same three-value pattern.
 */
const STRIPES =
  "repeating-linear-gradient(to bottom, rgba(217,217,217,0.2) 0 var(--rail-line), transparent var(--rail-line) calc(var(--rail-pitch) / 2), rgba(217,217,217,0.06) calc(var(--rail-pitch) / 2) calc(var(--rail-pitch) / 2 + var(--rail-line)), transparent calc(var(--rail-pitch) / 2 + var(--rail-line)) var(--rail-pitch))";

const RAIL =
  "absolute inset-y-0 w-[42px] border-solid border-[rgba(255,255,255,0.20)] [--rail-line:1.5px] [--rail-pitch:23px] ipad:w-[52px] ipad:[--rail-pitch:29px] desktop-sm:w-[72px] desktop-sm:[--rail-line:2px] desktop-sm:[--rail-pitch:40px]";

export const EdgeRails = () => (
  <div
    aria-hidden
    className="pointer-events-none absolute inset-0 z-30 overflow-hidden"
  >
    <div
      className={`${RAIL} left-0 border-r-[0.875px] ipad:border-r-[1.083px] desktop-sm:border-r-[1px]`}
      style={{ backgroundImage: STRIPES }}
    />
    <div
      className={`${RAIL} right-0 border-l-[0.875px] ipad:border-l-[1.083px] desktop-sm:border-l-[1px]`}
      style={{ backgroundImage: STRIPES }}
    />
  </div>
);
