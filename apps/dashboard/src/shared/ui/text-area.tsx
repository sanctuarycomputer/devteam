// A text area (shell.css css-common: textarea), holding a draft as its first value.
import type { ChangeEventHandler } from 'react';

export type TextAreaProps = {
  id?: string;
  label?: string;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  defaultValue?: string;
  className?: string;
  data?: Record<string, string>;
  onChange?: ChangeEventHandler<HTMLTextAreaElement>;
};

export default function TextArea({ id, label, placeholder, rows, maxLength, defaultValue, className, data, onChange }: TextAreaProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return <textarea id={id} aria-label={label} placeholder={placeholder} rows={rows} maxLength={maxLength} defaultValue={defaultValue} className={className} {...dataAttrs} onChange={onChange} />;
}
