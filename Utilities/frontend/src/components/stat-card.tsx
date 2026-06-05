export function StatCard({
  label,
  value,
  units,
  hint,
}: {
  label: string;
  value: string | number;
  units?: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-4">
      <p className="text-sm font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums text-neutral-100">
        {value}
        {units && <span className="ml-1 text-base font-normal text-neutral-400">{units}</span>}
      </p>
      {hint && <p className="mt-1 text-sm text-neutral-500">{hint}</p>}
    </div>
  );
}
