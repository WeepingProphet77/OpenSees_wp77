import { describe, it, expect } from 'vitest';
import { buildDiagramGeometry } from './forceDiagramGeometry';

describe('buildDiagramGeometry', () => {
  const pts = [
    { x: 0, value: 0 },
    { x: 50, value: 25 },
    { x: 100, value: 0 },
  ];

  it('centers the zero baseline and scales to the peak magnitude', () => {
    const g = buildDiagramGeometry(pts, 100, 200, 100, 10);
    // inner height 80 → baseline at 10 + 40 = 50
    expect(g.baselineY).toBe(50);
    // peak (value 25) maps to the top edge (pad), and is at mid-span x
    expect(g.peak?.value).toBe(25);
    expect(g.peak?.y).toBeCloseTo(10, 6); // baseline 50 − (25/25)*40
    expect(g.peak?.x).toBeCloseTo(100, 6); // pad 10 + 0.5*(200−2·10) = 10 + 90
  });

  it('maps the member ends across the padded width', () => {
    const g = buildDiagramGeometry(pts, 100, 200, 100, 10);
    expect(g.scaleX(0)).toBe(10);
    expect(g.scaleX(100)).toBeCloseTo(190, 6);
  });

  it('emits a closed area path anchored on the baseline', () => {
    const g = buildDiagramGeometry(pts, 100, 200, 100, 10);
    expect(g.line.startsWith('M')).toBe(true);
    expect(g.area.startsWith('M10.00 50.00')).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });

  it('handles an all-zero series without blowing up', () => {
    const g = buildDiagramGeometry([{ x: 0, value: 0 }, { x: 10, value: 0 }], 10, 100, 40);
    expect(g.peak?.value).toBe(0);
    expect(Number.isFinite(g.baselineY)).toBe(true);
  });
});
