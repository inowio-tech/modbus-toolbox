import { useEffect, useRef, useState } from "react";

type Props = {
  open: boolean;
  title: string;
  label: string;
  initialValue: string;
  inputMode?: "text" | "numeric";
  hint?: string;
  submitLabel?: string;
  /** Return an error message to block submit, or null when valid. */
  validate?: (value: string) => string | null;
  onSubmit: (value: string) => void;
  onClose: () => void;
};

/**
 * Small single-field modal that replaces `window.prompt` (a browser chrome
 * artifact that looks out of place in the Tauri desktop app). Follows the app
 * modal convention: dimmed backdrop, rounded surface, Esc to close, Enter to
 * submit, primary action on the right.
 */
export default function PromptDialog({
  open,
  title,
  label,
  initialValue,
  inputMode = "text",
  hint,
  submitLabel = "OK",
  validate,
  onSubmit,
  onClose,
}: Props) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    const id = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => window.clearTimeout(id);
  }, [open, initialValue]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const error = validate ? validate(value) : null;
  const submit = () => {
    if (error) return;
    onSubmit(value);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div id="prompt-dialog-title" className="mb-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {title}
        </div>
        <label className="flex flex-col gap-1 text-xs">
          {label}
          <input
            ref={inputRef}
            aria-label={label}
            inputMode={inputMode}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm dark:border-slate-700 dark:bg-slate-900"
          />
        </label>
        {hint ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{hint}</p> : null}
        {error ? <p className="mt-2 text-xs text-rose-600 dark:text-rose-400">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold text-slate-700 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!error}
            className="rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-800 disabled:opacity-50 dark:border-emerald-500/60 dark:text-emerald-200"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
