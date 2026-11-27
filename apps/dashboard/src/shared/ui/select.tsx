// A select of options (shell.css css-common: select), the chosen one by value.
import type { ChangeEventHandler } from 'react';

export type SelectProps = {
  options: { value: string; label: string }[];
  defaultValue?: string;
  id?: string;
  label?: string;
  className?: string;
  data?: Record<string, string>;
  onChange?: ChangeEventHandler<HTMLSelectElement>;
};

export default function Select({ options, defaultValue, id, label, className, data, onChange }: SelectProps) {
  const dataAttrs = Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [`data-${k}`, v]));
  return (
    <select id={id} aria-label={label} defaultValue={defaultValue} className={className} {...dataAttrs} onChange={onChange}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
