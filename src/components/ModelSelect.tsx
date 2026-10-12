"use client";

import type { CatalogModel } from "@/lib/models";

interface ModelSelectProps {
  models: CatalogModel[];
  value: string;
  onChange: (id: string) => void;
  label?: string;
}

export default function ModelSelect({
  models,
  value,
  onChange,
  label = "Model",
}: ModelSelectProps) {
  return (
    <label className="block">
      <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full min-h-[44px] rounded-2xl bg-white/5 border border-white/10 px-4 text-sm text-white appearance-none focus:outline-none focus:ring-2 focus:ring-white/20"
      >
        {models.map((m) => (
          <option key={m.id} value={m.id} className="bg-neutral-900">
            {m.name}
            {m.tag ? ` · ${m.tag}` : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
