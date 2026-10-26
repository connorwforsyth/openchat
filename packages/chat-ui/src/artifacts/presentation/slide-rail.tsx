"use client";

import { useLingui } from "@lingui/react/macro";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useDocumentTheme, useParentOrigin } from "../artifact-preview";
import { Sorter, type SorterBox } from "../editor/sorter";
import {
  type HostMessage,
  RUNTIME_CHANNEL,
  readFrameMessage,
  runtimeUrl,
} from "../runtime-protocol";

// The slides editor's sorter (n2): the shared `Sorter` laid over the deck
// drawn small by the artifact runtime (its `rail` view), one frame for the
// whole deck. The frame takes no clicks; it says where each slide sits, and
// the sorter's rows lie over them.

/** The deck in a frame of its own, drawn small, and where its slides are. */
const useRailFrame = ({
  content,
  runtimeOrigin,
  title,
}: {
  readonly content: string;
  readonly runtimeOrigin: string;
  readonly title: string;
}) => {
  const ref = useRef<HTMLIFrameElement>(null);
  const lastId = useRef(0);
  const [ready, setReady] = useState(false);
  const [height, setHeight] = useState<number | null>(null);
  const [boxes, setBoxes] = useState<readonly SorterBox[]>([]);
  const theme = useDocumentTheme();
  const parentOrigin = useParentOrigin();

  const render = useEffectEvent(() => {
    const frame = ref.current?.contentWindow;
    if (!(ready && frame)) {
      return;
    }
    lastId.current += 1;
    const message: HostMessage = {
      channel: RUNTIME_CHANNEL,
      code: content,
      fileName: "deck.json",
      id: String(lastId.current),
      kind: "presentation",
      theme,
      title,
      type: "render",
      view: "rail",
    };
    frame.postMessage(message, "*");
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: these are the triggers; `render` reads them.
  useEffect(() => render(), [ready, content, theme, title]);

  const onMessage = useEffectEvent((event: MessageEvent) => {
    const message = readFrameMessage(event, ref.current?.contentWindow);
    if (!message.ok) {
      return;
    }
    const { value } = message;
    if (value.type === "ready") {
      if (ready) {
        render();
      } else {
        setReady(true);
      }
    } else if (value.type === "resize") {
      setHeight(value.height);
    } else if (value.type === "layout" && value.id === String(lastId.current)) {
      setBoxes(value.slides);
    }
  });
  useEffect(() => {
    const listener = (event: MessageEvent) => onMessage(event);
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);

  return {
    boxes,
    height,
    ref,
    src: parentOrigin
      ? runtimeUrl(runtimeOrigin, parentOrigin, "presentation")
      : null,
  };
};

export interface SlideRailProps {
  /** Owner or editor, on the latest version. */
  readonly canEdit: boolean;
  readonly content: string;
  readonly onAdd: () => void;
  readonly onDelete: (slide: string) => void;
  readonly onDuplicate: (slide: string) => void;
  readonly onMove: (slide: string, index: number) => void;
  readonly onSelect: (slide: string) => void;
  readonly runtimeOrigin: string;
  readonly selected: string | null;
  readonly slides: readonly string[];
  readonly title: string;
}

export function SlideRail({
  canEdit,
  content,
  onAdd,
  onDelete,
  onDuplicate,
  onMove,
  onSelect,
  runtimeOrigin,
  selected,
  slides,
  title,
}: SlideRailProps) {
  const { t } = useLingui();
  const frame = useRailFrame({ content, runtimeOrigin, title });
  const items = slides.map((id, index) => ({
    id,
    label: t`Slide ${index + 1}`,
  }));
  return (
    <Sorter
      addLabel={t`Add slide`}
      backdrop={
        frame.src ? (
          <iframe
            className="pointer-events-none block w-full"
            ref={frame.ref}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts"
            src={frame.src}
            style={{ height: frame.height ?? 0 }}
            tabIndex={-1}
            title={t`Thumbnails of ${title}`}
          />
        ) : null
      }
      boxes={frame.boxes}
      canEdit={canEdit}
      items={items}
      label={t`Slides`}
      onAdd={onAdd}
      onDelete={onDelete}
      onDuplicate={onDuplicate}
      onMove={onMove}
      onSelect={onSelect}
      selected={selected}
    />
  );
}
