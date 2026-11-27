// A fixture component (test/apps-design-system.test.mjs): a button. Copied into a scratch copy's
// src/shared/ui/ for the Chrome case, so it is written as a real one.
import './fixture-alpha.css';

export type FixtureAlphaProps = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
};

export default function FixtureAlpha({ label, onPress, disabled = false }: FixtureAlphaProps) {
  return <button type="button" className="fixture-alpha" onClick={onPress} disabled={disabled}>{label}</button>;
}
