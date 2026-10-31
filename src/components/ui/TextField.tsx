"use client";

import { useId } from "react";
import { AlertCircle } from "lucide-react";
import type { KeyboardEventHandler, Ref } from "react";
import { cn } from "@/lib/utils/cn";

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
  helper?: string;
  error?: string | null;
  maxLength?: number;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement | HTMLTextAreaElement>;
  /** Shown as part of the helper, e.g. "saved on this device". */
  savedNote?: boolean;
  /** Multiline only: show `helper` instead of the character count. */
  helperInsteadOfCount?: boolean;
  onKeyDown?: KeyboardEventHandler<HTMLInputElement | HTMLTextAreaElement>;
}

/** Label above, helper or error below. Errors always include an icon and text. */
export function TextField({
  label,
  value,
  onChange,
  multiline,
  placeholder,
  helper,
  error,
  maxLength,
  disabled,
  inputRef,
  savedNote,
  helperInsteadOfCount,
  onKeyDown,
}: TextFieldProps) {
  const id = useId();
  const helperId = `${id}-helper`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, helperId].filter(Boolean).join(" ");

  const fieldClass = cn(
    "w-full rounded-[14px] border-[1.5px] bg-surface px-4 py-3.5 text-base font-medium leading-6 text-ink placeholder:text-muted focus:border-brand disabled:text-ink-2",
    error ? "border-error-border" : "border-line-strong",
  );

  const helperText = multiline && !helperInsteadOfCount
    ? `${value.length} / ${maxLength ?? 500}${savedNote ? " · saved on this device" : ""}`
    : helper;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-semibold leading-5 text-ink">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          ref={inputRef as Ref<HTMLTextAreaElement>}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          rows={4}
          className={cn(fieldClass, "min-h-[120px] resize-none")}
        />
      ) : (
        <input
          id={id}
          ref={inputRef as Ref<HTMLInputElement>}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          maxLength={maxLength}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="done"
          aria-invalid={!!error}
          aria-describedby={describedBy}
          className={fieldClass}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="flex items-center gap-1.5 text-xs font-semibold leading-4 text-error">
          <AlertCircle size={14} aria-hidden /> {error}
        </p>
      )}
      <p id={helperId} className="text-xs font-medium leading-4 text-muted">
        {helperText}
      </p>
    </div>
  );
}
