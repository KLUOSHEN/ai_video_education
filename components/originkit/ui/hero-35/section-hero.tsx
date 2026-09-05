// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import { AsciiFlameBand } from "@/components/originkit/ui/hero-35/ascii-flame-band";
import { AsciiRocket } from "@/components/originkit/ui/hero-35/ascii-rocket";
import { Button } from "@/components/originkit/ui/hero-35/button";
import { CornerGlow } from "@/components/originkit/ui/hero-35/corner-glow";
import { EdgeRails } from "@/components/originkit/ui/hero-35/edge-rails";
import { Navbar } from "@/components/originkit/ui/hero-35/navbar";
import { StarField } from "@/components/originkit/ui/hero-35/star-field";
import { StarGlow } from "@/components/originkit/ui/hero-35/star-glow";
import {
  HERO_GUTTER,
  NAV_BOTTOM,
  NAV_HEIGHT,
  RAIL_INSET,
  TRACK_DISPLAY,
  TRACK_UI,
} from "@/components/originkit/ui/hero-35/stage";

function asset(file: string) {
  return `/originkit/hero-35/${file}`;
}

/**
 * Figma frames:
 * - Mobile  2428:7656 — 402 x 874
 * - iPad    2428:7702 — 744 x 1133  (`ipad:`)
 * - Desktop 2428:7750 — 1440 x 802  (`desktop-sm:`)
 *
 * A space-intelligence hero built from three live ASCII/canvas fields: a shuttle
 * rendered as ASCII, a wall of ASCII fire along the bottom edge, and a burst of
 * light streaks thrown from a point far off the top-right corner. Figma ships
 * all three as flattened exports — 9.4MB for the star field alone — so each one
 * is re-derived from the numbers the frames imply rather than re-exported. The
 * reasoning for each lives in its own file.
 *
 * Two lines hold the whole layout together, and both are re-pitched per frame
 * rather than scaled (see `stage.ts`): the inner edge of the ruled rails, and
 * the bottom of the nav band.
 *
 * The stage runs the full viewport width rather than capping at Figma's 402 /
 * 744 / 1440. The rails are the frame edge in the design, so capping the stage
 * would strand them mid-screen with dead background outside; running full width
 * keeps them on the viewport edge at every size. Everything inside is anchored
 * to those rails or to the gutter, both of which are relative, so the frames
 * still reproduce at their own widths.
 *
 * Height is decided, not inherited. Every frame height is a floor — the stage
 * takes `max(frame, 100dvh)` so the rails, the star field and the fire band
 * reach the bottom of any screen and never leave bare page under the section.
 *
 * The hero hangs off the nav with `mt` at every width (61 / 44 / 36), same
 * convention on desktop as on the stacked frames. The fire band alone stays
 * bottom-anchored; a taller viewport opens sky between the row and the fire,
 * which is where the star field already is.
 *
 * Paint order follows Figma with one deliberate exception. Figma stacks the fire
 * band *above* the hero copy; at 802 that is harmless because the field's upper
 * tail is sparse, but the band is bottom-anchored and would climb behind the
 * headline as the viewport grew. It sits under the content here instead.
 */

/** Nav rule — Figma's "Line 1222" is a plain 1px #333333 stroke, rail to rail. */
const NAV_RULE = `pointer-events-none absolute z-[3] h-px bg-[#333333] ${NAV_BOTTOM} ${RAIL_INSET}`;

/**
 * The phone lifts its nav band to #101010; the tablet and desktop bands are
 * #0a0a0a, which is the page, so only the phone needs painting. It sits at z-0
 * because Figma throws the star field over the band and under the nav's text.
 */
const NAV_BAND_FILL = `pointer-events-none absolute top-0 z-0 bg-[#101010] ipad:hidden ${NAV_HEIGHT} ${RAIL_INSET}`;

