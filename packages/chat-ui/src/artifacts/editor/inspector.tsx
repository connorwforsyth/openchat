"use client";

// Adapted from open-slide (https://github.com/open-slide/open-slide),
// packages/core/src/app/components/panel/{panel-shell,panel-fields}.tsx and
// inspector/inspector-panel.tsx. MIT, Copyright (c) 2026 Yiwei Ho; see
// NOTICE.open-slide.

import { Trans, useLingui } from "@lingui/react/macro";
import { XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Toggle } from "@workspace/ui/components/toggle";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

import {
  type ElementStyle,
  type StyleChange,
  type ThemeColor,
  themeColorValue,
} from "./style";

// An artifact editor's inspector, shared by every kind: a panel of
// sections for what's picked (a slide's heading now; a cell, a block
// later), with the fields that change it. Fields report a `StyleChange`
// (a CSS key and value) and the kind turns it into its own edit.

export function InspectorPanel({
  children,
  icon,
  onClose,
  title,
}: {
  readonly children: ReactNode;
  readonly icon?: ReactNode;
  /** Unpicks; without it, the panel has no close button. */
  readonly onClose?: () => void;
  readonly title: string;
}) {
  const { t } = useLingui();
  return (
    <section aria-label={title} className="flex min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b ps-3 pe-1.5">
        {icon}
        <h2 className="min-w-0 flex-1 truncate font-medium text-xs">{title}</h2>
        {onClose ? (
          <Button
            aria-label={t`Close`}
            onClick={onClose}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-col divide-y overflow-y-auto">
        {children}
      </div>
    </section>
  );
}

export function InspectorSection({
  action,
  children,
  title,
}: {
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="flex flex-col gap-2.5 px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-muted-foreground text-xs">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A labelled row: the label, then its control. */
export function InspectorField({
  children,
  htmlFor,
  label,
}: {
  readonly children: ReactNode;
  readonly htmlFor?: string;
  readonly label: string;
}) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-2">
      <label className="text-muted-foreground text-xs" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-1.5">{children}</div>
    </div>
  );
}

/**
 * A number typed in place: each valid number is a change, and leaving the
 * field puts back what's applied.
 */
export function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  suffix,
  value,
}: {
  readonly label: string;
  readonly max?: number;
  readonly min?: number;
  readonly onChange: (value: number) => void;
  readonly step?: number;
  readonly suffix?: string;
  readonly value: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) {
      setDraft(String(value));
    }
  }, [focused, value]);
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  const change = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const raw = event.target.value;
      setDraft(raw);
      const next = Number(raw);
      if (
        raw.trim() &&
        Number.isFinite(next) &&
        (min === undefined || next >= min) &&
        (max === undefined || next <= max)
      ) {
        onChange(next);
      }
    },
    [max, min, onChange]
  );
  return (
    <InspectorField htmlFor={id} label={label}>
      <Input
        className="h-7 text-end text-xs tabular-nums"
        id={id}
        inputMode="decimal"
        max={max}
        min={min}
        onBlur={onBlur}
        onChange={change}
        onFocus={onFocus}
        step={step}
        type="number"
        value={draft}
      />
      {suffix ? (
        <span className="shrink-0 text-muted-foreground text-xs">{suffix}</span>
      ) : null}
    </InspectorField>
  );
}

/** What a theme colour is called, by its variable. */
const useThemeColorName = () => {
  const { t } = useLingui();
  return useCallback(
    (name: string): string => {
      switch (name) {
        case "foreground":
          return t`Text`;
        case "muted-foreground":
          return t`Muted text`;
        case "primary":
          return t`Accent`;
        case "primary-foreground":
          return t`Text on accent`;
        case "background":
          return t`Background`;
        case "muted":
          return t`Muted background`;
        case "border":
          return t`Border`;
        default:
          return name.startsWith("chart-")
            ? t`Chart ${name.slice("chart-".length)}`
            : name;
      }
    },
    [t]
  );
};

/**
 * A colour: the theme's colours first (written as their variables, so
 * they follow the theme), then one of one's own.
 */
export function ColorField({
  label,
  onChange,
  onClear,
  theme,
  value,
}: {
  readonly label: string;
  /** A CSS colour: a theme variable, or `#rrggbb`. */
  readonly onChange: (value: string) => void;
  /** Drops the colour; without it, there's nothing to drop. */
  readonly onClear?: () => void;
  readonly theme: readonly ThemeColor[];
  /** The colour as drawn, or `null` for none. */
  readonly value: string | null;
}) {
  const { t } = useLingui();
  const id = useId();
  const nameOf = useThemeColorName();
  const custom = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => onChange(event.target.value),
    [onChange]
  );
  return (
    <div className="flex flex-col gap-1.5">
      <InspectorField htmlFor={id} label={label}>
        <label
          className="relative inline-flex size-7 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border bg-background has-focus-visible:ring-2 has-focus-visible:ring-ring/50"
          htmlFor={id}
        >
          <span
            aria-hidden
            className={cn(
              "size-4 rounded-sm border",
              value === null && "bg-muted"
            )}
            style={value === null ? undefined : { backgroundColor: value }}
          />
          <input
            aria-label={t`${label}: your own colour`}
            className="absolute inset-0 cursor-pointer opacity-0"
            id={id}
            onChange={custom}
            type="color"
            value={value ?? theme[0]?.value ?? ""}
          />
        </label>
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs tabular-nums">
          {value ?? <Trans>None</Trans>}
        </span>
        {onClear ? (
          <Button
            aria-label={t`Clear ${label}`}
            onClick={onClear}
            size="icon-xs"
            variant="ghost"
          >
            <XIcon aria-hidden />
          </Button>
        ) : null}
      </InspectorField>
      {theme.length > 0 ? (
        <fieldset className="flex flex-wrap gap-1 ps-22">
          <legend className="sr-only">
            <Trans>{label}: theme colours</Trans>
          </legend>
          {theme.map((color) => (
            <ThemeSwatch
              color={color}
              current={color.value === value}
              key={color.name}
              name={nameOf(color.name)}
              onPick={onChange}
            />
          ))}
        </fieldset>
      ) : null}
    </div>
  );
}

