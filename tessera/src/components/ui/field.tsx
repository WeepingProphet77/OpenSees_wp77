import { useId, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './input';
import { Label } from './label';
import { Select } from './select';

/** Labeled numeric input with a unit suffix and inline positivity/min validation. */
export function NumberField({
  label,
  value,
  onChange,
  step,
  suffix,
  min,
  positive,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: string;
  suffix?: string;
  /** Smallest valid value (inclusive). */
  min?: number;
  /** Require a strictly positive value (dimensions, strengths). */
  positive?: boolean;
}) {
  const id = useId();
  const errId = `${id}-err`;
  const invalid =
    !Number.isFinite(value) || (positive ? value <= 0 : false) || (min != null && value < min);
  const message = invalid
    ? positive
      ? 'Must be greater than 0'
      : min != null
        ? `Must be ≥ ${min}`
        : 'Enter a number'
    : null;
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          step={step ?? 'any'}
          min={min ?? (positive ? 0 : undefined)}
          value={value}
          aria-invalid={invalid || undefined}
          aria-describedby={message ? errId : undefined}
          className={cn(suffix && 'pr-10', invalid && 'border-destructive focus-visible:ring-destructive')}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(Number.isFinite(v) ? v : 0);
          }}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {message && (
        <p id={errId} className="text-[11px] text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}

/** Labeled native select with the label/id association wired up. */
export function SelectField({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </div>
  );
}
