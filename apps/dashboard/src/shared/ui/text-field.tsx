// A one-line text field (shell.css css-common: input[type=text]).
import type { ChangeEventHandler } from 'react';

export type TextFieldProps = {
  id?: string;
  label?: string;
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  className?: string;
  data?: Record<string, string>;
  onChange?: ChangeEventHandler<HTMLInputElement>;
};

export default function TextField({ id, label, placeholder, maxLength, defaultValue, className, data, onChange }: TextFieldProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return <input type="text" id={id} aria-label={label} placeholder={placeholder} maxLength={maxLength} defaultValue={defaultValue} className={className} {...dataAttrs} onChange={onChange} />;
}
