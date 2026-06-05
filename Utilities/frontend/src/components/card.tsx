import { ReactNode } from "react";

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-neutral-800 bg-neutral-900 ${className}`}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle }: { title: ReactNode; subtitle?: string }) {
  return (
    <div className="border-b border-neutral-800 px-5 py-4">
      <h2 className="text-base font-medium text-neutral-100">{title}</h2>
      {subtitle && <p className="mt-0.5 text-sm text-neutral-500">{subtitle}</p>}
    </div>
  );
}
