"use client";

export interface PieSlice {
  label: string;
  value: number;
  color: string;
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function donutSlicePath(
  cx: number,
  cy: number,
  outerR: number,
  innerR: number,
  startAngle: number,
  endAngle: number
): string {
  const os = polarToCartesian(cx, cy, outerR, startAngle);
  const oe = polarToCartesian(cx, cy, outerR, endAngle);
  const is_ = polarToCartesian(cx, cy, innerR, startAngle);
  const ie = polarToCartesian(cx, cy, innerR, endAngle);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${os.x} ${os.y}`,
    `A ${outerR} ${outerR} 0 ${large} 1 ${oe.x} ${oe.y}`,
    `L ${ie.x} ${ie.y}`,
    `A ${innerR} ${innerR} 0 ${large} 0 ${is_.x} ${is_.y}`,
    "Z",
  ].join(" ");
}

export function PriorityPieChart({ slices }: { slices: PieSlice[] }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <p className="text-xs text-muted-foreground text-center py-8">
        Sin datos
      </p>
    );
  }

  const cx = 80, cy = 80, outerR = 68, innerR = 44;
  let currentAngle = 0;

  const paths = slices
    .filter((s) => s.value > 0)
    .map((slice) => {
      const span = (slice.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + (span >= 360 ? 359.99 : span);
      currentAngle += span;
      return {
        ...slice,
        path: donutSlicePath(cx, cy, outerR, innerR, startAngle, endAngle),
      };
    });

  return (
    <div className="flex flex-col items-center gap-4">
      <svg
        width={160}
        height={160}
        viewBox="0 0 160 160"
        className="shrink-0 text-foreground"
      >
        {paths.map((p) => (
          <path key={p.label} d={p.path} fill={p.color} />
        ))}
        <text
          x={cx}
          y={cy - 7}
          textAnchor="middle"
          fontSize={22}
          fontWeight={700}
          fill="currentColor"
        >
          {total}
        </text>
        <text
          x={cx}
          y={cy + 11}
          textAnchor="middle"
          fontSize={9}
          fill="#9ca3af"
        >
          incidencias
        </text>
      </svg>

      <div className="flex flex-col gap-2 w-full">
        {slices.map((slice) => (
          <div key={slice.label} className="flex items-center gap-2 text-xs">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: slice.color }}
            />
            <span className="text-foreground font-medium w-12">
              {slice.label}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {slice.value}
              <span className="ml-1 text-muted-foreground/60">
                ({total > 0 ? Math.round((slice.value / total) * 100) : 0}%)
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
