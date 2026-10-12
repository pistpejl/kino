"use client";

interface PromptFieldProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  label?: string;
}

export default function PromptField({
  value,
  onChange,
  placeholder,
  rows = 4,
  label = "Prompt",
}: PromptFieldProps) {
  return (
    <label className="block">
      <span className="text-xs text-white/40 uppercase tracking-wider mb-1.5 block">
        {label}
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-2xl bg-white/5 border border-white/10 px-4 py-3 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-white/20 resize-y min-h-[96px]"
      />
    </label>
  );
}
