export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: React.ReactNode }) {
  return (
    <header className="mb-5 flex items-end justify-between gap-3">
      <div className="min-w-0"><h1 className="text-3xl font-bold tracking-tight">{title}</h1>{subtitle && <p className="mt-1 text-sm text-sub">{subtitle}</p>}</div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </header>
  );
}
