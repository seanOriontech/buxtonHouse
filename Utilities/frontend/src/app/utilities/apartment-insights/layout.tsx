// Force this route to be rendered on every request rather than statically
// prerendered + edge-cached. Required because the page state (water daily cap,
// etc.) reflects live DB writes; a year-long s-maxage HTML cache would let
// stale JS bundles linger after deploys.
export const dynamic = "force-dynamic";

export default function ApartmentInsightsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
