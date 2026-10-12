"use client";

interface GenerateBarProps {
  onGenerate: () => void;
  loading?: boolean;
  label?: string;
  disabled?: boolean;
  hint?: string;
}

export default function GenerateBar({
  onGenerate,
  loading,
  label = "Generate",
  disabled,
  hint,
}: GenerateBarProps) {
  return (
    <div className="fixed bottom-[calc(56px+env(safe-area-inset-bottom))] inset-x-0 z-30 px-3 pb-2 pt-2 bg-gradient-to-t from-kino-bg via-kino-bg/95 to-transparent">
      <div className="mx-auto max-w-lg">
        {hint && (
          <p className="text-center text-[11px] text-white/40 mb-2 truncate">
            {hint}
          </p>
        )}
        <button
          type="button"
          onClick={onGenerate}
          disabled={disabled || loading}
          className="w-full min-h-[52px] rounded-full bg-white text-black font-semibold text-base shadow-lg shadow-white/10 disabled:opacity-50 active:scale-[0.98] transition flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 rounded-full border-2 border-black/20 border-t-black animate-spin" />
              Generating…
            </>
          ) : (
            label
          )}
        </button>
      </div>
    </div>
  );
}
