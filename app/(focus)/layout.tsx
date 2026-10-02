// Focus layout: no sidebar, no bottom nav. Authentication is enforced by middleware (same as the (app) group); data access is gated by RLS.
export default function FocusLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-bg">{children}</div>;
}
