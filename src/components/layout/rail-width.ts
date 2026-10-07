/** Right-rail width rules (requirements 4.7.3, 4.7.5). Pure, so they test without layout. */

export const RAIL_DEFAULT_WIDTH = 300;
export const RAIL_MIN_WIDTH = 240;
/** The chat column keeps at least this much of the main content width. */
export const CHAT_MIN_WIDTH = 360;
export const RAIL_KEYBOARD_STEP = 16;

/** Widest the rail may get while leaving the chat its minimum; never below the rail minimum. */
export function railMaxWidth(contentWidth: number): number {
  return Math.max(RAIL_MIN_WIDTH, contentWidth - CHAT_MIN_WIDTH);
}

/** Clamp to [RAIL_MIN_WIDTH, railMaxWidth]. In a window too small for both, the minimum wins. */
export function clampRailWidth(width: number, contentWidth: number): number {
  return Math.min(Math.max(width, RAIL_MIN_WIDTH), railMaxWidth(contentWidth));
}

/** Width after a preview opens: half the main content if the rail is narrower, otherwise unchanged. */
export function widthOnOpen(width: number, contentWidth: number): number {
  const target = Math.floor(contentWidth / 2);
  return width < target ? clampRailWidth(target, contentWidth) : width;
}
