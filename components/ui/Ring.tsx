export function Ring({ value, size = 96, stroke = 8, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Progress"} ${v}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} stroke="#27272A" strokeWidth={stroke} fill="none" />
        <circle cx={size/2} cy={size/2} r={r} stroke="#B8FF3D" strokeWidth={stroke} fill="none" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} style={{ transition: "stroke-dashoffset 400ms ease" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-lg font-semibold tabular-nums">{v}%</div>
    </div>
  );
}
export function Bar({ value }: { value: number }) {
  return <div className="h-1 w-full overflow-hidden rounded-full bg-line"><div className="h-full rounded-full bg-lime transition-[width] duration-300" style={{ width: `${value}%` }} /></div>;
}
