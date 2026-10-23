"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { Editor } from "@tiptap/core";
import { isSafeImageUrl } from "@workspace/artifacts-kit/kinds/document/checks";
import { MenuLabel } from "@workspace/composer/components/menu-listbox";
import { SuggestionPopup } from "@workspace/composer/components/suggestion-popup";
import {
  type PopupMenu,
  useSuggestionPopup,
} from "@workspace/composer/hooks/use-suggestion-popup";
import {
  CircleCheckIcon,
  CodeIcon,
  FileTextIcon,
  ImageIcon,
  LayoutGridIcon,
  LinkIcon,
  ListIcon,
  MinusIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  applyBlock,
  type BlockId,
  type BlockMenuItem,
  blockMenuItems,
  blockMenuStage,
  insertArtifactLink,
  type LinkTarget,
} from "./blocks";
import type { BlockMenuSuggestion } from "./extensions";

/** Each block's name in the menu; a `Record` so no block goes unnamed. */
export const useBlockLabels = (): Record<BlockId, string> => {
  const { t } = useLingui();
  return {
    artifactLink: t`Link to artifact`,
    blockquote: t`Quote`,
    bulletList: t`Bulleted list`,
    codeBlock: t`Code block`,
    divider: t`Divider`,
    heading1: t`Heading 1`,
    heading2: t`Heading 2`,
    heading3: t`Heading 3`,
    image: t`Image`,
    orderedList: t`Numbered list`,
    paragraph: t`Text`,
    table: t`Table`,
    taskList: t`To-do list`,
  };
};

// Glyphs where the icon set has no picture, as the toolbar draws them.
const glyph = (text: string, className = "font-medium text-xs") => (
  <span aria-hidden className={cn("inline-flex w-4 justify-center", className)}>
    {text}
  </span>
);

const ICONS: Record<BlockId, ReactNode> = {
  artifactLink: <LinkIcon aria-hidden />,
  blockquote: glyph("“", "font-serif text-lg leading-none"),
  bulletList: <ListIcon aria-hidden />,
  codeBlock: <CodeIcon aria-hidden />,
  divider: <MinusIcon aria-hidden />,
  heading1: glyph("H1"),
  heading2: glyph("H2"),
  heading3: glyph("H3"),
  image: <ImageIcon aria-hidden />,
  orderedList: glyph("1.", "font-medium text-xs tabular-nums"),
  paragraph: glyph("¶"),
  table: <LayoutGridIcon aria-hidden />,
  taskList: <CircleCheckIcon aria-hidden />,
};

/** The Markdown that makes the same block as you type. */
const SHORTCUTS: Partial<Record<BlockId, string>> = {
  blockquote: ">",
  bulletList: "-",
  codeBlock: "```",
  divider: "---",
  heading1: "#",
  heading2: "##",
  heading3: "###",
  orderedList: "1.",
  taskList: "[]",
};

const itemKey = (item: BlockMenuItem) =>
  item.kind === "block" ? item.id : `artifact-${item.artifact.id}`;

export interface BlockMenuState {
  readonly choose: (index: number) => void;
  readonly closeImage: () => void;
  readonly hover: (index: number) => void;
  /** Where an image waits to be inserted; `null` with no image dialog. */
  readonly imageAt: number | null;
  readonly menu: PopupMenu<BlockMenuItem> | null;
  /** The Suggestion options for `documentExtensions`, stable across renders. */
  readonly suggestion: BlockMenuSuggestion;
}

/**
 * The `/` menu's state. The editor's extensions are made once, so the
 * plugin reads the labels and link targets through a ref.
 */
export function useBlockMenu(
  self: LinkTarget["id"],
  targets: readonly LinkTarget[]
): BlockMenuState {
  const labels = useBlockLabels();
  const { choose, hover, menu, render } = useSuggestionPopup<BlockMenuItem>();
  const [imageAt, setImageAt] = useState<number | null>(null);
  const latest = useRef({ labels, self, targets });
  useEffect(() => {
    latest.current = { labels, self, targets };
  });
  const suggestion = useMemo(
    (): BlockMenuSuggestion => ({
      command: ({ editor, props, range }) => {
        if (props.kind === "artifact") {
          insertArtifactLink(editor, range, props.artifact);
        } else {
          applyBlock(editor, range, props.id, setImageAt);
        }
      },
      items: ({ query }) =>
        blockMenuItems(
          query,
          latest.current.labels,
          latest.current.targets,
          latest.current.self
        ),
      render,
    }),
    [render]
  );
  const closeImage = useCallback(() => setImageAt(null), []);
  return { choose, closeImage, hover, imageAt, menu, suggestion };
}

