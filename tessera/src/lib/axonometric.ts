/**
 * Minimal axonometric (orthographic) 3D→2D projection — enough for the member /
 * frame viewport without pulling in a WebGL engine. Right-handed world axes:
 * x (member span, I→J), y (vertical, up), z (out-of-plane width). The camera is
 * a yaw about the vertical y-axis then a pitch about the screen-horizontal axis,
 * projected orthographically; `depth` is the post-rotation z for painter ordering.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Projected {
  /** Screen x (right +). */
  x: number;
  /** Screen y (up +; flip for SVG). */
  y: number;
  /** View-space depth (larger = nearer the camera). */
  depth: number;
}

/** Build a projector for the given yaw/pitch (radians). */
export function projector(yaw: number, pitch: number): (p: Vec3) => Projected {
  const ca = Math.cos(yaw);
  const sa = Math.sin(yaw);
  const cb = Math.cos(pitch);
  const sb = Math.sin(pitch);
  return (p) => {
    // Yaw about vertical (y) axis.
    const x1 = p.x * ca + p.z * sa;
    const z1 = -p.x * sa + p.z * ca;
    // Pitch about the screen-horizontal (x1) axis.
    const y2 = p.y * cb - z1 * sb;
    const z2 = p.y * sb + z1 * cb;
    return { x: x1, y: y2, depth: z2 };
  };
}
