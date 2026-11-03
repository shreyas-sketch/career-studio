"use client";

import { Input } from "@/components/ui/input";

/** The numbers the user reads off Upwork, shared by the new-analysis form and the analysis page. */
export type Numbers = {
  connectsRequired: number | null;
  boostConnects: number;
  connectPriceUsd: number;
  serviceFeePercent: number | null;
  minimumHourlyUsd: number | null;
  connectsBalance: number | null;
};

const parse = (value: string) => (value.trim() === "" ? null : Number(value));

export function NumbersFields({ value, onChange, onBlur }: { value: Numbers; onChange: (next: Numbers) => void; onBlur?: () => void }) {
  const field = (key: keyof Numbers, label: string, hint: string, step = "1") => (
    <Input
      label={label}
      hint={hint}
      type="number"
      inputMode="decimal"
      min={0}
      step={step}
      value={value[key] ?? ""}
      onBlur={onBlur}
      onChange={(event) => {
        const parsed = parse(event.target.value);
        const next = { ...value, [key]: key === "boostConnects" || key === "connectPriceUsd" ? (parsed ?? 0) : parsed };
        if (parsed === null || Number.isFinite(parsed)) onChange(next);
      }}
    />
  );
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {field("connectsRequired", "Connects this job needs", "Shown on the job post, next to Apply.")}
      {field("boostConnects", "Connects to boost (optional)", "0 for no boost.")}
      {field("connectsBalance", "Connects you have", "Optional: to warn when you're short.")}
      {field("serviceFeePercent", "Upwork's fee for this contract (%)", "Shown on the proposal screen; 0–15%.", "0.1")}
      {field("minimumHourlyUsd", "Your minimum rate ($/h)", "Optional: your floor.", "1")}
      {field("connectPriceUsd", "Price per Connect ($)", "Upwork's published price.", "0.01")}
    </div>
  );
}