/** The `/` menu at the caret, and the image dialog its "Image" opens. */
export function BlockMenu({
  editor,
  state,
  target,
}: {
  readonly editor: Editor;
  readonly state: BlockMenuState;
  /** The editable element, once it's mounted. */
  readonly target: HTMLElement | null;
}) {
  const { t } = useLingui();
  const id = useId();
  const labels = useBlockLabels();
  const { choose, closeImage, hover, imageAt, menu } = state;
  const renderItem = useCallback(
    (item: BlockMenuItem) =>
      item.kind === "block" ? (
        <>
          {ICONS[item.id]}
          <MenuLabel hint={SHORTCUTS[item.id]} label={labels[item.id]} mono />
        </>
      ) : (
        <>
          <FileTextIcon aria-hidden />
          <MenuLabel label={item.artifact.title} />
        </>
      ),
    [labels]
  );
  const linking = menu ? blockMenuStage(menu.query).stage === "link" : false;
  return (
    <>
      <SuggestionPopup
        id={id}
        itemKey={itemKey}
        menu={menu}
        onChoose={choose}
        onHover={hover}
        renderItem={renderItem}
        target={target}
        title={linking ? t`Link to artifact` : t`Insert block`}
      />
      <ImageDialog at={imageAt} editor={editor} onClose={closeImage} />
    </>
  );
}

interface ImageInput {
  readonly alt: string;
  readonly src: string;
}

function ImageDialog({
  at,
  editor,
  onClose,
}: {
  readonly at: number | null;
  readonly editor: Editor;
  readonly onClose: () => void;
}) {
  const open = at !== null;
  const close = useCallback(
    (image?: ImageInput) => {
      // The document may have changed under the dialog (a version loaded).
      const chain = editor
        .chain()
        .focus()
        .setTextSelection(Math.min(at ?? 0, editor.state.doc.content.size));
      if (image) {
        chain.setImage({ alt: image.alt || undefined, src: image.src }).run();
      } else {
        chain.run();
      }
      onClose();
    },
    [at, editor, onClose]
  );
  const changeOpen = useCallback(
    (next: boolean) => {
      if (!next) {
        close();
      }
    },
    [close]
  );
  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            <Trans>Insert image</Trans>
          </DialogTitle>
        </DialogHeader>
        {open ? <ImageForm onSubmit={close} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function ImageForm({
  onSubmit,
}: {
  readonly onSubmit: (image: {
    readonly alt: string;
    readonly src: string;
  }) => void;
}) {
  const { t } = useLingui();
  const id = useId();
  const [src, setSrc] = useState("");
  const [alt, setAlt] = useState("");
  const [invalid, setInvalid] = useState(false);
  const changeSrc = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setSrc(event.target.value);
    setInvalid(false);
  }, []);
  const changeAlt = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => setAlt(event.target.value),
    []
  );
  const send = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!isSafeImageUrl(src)) {
        setInvalid(true);
        return;
      }
      onSubmit({ alt: alt.trim(), src: src.trim() });
    },
    [alt, onSubmit, src]
  );
  return (
    <form className="flex flex-col gap-4" onSubmit={send}>
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${id}-src`}>
            <Trans>Image address</Trans>
          </FieldLabel>
          <Input
            aria-describedby={invalid ? `${id}-problem` : undefined}
            aria-invalid={invalid}
            autoFocus
            id={`${id}-src`}
            inputMode="url"
            onChange={changeSrc}
            placeholder="https://"
            value={src}
          />
          {invalid ? (
            <FieldError id={`${id}-problem`}>
              <Trans>Use an https:// address or a file in this app.</Trans>
            </FieldError>
          ) : null}
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-alt`}>
            <Trans>Description (optional)</Trans>
          </FieldLabel>
          <Input
            id={`${id}-alt`}
            onChange={changeAlt}
            placeholder={t`What the image shows`}
            value={alt}
          />
        </Field>
      </FieldGroup>
      <DialogFooter>
        <Button type="submit">
          <Trans>Insert</Trans>
        </Button>
      </DialogFooter>
    </form>
  );
}
