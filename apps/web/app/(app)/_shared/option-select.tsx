"use client";

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { useCallback } from "react";

// A Select over a flat list of labelled string options: the shape every
// picker on these pages has (language, role, team, provider, period).

export interface Option<V extends string> {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: V;
}

export const OptionSelect = <V extends string>({
  className,
  disabled,
  id,
  label,
  onChange,
  options,
  value,
}: {
  readonly className?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  /** Accessible name when there's no visible label pointing at `id`. */
  readonly label?: string;
  readonly onChange: (value: V) => void;
  readonly options: readonly Option<V>[];
  readonly value: V;
}) => {
  const handleChange = useCallback(
    (next: V | null) => {
      if (next !== null) {
        onChange(next);
      }
    },
    [onChange]
  );
  return (
    <Select
      disabled={disabled}
      items={options.map(({ label: text, value: item }) => ({
        label: text,
        value: item,
      }))}
      onValueChange={handleChange}
      value={value}
    >
      <SelectTrigger aria-label={label} className={className} id={id}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem
              disabled={option.disabled}
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
};
