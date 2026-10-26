"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useCallback } from "react";

import {
  ColorField,
  InspectorField,
  InspectorPanel,
  InspectorSection,
  NumberField,
  TextContentField,
  TextStyleFields,
} from "../editor/inspector";
import type { StyleChange } from "../editor/style";
import type { PickedElement } from "../runtime-protocol";

// The slides editor's inspector (n2): the shared inspector's fields for the
// element picked on the slide. Text gets its words and its type; anything
// gets its colours and opacity. A layout's part (a Title's heading) says
// so: its style is the layout's, kept in its `styles` prop.

/** What the picked element is called in the inspector's heading. */
const usePickedName = () => {
  const { t } = useLingui();
  return useCallback(
    (element: PickedElement): string => {
      const { part, prop } = element.target;
      const item = prop?.split(".")[1];
      const number = item === undefined ? 0 : Number(item) + 1;
      switch (part) {
        case undefined:
          break;
        case "slide":
          return t`Slide background`;
        case "title":
          return t`Title`;
        case "subtitle":
          return t`Subtitle`;
        case "eyebrow":
          return t`Eyebrow`;
        case "items":
          return number > 0 ? t`Point ${number}` : t`Points`;
        case "quote":
          return t`Quote`;
        case "author":
          return t`Author`;
        case "byline":
          return t`Byline`;
        case "number":
        case "value":
          return t`Number`;
        case "label":
          return t`Label`;
        case "detail":
          return t`Detail`;
        case "caption":
          return t`Caption`;
        case "contact":
          return t`Contact`;
        case "image":
          return t`Picture`;
        case "logo":
          return t`Logo`;
        default:
          return part;
      }
      switch (element.kind) {
        case "image":
          return t`Picture`;
        case "text":
          return t`Text`;
        case "box":
          return t`Box`;
        default:
          return element.kind satisfies never;
      }
    },
    [t]
  );
};

export function SlideInspector({
  canEdit,
  element,
  onClose,
  onStyle,
  onText,
}: {
  readonly canEdit: boolean;
  readonly element: PickedElement;
  readonly onClose: () => void;
  readonly onStyle: (change: StyleChange) => void;
  readonly onText: (text: string) => void;
}) {
  const { t } = useLingui();
  const nameOf = usePickedName();
  const { style, theme } = element;
  const color = useCallback(
    (value: string) => onStyle({ key: "color", value }),
    [onStyle]
  );
  const background = useCallback(
    (value: string) => onStyle({ key: "backgroundColor", value }),
    [onStyle]
  );
  const clearBackground = useCallback(
    () => onStyle({ key: "backgroundColor", value: null }),
    [onStyle]
  );
  const opacity = useCallback(
    (value: number) => onStyle({ key: "opacity", value: String(value / 100) }),
    [onStyle]
  );
  const isText = element.text !== null;
  return (
    <InspectorPanel onClose={onClose} title={nameOf(element)}>
      {canEdit ? null : (
        <p className="px-3 py-2 text-muted-foreground text-xs">
          <Trans>Read only: you can look, not change.</Trans>
        </p>
      )}
      <fieldset className="contents" disabled={!canEdit}>
        {isText ? (
          <InspectorSection title={t`Words`}>
            <TextContentField
              label={t`Words`}
              onChange={onText}
              value={element.text ?? ""}
            />
          </InspectorSection>
        ) : null}
        {isText ? (
          <InspectorSection title={t`Type`}>
            <TextStyleFields onChange={onStyle} style={style} />
          </InspectorSection>
        ) : null}
        <InspectorSection title={t`Colour`}>
          {isText ? (
            <ColorField
              label={t`Text`}
              onChange={color}
              theme={theme}
              value={style.color}
            />
          ) : null}
          <ColorField
            label={t`Fill`}
            onChange={background}
            onClear={style.backgroundColor ? clearBackground : undefined}
            theme={theme}
            value={style.backgroundColor}
          />
          <NumberField
            label={t`Opacity`}
            max={100}
            min={0}
            onChange={opacity}
            suffix="%"
            value={Math.round(style.opacity * 100)}
          />
        </InspectorSection>
        <InspectorSection title={t`Source`}>
          <InspectorField label={t`Element`}>
            <code className="truncate text-muted-foreground text-xs">
              {`<${element.tag}> · ${element.target.line}:${element.target.column}`}
            </code>
          </InspectorField>
        </InspectorSection>
      </fieldset>
    </InspectorPanel>
  );
}
