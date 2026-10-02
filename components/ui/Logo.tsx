export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
      <path d="M22 9.5A9 9 0 1 0 22 22.5" stroke="#FAFAFA" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 16h9" stroke="#B8FF3D" strokeWidth="3" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.8" fill="#B8FF3D" />
    </svg>
  );
}
export function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark />
      <div className="leading-[1.05] font-semibold tracking-tight"><div>CGL</div><div className="text-sub">Command</div></div>
    </div>
  );
}