export const SectionHero = () => (
  <main className="animate-hero-reveal relative isolate w-full overflow-hidden bg-[#0a0a0a]">
    {/* The stage caps at 1920 and centres. Past that the rails would keep
          walking outward and the hero row's two blocks drift apart with them;
          1920 is where the design stops reading as one composition. */}
    <div className="relative mx-auto min-h-[max(874px,100dvh)] w-full ipad:min-h-[max(1133px,100dvh)] desktop-sm:min-h-[max(802px,100dvh)] desktop-sm:max-w-[1920px]">
      <CornerGlow />
      <div aria-hidden className={NAV_BAND_FILL} />
      <StarField />
      <AsciiFlameBand />
      <div aria-hidden className={NAV_RULE} />

      <Navbar />

      {/*
        Hero. One tree for all three frames: the phone and tablet stack it as a
        centred column with the shuttle below the CTAs, desktop turns the same
        column into a row and sends the shuttle to the right.

        Vertical gap under the nav is `mt` at every width — 61 / 44 / 36 — so
        desktop follows the same convention as the stacked frames instead of
        hanging off a bottom offset that only matched Figma's centre at 802.
      */}
      <div
        className={`relative z-20 mt-[61px] flex w-full flex-col items-center justify-center gap-[58px] ${HERO_GUTTER} ipad:mt-[44px] ipad:gap-[66px] desktop-sm:mt-[136px] desktop-sm:flex-row desktop-sm:items-center desktop-sm:justify-between desktop-sm:gap-0`}
      >
        <div className="flex w-full flex-col items-center gap-[32px] desktop-sm:w-[586px] desktop-sm:items-start">
          <div className="flex flex-col items-center gap-[12px] desktop-sm:items-start">
            <div className="flex items-center gap-[6px]">
              <img
                src={asset("planet.svg")}
                alt=""
                aria-hidden
                className="block size-[18px] max-w-none ipad:size-[24px]"
              />
              <span
                className={`font-orbit text-[14px] leading-[normal] ${TRACK_UI} whitespace-nowrap text-white ipad:text-[18px]`}
              >
                AI LEARNING STUDIO
              </span>
            </div>

            {/*
              No `text-balance`: the column width is what sets the break, and it
              breaks differently on purpose — after "Next" on the phone and
              tablet, after "Space" on desktop. Balancing collapses both to the
              same silhouette.
            */}
            <h1
              className={`max-w-[284px] text-center font-instrument-serif text-[42px] leading-[1.2] ${TRACK_DISPLAY} text-white ipad:max-w-[502px] ipad:text-[66px] desktop-sm:max-w-[586px] desktop-sm:text-left`}
            >
              栈知映
            </h1>

            {/*
              No `text-pretty` either: it pulls a word down to avoid a short last
              line, which moves Figma's break from after "satellite" to after
              "AI-powered" at every frame. The measured width already breaks it
              where Figma does.
            */}
            <p
              className={`max-w-[274px] text-center font-tight text-[16px] leading-[27px] ${TRACK_UI} text-white opacity-70 ipad:max-w-[453px] ipad:text-[18px] desktop-sm:text-left`}
            >
              以 AI 光影，筑程序学习之路
            </p>

            <p
              className={`max-w-[274px] text-center font-tight text-[14px] leading-[25px] ${TRACK_UI} text-white opacity-55 ipad:max-w-[453px] ipad:text-[16px] ipad:leading-[28px] desktop-sm:text-left`}
            >
              从知识搜索出发，生成可观看的 AI 视频课堂；再以测评、学习诊断、职业技能树与学习论坛，让每一次探索沉淀为清晰的成长路径。
            </p>

            <p
              className={`font-orbit text-[13px] leading-[normal] ${TRACK_UI} whitespace-nowrap text-white opacity-80 ipad:text-[16px]`}
            >
              搜索 · 生成 · 测评 · 技能树 · 社区
            </p>
          </div>

          {/*
            `flex-wrap` is not in Figma — the pair measures 278px against 318px
            of phone content, which stops clearing below about 360px wide.
          */}
          <div className="flex flex-wrap items-start justify-center gap-[20px] desktop-sm:justify-start">
            <Button onClick={() => (window.location.href = "/search.html")}>
              立即试用
            </Button>
          </div>
        </div>

        <AsciiRocket />
      </div>

      <EdgeRails />
      {/*
        Last, and unclipped: the burst's source paints over the copy and the
        shuttle in its corner, and spills across the nav band and past the rail
        rather than stopping on either line. It sits under the nav itself, which
        is the one thing additive white should not touch.
      */}
      <StarGlow />
    </div>
  </main>
);
