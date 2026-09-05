// Delivered by Originkit · stack: nextjs · styling: tailwind
"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { TRACK_UI } from "@/components/originkit/ui/hero-35/stage";

type ButtonVariant = "primary" | "ghost";

/**
 * Shared pressable / focus stack — house Button contract.
 * The outline is white because every surface this button lands on is #0a0a0a.
 */
const BASE_CLASS =
  "group relative inline-flex min-h-11 shrink-0 cursor-pointer touch-manipulation items-center justify-center gap-[10px] whitespace-nowrap font-rajdhani font-bold leading-[normal] text-white transition-[opacity,transform] duration-200 ease-out [-webkit-tap-highlight-color:transparent] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[0.97] motion-reduce:active:scale-100 [@media(hover:hover)_and_(pointer:fine)]:hover:opacity-90";

/**
 * Figma sizes the label box, not the button: 16/11 padding at 15px type on the
 * phone, 20/14 at 18px from the tablet up. `min-h-11` in BASE_CLASS lifts the
 * phone button from Figma's 41px to the 44px touch floor — the extra 3px is the
 * one place this deviates, and it moves nothing else on the page.
 */
const SIZE_CLASS = `px-[16px] py-[11px] text-[15px] ${TRACK_UI} ipad:px-[20px] ipad:py-[14px] ipad:text-[18px]`;

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-[rgba(255,255,255,0.1)]",
  ghost: "",
};

/**
 * Bracket corners (Figma 2428:7799–7802). Four 10px squares, each showing the
 * two borders that face out of the corner they sit in. Figma builds them as one
 * `border-r border-t` square rotated four ways; naming the sides directly is the
 * same pixels without the transforms.
 *
 * "Explore Missions" carries the identical four squares at opacity 0 — Figma's
 * way of keeping both buttons on one component. That zero is not a spare part:
 * it is the resting half of a hover, so the `ghost` variant renders the same
 * four and fades them to the primary's 0.5 on pointer-over. Nothing moves and
 * nothing is added on hover that the design does not already draw.
 *
 * `group-hover` is written bare rather than behind
 * `[@media(hover:hover)_and_(pointer:fine)]`. That gated form is used widely in
 * this repo but was measured emitting no rule at all, and a hover that compiles
 * to nothing is the thing being fixed here. Opacity-only, so a touch device
 * that latches :hover shows the brackets and nothing shifts.
 */
const CORNERS = [
  "top-0 left-0 border-l border-t",
  "top-0 right-0 border-r border-t",
  "bottom-0 left-0 border-l border-b",
  "bottom-0 right-0 border-r border-b",
] as const;

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

export const Button = ({
  variant = "primary",
  children,
  className = "",
  type = "button",
  ...props
}: ButtonProps) => (
  <button
    type={type}
    className={`${BASE_CLASS} ${SIZE_CLASS} ${VARIANT_CLASS[variant]} ${className}`}
    {...props}
  >
    {children}
    {CORNERS.map((corner) => (
      <span
        key={corner}
        aria-hidden
        className={`pointer-events-none absolute size-[10px] border-solid border-white transition-opacity duration-200 ease-out ${corner} ${
          variant === "primary"
            ? "opacity-50"
            : "opacity-0 group-hover:opacity-50"
        }`}
      />
    ))}
  </button>
);
