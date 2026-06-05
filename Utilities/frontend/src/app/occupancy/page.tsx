export default function OccupancyPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Occupancy</h1>
        <p className="text-base text-neutral-500">Daily per-room occupancy snapshots.</p>
      </div>
      <div className="rounded-lg border border-neutral-800 bg-neutral-900 px-5 py-12 text-center text-base text-neutral-500">
        Page coming soon — backend endpoint <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-sm text-neutral-300">/occupancy</code> not yet wired up. Snapshots are being captured daily into the <code className="rounded bg-neutral-800 px-1.5 py-0.5 text-sm text-neutral-300">occupancy_snapshots</code> table.
      </div>
    </div>
  );
}
