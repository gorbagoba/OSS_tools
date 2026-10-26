import { test, expect } from '@playwright/test';
import { refineMask } from '../src/lib/maskRefine';

// Node-context unit tests for the mask refinement used by background removal.
// No page needed: refineMask is pure TypeScript (no DOM).

test.describe('refineMask', () => {
  test('grow: dilates the boundary one pixel into the background', () => {
    const out = refineMask([0, 0, 255, 255, 255], 5, 1, { grow: 1, feather: 0, alphaBoost: 1 });
    expect(Array.from(out)).toEqual([0, 1, 1, 1, 1]);
  });

  test('feather: gaussian-blurs the boundary', () => {
    const out = refineMask([0, 255, 0], 3, 1, { grow: 0, feather: 1, alphaBoost: 1 });
    expect(out[0]).toBeCloseTo(0.27407, 3);
    expect(out[1]).toBeCloseTo(0.45186, 3);
    expect(out[2]).toBeCloseTo(0.27407, 3);
  });

  test('alphaBoost: lifts mid alpha and clamps at 1', () => {
    const out = refineMask([0, 127, 255], 3, 1, { grow: 0, feather: 0, alphaBoost: 1.12 });
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(0.5578, 3);
    expect(out[2]).toBe(1);
  });

  test('uses channel 0 for interleaved RGBA input', () => {
    // 2x2 RGBA: channel 0 is a checkerboard, other channels are junk
    const data = [255, 9, 9, 9, 0, 9, 9, 9, 0, 9, 9, 9, 255, 9, 9, 9];
    const out = refineMask(data, 2, 2, { grow: 0, feather: 0, alphaBoost: 1 });
    expect(Array.from(out)).toEqual([1, 0, 0, 1]);
  });

  test('1x1 masks survive default options', () => {
    expect(Array.from(refineMask([255], 1, 1))).toEqual([1]);
    expect(Array.from(refineMask([0], 1, 1))).toEqual([0]);
  });

  test('2D: vertical bar grows on both sides, not beyond', () => {
    const width = 8;
    const height = 8;
    const data = new Array(width * height).fill(0);
    for (let y = 0; y < height; y += 1) {
      data[y * width + 3] = 255;
    }
    const out = refineMask(data, width, height, { grow: 1, feather: 0, alphaBoost: 1 });
    for (let y = 0; y < height; y += 1) {
      expect(out[y * width + 1]).toBe(0);
      expect(out[y * width + 2]).toBe(1);
      expect(out[y * width + 3]).toBe(1);
      expect(out[y * width + 4]).toBe(1);
      expect(out[y * width + 5]).toBe(0);
    }
  });

  test('default options keep interior opaque and stay in [0,1]', () => {
    const out = refineMask([0, 0, 255, 255, 255], 5, 1);
    expect(out.length).toBe(5);
    for (let i = 0; i < out.length; i += 1) {
      expect(out[i]).toBeGreaterThanOrEqual(0);
      expect(out[i]).toBeLessThanOrEqual(1);
    }
    expect(out[2]).toBe(1);
    expect(out[1]).toBeGreaterThan(out[0]);
  });

  test('rejects data length that does not match dimensions', () => {
    expect(() => refineMask([0, 255], 3, 1)).toThrow(/multiple/);
    expect(() => refineMask([0, 255, 255], 0, 3)).toThrow(/invalid dimensions/);
  });
});
