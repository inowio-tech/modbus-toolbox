import { useEffect, useRef, useState } from "react";
import { RiCloseLine } from "react-icons/ri";

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-dialog-title"
        className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
      >
        <div className="mb-3 flex items-center justify-between gap-2">
          <div id="prompt-dialog-title" className="min-w-0 truncate text-sm font-semibold text-emerald-700 dark:text-emerald-200">
            {title}
          </div>
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="flex items-center gap-1 rounded-full border border-slate-300 bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
          >
            <RiCloseLine className="h-4 w-3" aria-hidden="true" />
          </button>
        </div>

        {error ? (
          <div className="mb-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-800 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-200">
          <label className="flex flex-col gap-1">
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
          {hint ? <p className="mt-2 text-slate-500 dark:text-slate-400">{hint}</p> : null}
        </div>

        <div className="mt-4 flex justify-end gap-2 text-xs">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 bg-slate-100 px-4 py-2 font-semibold text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 dark:hover:border-slate-500"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!!error}
            className="inline-flex items-center gap-2 rounded-full border border-emerald-600/60 bg-emerald-500/10 px-4 py-2 font-semibold text-emerald-800 transition hover:border-emerald-500 hover:text-emerald-900 disabled:cursor-not-allowed disabled:opacity-60 dark:border-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-100 dark:hover:border-emerald-300 dark:hover:text-emerald-50"
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
