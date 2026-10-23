"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { isSafeImageUrl } from "@workspace/artifacts-kit/kinds/document/checks";
import {
  ChevronDownIcon,
  CircleCheckIcon,
  CodeIcon,
  ImageIcon,
  LayoutGridIcon,
  LinkIcon,
  ListIcon,
  MinusIcon,
  RotateCcwIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import { Input } from "@workspace/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@workspace/ui/components/popover";
import { Separator } from "@workspace/ui/components/separator";
import { Toggle } from "@workspace/ui/components/toggle";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  useCallback,
  useId,
  useState,
} from "react";

// The document editor's toolbar (126), after Claude's document view: the
// block type (text or a heading), marks, lists and a checklist, then what
// goes in a document (a table, an image by its address, code, a divider).
// Every control says what it does to a screen reader and shows whether it
// applies where the cursor is.

const HEADINGS = [1, 2, 3] as const;
type Block = "paragraph" | `h${(typeof HEADINGS)[number]}`;

const SAFE_URL = /^(?:https?:|mailto:|\/(?!\/)|#)/i;

const isLinkAddress = (value: string) => SAFE_URL.test(value);

type Command = (editor: Editor) => void;

/** What each control does, written once so a control's handler is stable. */
const COMMANDS = {
  blockquote: (editor) => editor.chain().focus().toggleBlockquote().run(),
  bold: (editor) => editor.chain().focus().toggleBold().run(),
  bulletList: (editor) => editor.chain().focus().toggleBulletList().run(),
  code: (editor) => editor.chain().focus().toggleCode().run(),
  codeBlock: (editor) => editor.chain().focus().toggleCodeBlock().run(),
  divider: (editor) => editor.chain().focus().setHorizontalRule().run(),
  italic: (editor) => editor.chain().focus().toggleItalic().run(),
  orderedList: (editor) => editor.chain().focus().toggleOrderedList().run(),
  strike: (editor) => editor.chain().focus().toggleStrike().run(),
  table: (editor) =>
    editor
      .chain()
      .focus()
      .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
      .run(),
  taskList: (editor) => editor.chain().focus().toggleTaskList().run(),
  undo: (editor) => editor.chain().focus().undo().run(),
} satisfies Record<string, Command>;

export function DocumentToolbar({ editor }: { readonly editor: Editor }) {
  const { t } = useLingui();
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      block: ((): Block => {
        for (const level of HEADINGS) {
          if (current.isActive("heading", { level })) {
            return `h${level}`;
          }
        }
        return "paragraph";
      })(),
      bold: current.isActive("bold"),
      bulletList: current.isActive("bulletList"),
      canUndo: current.can().undo(),
      code: current.isActive("code"),
      codeBlock: current.isActive("codeBlock"),
      italic: current.isActive("italic"),
      link: current.isActive("link"),
      orderedList: current.isActive("orderedList"),
      quote: current.isActive("blockquote"),
      strike: current.isActive("strike"),
      taskList: current.isActive("taskList"),
    }),
  });
  const blockLabels: Record<Block, string> = {
    h1: t`Heading 1`,
    h2: t`Heading 2`,
    h3: t`Heading 3`,
    paragraph: t`Text`,
  };
  const setBlock = useCallback(
    (value: unknown) => {
      if (value === "paragraph") {
        editor.chain().focus().setParagraph().run();
        return;
      }
      const level = HEADINGS.find((each) => value === `h${each}`);
      if (level) {
        editor.chain().focus().setHeading({ level }).run();
      }
    },
    [editor]
  );

  return (
    <div
      aria-label={t`Formatting`}
      className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b px-2 py-1"
      data-slot="document-toolbar"
      role="toolbar"
    >
      <Action
        command={COMMANDS.undo}
        disabled={!active.canUndo}
        editor={editor}
        label={t`Undo`}
      >
        <RotateCcwIcon aria-hidden />
      </Action>
      <Bar />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              aria-label={t`Text style: ${blockLabels[active.block]}`}
              className="min-w-28 justify-between"
              size="sm"
              variant="ghost"
            />
          }
        >
          {blockLabels[active.block]}
          <ChevronDownIcon aria-hidden data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-44">
          <DropdownMenuGroup>
            <DropdownMenuRadioGroup
              onValueChange={setBlock}
              value={active.block}
            >
              <DropdownMenuRadioItem closeOnClick value="paragraph">
                <Trans>Text</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                className="font-semibold text-xl"
                closeOnClick
                value="h1"
              >
                <Trans>Heading 1</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                className="font-semibold text-lg"
                closeOnClick
                value="h2"
              >
                <Trans>Heading 2</Trans>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem
                className="font-semibold"
                closeOnClick
                value="h3"
              >
                <Trans>Heading 3</Trans>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <Bar />
      <Mark
        command={COMMANDS.bold}
        editor={editor}
        label={t`Bold`}
        on={active.bold}
      >
        <span aria-hidden className="font-bold">
          B
        </span>
      </Mark>
      <Mark
        command={COMMANDS.italic}
        editor={editor}
        label={t`Italic`}
        on={active.italic}
      >
        <span aria-hidden className="font-serif italic">
          I
        </span>
      </Mark>
      <Mark
        command={COMMANDS.strike}
        editor={editor}
        label={t`Strikethrough`}
        on={active.strike}
      >
        <span aria-hidden className="line-through">
          S
        </span>
      </Mark>
      <Mark
        command={COMMANDS.code}
        editor={editor}
        label={t`Inline code`}
        on={active.code}
      >
        <span aria-hidden className="font-mono text-xs">
          {"<>"}
        </span>
      </Mark>
      <LinkButton active={active.link} editor={editor} />
      <Bar />
      <Mark
        command={COMMANDS.bulletList}
        editor={editor}
        label={t`Bulleted list`}
        on={active.bulletList}
      >
        <ListIcon aria-hidden />
      </Mark>
      <Mark
        command={COMMANDS.orderedList}
        editor={editor}
        label={t`Numbered list`}
        on={active.orderedList}
      >
        <span aria-hidden className="font-medium text-xs tabular-nums">
          1.
        </span>
      </Mark>
      <Mark
        command={COMMANDS.taskList}
        editor={editor}
        label={t`Checklist`}
        on={active.taskList}
      >
        <CircleCheckIcon aria-hidden />
      </Mark>
      <Mark
        command={COMMANDS.blockquote}
        editor={editor}
        label={t`Quote`}
        on={active.quote}
      >
        <span aria-hidden className="font-serif text-lg leading-none">
          “
        </span>
      </Mark>
      <Bar />
      <Action command={COMMANDS.table} editor={editor} label={t`Insert table`}>
        <LayoutGridIcon aria-hidden />
      </Action>
      <ImageButton editor={editor} />
      <Mark
        command={COMMANDS.codeBlock}
        editor={editor}
        label={t`Code block`}
        on={active.codeBlock}
      >
        <CodeIcon aria-hidden />
      </Mark>
      <Action
        command={COMMANDS.divider}
        editor={editor}
        label={t`Insert divider`}
      >
        <MinusIcon aria-hidden />
      </Action>
    </div>
  );
}

