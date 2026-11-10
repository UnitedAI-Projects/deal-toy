import { useImperativeHandle, useRef, type Ref } from "react";
import { ORIGIN_AXES, ORIGIN_COLORS, type OriginAxis } from "./origin";
import { triadDepths, triadVectors } from "./triad";

export type TriadHandle = {
  update: (q: [number, number, number, number]) => void;
};
const SIZE = 56;
const REACH = 20;
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;

/**
 * The model axes as seen from the camera, in the view's corner. It redraws through its handle,
 * so camera motion never re-renders the workspace.
 */
export function Triad({ ref }: { ref: Ref<TriadHandle> }) {
  const lines = useRef<Partial<Record<OriginAxis, SVGGElement | null>>>({});
  const group = useRef<SVGGElement>(null);
  useImperativeHandle(ref, () => ({
    update(q) {
      const v = triadVectors(q);
      const depth = triadDepths(q);
      // Back to front: the axis pointing most toward the viewer is drawn last.
      const order = [...ORIGIN_AXES].sort((a, b) => depth[a] - depth[b]);
      for (const name of order) {
        const g = lines.current[name];
        if (!g) continue;
        const [x, y] = v[name];
        const tip = { x: SIZE / 2 + x * REACH, y: SIZE / 2 - y * REACH };
        const line = g.querySelector("line")!;
        line.setAttribute("x2", String(tip.x));
        line.setAttribute("y2", String(tip.y));
        const label = g.querySelector("text")!;
        label.setAttribute("x", String(SIZE / 2 + x * (REACH + 7)));
        label.setAttribute("y", String(SIZE / 2 - y * (REACH + 7)));
        g.style.opacity = Math.hypot(x, y) < 0.15 ? "0.35" : "1";
        group.current?.append(g);
      }
    },
  }));
  return (
    <svg
      className="triad"
      width={SIZE}
      height={SIZE}
      viewBox={`0 0 ${SIZE} ${SIZE}`}
      role="img"
      aria-label="Model axes: X red, Y green, Z blue"
    >
      <g ref={group}>
        {ORIGIN_AXES.map((name) => (
          <g key={name} ref={(el) => void (lines.current[name] = el)}>
            <line
              x1={SIZE / 2}
              y1={SIZE / 2}
              x2={SIZE / 2}
              y2={SIZE / 2}
              stroke={hex(ORIGIN_COLORS[name])}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <text
              x={SIZE / 2}
              y={SIZE / 2}
              fill={hex(ORIGIN_COLORS[name])}
              fontSize={10}
              fontWeight={600}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {name}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}
