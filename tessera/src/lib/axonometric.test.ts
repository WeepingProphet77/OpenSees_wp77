import { describe, it, expect } from 'vitest';
import { projector } from './axonometric';

const DEG = Math.PI / 180;

describe('axonometric projector', () => {
  it('identity at yaw=0, pitch=0 (screen x=x, y=y, depth=z)', () => {
    const p = projector(0, 0);
    const r = p({ x: 3, y: 5, z: 7 });
    expect(r.x).toBeCloseTo(3, 9);
    expect(r.y).toBeCloseTo(5, 9);
    expect(r.depth).toBeCloseTo(7, 9);
  });

  it('is linear (scaling the input scales the output)', () => {
    const p = projector(31 * DEG, -12 * DEG);
    const a = p({ x: 1, y: 2, z: -3 });
    const b = p({ x: 2, y: 4, z: -6 });
    expect(b.x).toBeCloseTo(2 * a.x, 9);
    expect(b.y).toBeCloseTo(2 * a.y, 9);
    expect(b.depth).toBeCloseTo(2 * a.depth, 9);
  });

  it('yaw spins the span axis (x) into depth — its screen x vanishes at 90°', () => {
    const p = projector(90 * DEG, 0);
    const r = p({ x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.depth).toBeCloseTo(-1, 9);
  });

  it('pitch tips the out-of-plane axis (z) down the screen', () => {
    const p = projector(0, 90 * DEG);
    const r = p({ x: 0, y: 0, z: 1 });
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.y).toBeCloseTo(-1, 9);
    expect(r.depth).toBeCloseTo(0, 9);
  });

  it('vertical (y) stays on screen-y and never moves screen-x', () => {
    const p = projector(40 * DEG, 25 * DEG);
    const r = p({ x: 0, y: 1, z: 0 });
    expect(r.x).toBeCloseTo(0, 9); // yaw mixes x/z only — pure y has no screen-x
    expect(r.y).toBeCloseTo(Math.cos(25 * DEG), 9);
  });
});