function Bar() {
  return (
    <Separator className="mx-1 data-vertical:h-5" orientation="vertical" />
  );
}

interface ControlProps {
  readonly children: ReactNode;
  readonly command: Command;
  readonly editor: Editor;
  readonly label: string;
}

/** A mark or block that's on or off where the cursor is. */
function Mark({
  children,
  command,
  editor,
  label,
  on,
}: ControlProps & { readonly on: boolean }) {
  const press = useCallback(() => command(editor), [command, editor]);
  return (
    <Toggle
      aria-label={label}
      onPressedChange={press}
      pressed={on}
      size="sm"
      title={label}
    >
      {children}
    </Toggle>
  );
}

/** Something done once: undo, insert a table or a divider. */
function Action({
  children,
  command,
  disabled = false,
  editor,
  label,
}: ControlProps & { readonly disabled?: boolean }) {
  const press = useCallback(() => command(editor), [command, editor]);
  return (
    <Button
      aria-label={label}
      disabled={disabled}
      onClick={press}
      size="icon-sm"
      title={label}
      variant="ghost"
    >
      {children}
    </Button>
  );
}

/** A small form in a popover: one address, checked before it's used. */
function AddressForm({
  check,
  initial = "",
  label,
  onCancel,
  onSubmit,
  problem,
  submit,
}: {
  readonly check: (value: string) => boolean;
  readonly initial?: string;
  readonly label: string;
  readonly onCancel?: () => void;
  readonly onSubmit: (value: string) => void;
  readonly problem: string;
  readonly submit: string;
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [shown, setShown] = useState(false);
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setValue(event.target.value);
    setShown(false);
  }, []);
  const send = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = value.trim();
      if (trimmed !== "" && !check(trimmed)) {
        setShown(true);
        return;
      }
      onSubmit(trimmed);
    },
    [check, onSubmit, value]
  );
  return (
    <form className="flex flex-col gap-2" onSubmit={send}>
      <label className="font-medium text-sm" htmlFor={id}>
        {label}
      </label>
      <Input
        aria-describedby={shown ? `${id}-problem` : undefined}
        aria-invalid={shown}
        autoFocus
        id={id}
        inputMode="url"
        onChange={change}
        placeholder="https://"
        value={value}
      />
      {shown ? (
        <p className="text-destructive text-xs" id={`${id}-problem`}>
          {problem}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            <Trans>Remove</Trans>
          </Button>
        ) : null}
        <Button size="sm" type="submit">
          {submit}
        </Button>
      </div>
    </form>
  );
}

function LinkButton({
  active,
  editor,
}: {
  readonly active: boolean;
  readonly editor: Editor;
}) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const current =
    (editor.getAttributes("link") as { readonly href?: string }).href ?? "";
  const apply = useCallback(
    (href: string) => {
      const chain = editor.chain().focus().extendMarkRange("link");
      if (href === "") {
        chain.unsetLink().run();
      } else {
        chain.setLink({ href }).run();
      }
      setOpen(false);
    },
    [editor]
  );
  const remove = useCallback(() => apply(""), [apply]);
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Toggle
            aria-label={t`Link`}
            pressed={active}
            size="sm"
            title={t`Link`}
          />
        }
      >
        <LinkIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {open ? (
          <AddressForm
            check={isLinkAddress}
            initial={current}
            label={t`Link address`}
            onCancel={current ? remove : undefined}
            onSubmit={apply}
            problem={t`Use a web (https://) or email (mailto:) address.`}
            submit={t`Apply`}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function ImageButton({ editor }: { readonly editor: Editor }) {
  const { t } = useLingui();
  const [open, setOpen] = useState(false);
  const insert = useCallback(
    (src: string) => {
      if (src !== "") {
        editor.chain().focus().setImage({ src }).run();
      }
      setOpen(false);
    },
    [editor]
  );
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={t`Insert image`}
            className={cn(open && "bg-muted")}
            size="icon-sm"
            title={t`Insert image`}
            variant="ghost"
          />
        }
      >
        <ImageIcon aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80">
        {open ? (
          <AddressForm
            check={isSafeImageUrl}
            label={t`Image address`}
            onSubmit={insert}
            problem={t`Images load over https.`}
            submit={t`Insert`}
          />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
