import { ReactNode } from "react";

type Tone = "neutral" | "emerald" | "amber" | "red" | "sky";

const tones: Record<Tone, string> = {
  neutral: "bg-neutral-800 text-neutral-300",
  emerald: "bg-emerald-500/15 text-emerald-300",
  amber: "bg-amber-500/15 text-amber-300",
  red: "bg-red-500/15 text-red-300",
  sky: "bg-sky-500/15 text-sky-300",
};

export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
