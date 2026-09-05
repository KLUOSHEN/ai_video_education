// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

/**
 * Shared stage geometry for hero-35.
 *
 * Everything in this section is measured from one of two lines: the inner edge
 * of the ruled rails, or the bottom of the nav band. Both are re-pitched per
 * frame rather than scaled, so they live here once instead of in the five files
 * that need them.
 */

/** Rail width — Figma 42 / 52 / 72 (2428:7662, 7710, 7759). */
export const RAIL_INSET =
  "left-[42px] right-[42px] ipad:left-[52px] ipad:right-[52px] desktop-sm:left-[72px] desktop-sm:right-[72px]";

/** Nav band height — Figma 56 / 79 / 96 (2428:7690, 7713, 7765). */
export const NAV_HEIGHT = "h-[56px] ipad:h-[79px] desktop-sm:h-[96px]";

/** The same three numbers as a top offset, for anything that hangs off the nav. */
export const NAV_BOTTOM = "top-[56px] ipad:top-[79px] desktop-sm:top-[96px]";

/**
 * Desktop content inset. Figma says a flat 134px, but the stage is fluid between
 * 1280 and 1440 while the hero row's two blocks are not: the 586px headline
 * column plus the 543px rocket box needs 1132px, which a 134px gutter only
 * clears from about 1400 up. The clamp holds Figma's 134 at 1440 and above,
 * opens to 74 at 1280, and floors at the 72px rail so copy can never slide
 * underneath it.
 */
export const DESKTOP_GUTTER =
  "desktop-sm:px-[clamp(72px,calc((100%-1132px)/2),134px)]";

/** Nav content inset — Figma 58 / 82 / 134 from the stage edge. */
export const GUTTER = `px-[58px] ipad:px-[82px] ${DESKTOP_GUTTER}`;

/**
 * Hero inset. The phone and tablet centre their column instead of hanging it off
 * a gutter, so these two only have to keep it clear of the rails — below 402px
 * the column compresses rather than running under them.
 */
export const HERO_GUTTER = `px-[42px] ipad:px-[52px] ${DESKTOP_GUTTER}`;

/**
 * Tracking is one ratio, not eleven numbers. Figma restates it per size
 * (-0.42/-0.66 on the headline, -0.42/-0.54 on the eyebrow, -0.45/-0.54 on the
 * buttons), but every pair works out to the same em value at its own size.
 */
export const TRACK_DISPLAY = "tracking-[-0.01em]";
export const TRACK_TIGHT = "tracking-[-0.02em]";
export const TRACK_UI = "tracking-[-0.03em]";