function ThemeSwatch({
  color,
  current,
  name,
  onPick,
}: {
  readonly color: ThemeColor;
  readonly current: boolean;
  readonly name: string;
  readonly onPick: (value: string) => void;
}) {
  const pick = useCallback(
    () => onPick(themeColorValue(color.name)),
    [color.name, onPick]
  );
  return (
    <button
      aria-label={name}
      aria-pressed={current}
      className={cn(
        "size-5 rounded-sm border outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        current && "ring-2 ring-primary ring-offset-1 ring-offset-background"
      )}
      onClick={pick}
      style={{ backgroundColor: color.value }}
      title={name}
      type="button"
    />
  );
}

const ALIGNMENTS = ["start", "center", "end"] as const;

/**
 * The type of picked text: size, weight and slant, alignment, line height
 * and letter spacing. Each control reports one change.
 */
export function TextStyleFields({
  onChange,
  style,
}: {
  readonly onChange: (change: StyleChange) => void;
  readonly style: ElementStyle;
}) {
  const { t } = useLingui();
  const bold = style.fontWeight >= 600;
  const italic = style.fontStyle === "italic";
  const size = useCallback(
    (value: number) => onChange({ key: "fontSize", value: `${value}px` }),
    [onChange]
  );
  const toggleBold = useCallback(
    () => onChange({ key: "fontWeight", value: bold ? "400" : "700" }),
    [bold, onChange]
  );
  const toggleItalic = useCallback(
    () => onChange({ key: "fontStyle", value: italic ? "normal" : "italic" }),
    [italic, onChange]
  );
  const align = useCallback(
    (value: unknown[]) => {
      const [next] = value;
      if (typeof next === "string") {
        onChange({ key: "textAlign", value: next });
      }
    },
    [onChange]
  );
  const lineHeight = useCallback(
    (value: number) => onChange({ key: "lineHeight", value: String(value) }),
    [onChange]
  );
  const spacing = useCallback(
    (value: number) => onChange({ key: "letterSpacing", value: `${value}px` }),
    [onChange]
  );
  const alignLabel = {
    center: t`Center`,
    end: t`End`,
    start: t`Start`,
  } as const;
  return (
    <>
      <NumberField
        label={t`Size`}
        max={1000}
        min={1}
        onChange={size}
        suffix="px"
        value={Math.round(style.fontSize)}
      />
      <InspectorField label={t`Style`}>
        <Toggle
          aria-label={t`Bold`}
          onPressedChange={toggleBold}
          pressed={bold}
          size="sm"
          title={t`Bold`}
          variant="outline"
        >
          <span aria-hidden className="font-bold">
            B
          </span>
        </Toggle>
        <Toggle
          aria-label={t`Italic`}
          onPressedChange={toggleItalic}
          pressed={italic}
          size="sm"
          title={t`Italic`}
          variant="outline"
        >
          <span aria-hidden className="font-serif italic">
            I
          </span>
        </Toggle>
      </InspectorField>
      <InspectorField label={t`Align`}>
        <ToggleGroup
          aria-label={t`Align`}
          onValueChange={align}
          size="sm"
          spacing={0}
          value={[style.textAlign]}
          variant="outline"
        >
          {ALIGNMENTS.map((value) => (
            <ToggleGroupItem
              className="px-1.5 text-xs"
              key={value}
              value={value}
            >
              {alignLabel[value]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </InspectorField>
      <NumberField
        label={t`Line height`}
        max={10}
        min={0.5}
        onChange={lineHeight}
        step={0.05}
        value={style.lineHeight ?? 1.2}
      />
      <NumberField
        label={t`Spacing`}
        max={200}
        min={-50}
        onChange={spacing}
        step={0.5}
        suffix="px"
        value={Math.round(style.letterSpacing * 10) / 10}
      />
    </>
  );
}

/**
 * Words rewritten in a field: each pause in typing is a change, as typing
 * in the element itself is.
 */
export function TextContentField({
  label,
  onChange,
  value,
}: {
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly value: string;
}) {
  const [draft, setDraft] = useState(value);
  const [composing, setComposing] = useState(false);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!(composing || focused)) {
      setDraft(value);
    }
  }, [composing, focused, value]);
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => {
      setDraft(event.target.value);
      // Mid-composition (an IME), the text isn't the person's yet.
      if (!composing) {
        onChange(event.target.value);
      }
    },
    [composing, onChange]
  );
  const onCompositionStart = useCallback(() => setComposing(true), []);
  const onCompositionEnd = useCallback(
    (event: { readonly currentTarget: HTMLTextAreaElement }) => {
      setComposing(false);
      onChange(event.currentTarget.value);
    },
    [onChange]
  );
  const onFocus = useCallback(() => setFocused(true), []);
  const onBlur = useCallback(() => setFocused(false), []);
  return (
    <Textarea
      aria-label={label}
      className="min-h-16 resize-none text-sm"
      onBlur={onBlur}
      onChange={change}
      onCompositionEnd={onCompositionEnd}
      onCompositionStart={onCompositionStart}
      onFocus={onFocus}
      value={draft}
    />
  );
}
