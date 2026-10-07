import { describe, expect, it } from 'vitest';
import { CHAT_MIN_WIDTH, clampRailWidth, RAIL_MIN_WIDTH, railMaxWidth, widthOnOpen } from '../rail-width';

describe('railMaxWidth', () => {
  it('leaves the chat its minimum width', () => {
    expect(railMaxWidth(1000)).toBe(1000 - CHAT_MIN_WIDTH);
  });

  it('never drops below the rail minimum', () => {
    expect(railMaxWidth(500)).toBe(RAIL_MIN_WIDTH);
  });
});

describe('clampRailWidth', () => {
  it('keeps a width inside the bounds', () => {
    expect(clampRailWidth(400, 1000)).toBe(400);
  });

  it('raises a width below the minimum', () => {
    expect(clampRailWidth(100, 1000)).toBe(240);
  });

  it('lowers a width above the maximum', () => {
    expect(clampRailWidth(900, 1000)).toBe(640);
  });

  it('lets the minimum win when the window is too small', () => {
    expect(clampRailWidth(300, 540)).toBe(240);
  });

  it('treats an unmeasured container as the minimum', () => {
    expect(clampRailWidth(300, 0)).toBe(240);
  });
});

describe('widthOnOpen', () => {
  it('widens a narrower rail to half the main content', () => {
    expect(widthOnOpen(300, 1000)).toBe(500);
  });

  it('leaves a rail already at half unchanged', () => {
    expect(widthOnOpen(500, 1000)).toBe(500);
  });

  it('leaves a wider rail unchanged', () => {
    expect(widthOnOpen(600, 1000)).toBe(600);
  });

  it('rounds an odd half down', () => {
    expect(widthOnOpen(300, 1001)).toBe(500);
  });

  it('caps the target so the chat keeps its minimum', () => {
    expect(widthOnOpen(240, 600)).toBe(240);
  });
});
