"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ArrowUpIcon,
  ChevronDownIcon,
  CopyIcon,
  FileTextIcon,
  PlusIcon,
  ReasoningIcon,
  RefreshCwIcon,
  ToolIcon,
  XIcon,
} from "@workspace/icons";
import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentMedia,
  AttachmentTitle,
} from "@workspace/ui/components/attachment";
import { Bubble, BubbleContent } from "@workspace/ui/components/bubble";
import { Button } from "@workspace/ui/components/button";
import {
  CodeBlock,
  CodeBlockContent,
} from "@workspace/ui/components/code-block";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@workspace/ui/components/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupTextarea,
} from "@workspace/ui/components/input-group";
import { Markdown } from "@workspace/ui/components/markdown";
import {
  Message,
  MessageContent,
  MessageFooter,
} from "@workspace/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@workspace/ui/components/trace";
import {
  type ChangeEvent,
  type ComponentProps,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

// Stand-ins for what users type and models return. That's content, not UI
// copy, so it stays out of the Lingui catalog.
const sample = {
  answer: `Here's a quick comparison of the two approaches:

| Approach | Latency | Cost |
| --- | --- | --- |
| Streaming | Low | Same |
| Batch | High | Lower |

**Streaming** shows tokens as they arrive, so the reply *feels* faster.

\`\`\`ts
const result = streamText({ model, prompt });
\`\`\`
`,
  models: [
    { label: "Llama 3.2 (Ollama)", value: "llama3.2" },
    { label: "Qwen 2.5 Coder (Ollama)", value: "qwen2.5-coder" },
  ],
  question: "Should I stream model responses or batch them?",
  reasoning: `The user is weighing **streaming** against **batching**.

1. Streaming improves perceived latency.
2. Batching can be cheaper for offline jobs.

A small table should make the trade-off clear.`,
  tool: "web_search",
  toolError: "The search provider timed out after 10 s.",
  toolOutput: JSON.stringify(
    {
      results: [
        { title: "Streaming responses", url: "https://example.com/streaming" },
        { title: "Batch inference", url: "https://example.com/batch" },
      ],
    },
    null,
    2
  ),
} as const;

const Section = ({
  title,
  children,
}: {
  title: ReactNode;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <h2 className="font-medium text-muted-foreground text-sm">{title}</h2>
    {children}
  </section>
);

/** A ghost icon button with its label as a tooltip (shadcn's Message pattern). */
const MessageAction = ({
  children,
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }) => (
  <Tooltip>
    <TooltipTrigger
      render={
        <Button aria-label={label} size="icon-sm" variant="ghost" {...props} />
      }
    >
      {children}
    </TooltipTrigger>
    <TooltipContent>
      <p>{label}</p>
    </TooltipContent>
  </Tooltip>
);

const Conversation = () => {
  const { t } = useLingui();
  const copyAnswer = useCallback(() => {
    // Clipboard access can be denied; copying is best-effort in a demo.
    navigator.clipboard.writeText(sample.answer).catch(() => undefined);
  }, []);
  const noop = useCallback(() => undefined, []);
  const { tool } = sample;

  return (
    <div className="h-[36rem] rounded-lg border border-border">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              <MessageScrollerItem messageId="user-1" scrollAnchor>
                <Message align="end">
                  <MessageContent>
                    <Bubble align="end" variant="muted">
                      <BubbleContent>{sample.question}</BubbleContent>
                    </Bubble>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
              <MessageScrollerItem messageId="assistant-1">
                <Message>
                  <MessageContent className="gap-4">
                    <Trace>
                      <TraceCollapsible>
                        <TraceCollapsibleTrigger>
                          <TraceLine>
                            <TraceIcon>
                              <ReasoningIcon />
                            </TraceIcon>
                            <TraceTitle>
                              <Trans>Thought for 4 seconds</Trans>
                            </TraceTitle>
                          </TraceLine>
                        </TraceCollapsibleTrigger>
                        <TraceCollapsibleContent className="text-sm">
                          <Markdown>{sample.reasoning}</Markdown>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                      <TraceCollapsible defaultOpen>
                        <TraceCollapsibleTrigger>
                          <TraceLine>
                            <TraceIcon>
                              <ToolIcon />
                            </TraceIcon>
                            <TraceTitle>
                              <Trans>Ran {tool}</Trans>
                            </TraceTitle>
                          </TraceLine>
                        </TraceCollapsibleTrigger>
                        <TraceCollapsibleContent>
                          <CodeBlock size="sm">
                            <CodeBlockContent className="max-h-64" wrap>
                              {sample.toolOutput}
                            </CodeBlockContent>
                          </CodeBlock>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                      <TraceCollapsible>
                        <TraceCollapsibleTrigger>
                          <TraceLine status="error">
                            <TraceIcon>
                              <ToolIcon />
                            </TraceIcon>
                            <TraceTitle>
                              <Trans>Failed to run {tool}</Trans>
                            </TraceTitle>
                          </TraceLine>
                        </TraceCollapsibleTrigger>
                        <TraceCollapsibleContent>
                          <CodeBlock size="sm" variant="destructive">
                            <CodeBlockContent wrap>
                              {sample.toolError}
                            </CodeBlockContent>
                          </CodeBlock>
                        </TraceCollapsibleContent>
                      </TraceCollapsible>
                      <TraceLine status="running">
                        <TraceIcon>
                          <ToolIcon />
                        </TraceIcon>
                        <TraceTitle>
                          <Trans>Running {tool}</Trans>
                        </TraceTitle>
                      </TraceLine>
                    </Trace>
                    <Markdown>{sample.answer}</Markdown>
                    <MessageFooter className="px-0">
                      <MessageAction label={t`Copy`} onClick={copyAnswer}>
                        <CopyIcon />
                      </MessageAction>
                      <MessageAction label={t`Retry`} onClick={noop}>
                        <RefreshCwIcon />
                      </MessageAction>
                    </MessageFooter>
                  </MessageContent>
                </Message>
              </MessageScrollerItem>
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
    </div>
  );
};

interface DemoFile {
  readonly id: string;
  readonly name: string;
}

const FileChip = ({
  file,
  onRemove,
}: {
  file: DemoFile;
  onRemove: (id: string) => void;
}) => {
  const { t } = useLingui();
  const remove = useCallback(() => onRemove(file.id), [file.id, onRemove]);
  const { name } = file;
  return (
    <Attachment size="sm">
      <AttachmentMedia>
        <FileTextIcon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{name}</AttachmentTitle>
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={t`Remove ${name}`} onClick={remove}>
          <XIcon />
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
};

// shadcn's Prompt Input pattern: an Input Group with attachments above the
// field and the actions below it.
const Composer = () => {
  const { t } = useLingui();
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<readonly DemoFile[]>([]);
  const [model, setModel] = useState<string>(sample.models[0].value);
  const [submitted, setSubmitted] = useState<string | null>(null);
  const current =
    sample.models.find((item) => item.value === model) ?? sample.models[0];
  const canSend = text.trim().length > 0;

  // No model behind this demo: echo what would have been sent.
  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (!canSend) {
        return;
      }
      setSubmitted(text);
      setText("");
      setFiles([]);
    },
    [canSend, text]
  );
  const attach = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const picked = event.target.files;
    if (!picked) {
      return;
    }
    const added = Array.from(picked, (file) => ({
      id: crypto.randomUUID(),
      name: file.name,
    }));
    setFiles((list) => [...list, ...added]);
    event.target.value = "";
  }, []);
  const remove = useCallback(
    (id: string) => setFiles((list) => list.filter((file) => file.id !== id)),
    []
  );
  const type = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    []
  );
  const keyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault();
      formRef.current?.requestSubmit();
    }
  }, []);
  const pickFiles = useCallback(() => inputRef.current?.click(), []);

  return (
    <div className="flex flex-col gap-2">
      <form onSubmit={submit} ref={formRef}>
        <input
          className="sr-only"
          multiple
          onChange={attach}
          ref={inputRef}
          tabIndex={-1}
          type="file"
        />
        <InputGroup>
          {files.length > 0 ? (
            <InputGroupAddon align="block-start" className="flex-wrap">
              {files.map((file) => (
                <FileChip file={file} key={file.id} onRemove={remove} />
              ))}
            </InputGroupAddon>
          ) : null}
          <InputGroupTextarea
            className="p-3"
            onChange={type}
            onKeyDown={keyDown}
            placeholder={t`What would you like to know?`}
            value={text}
          />
          <InputGroupAddon align="block-end">
            <InputGroupButton
              aria-label={t`Attach files`}
              className="rounded-full"
              onClick={pickFiles}
              size="icon-sm"
              variant="outline"
            >
              <PlusIcon />
            </InputGroupButton>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <InputGroupButton
                    aria-label={t`Model: ${current.label}`}
                    className="ms-auto"
                    size="sm"
                    variant="ghost"
                  />
                }
              >
                {current.label}
                <ChevronDownIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup onValueChange={setModel} value={model}>
                  {sample.models.map((item) => (
                    <DropdownMenuRadioItem
                      closeOnClick
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <InputGroupButton
              aria-label={t`Send`}
              className="rounded-full"
              disabled={!canSend}
              size="icon-sm"
              type="submit"
              variant="default"
            >
              <ArrowUpIcon />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      {submitted === null ? null : (
        <p className="text-muted-foreground text-xs">
          <Trans>Would send “{submitted}”.</Trans>
        </p>
      )}
    </div>
  );
};

export const AiElementsDemo = () => (
  <>
    <Section title={<Trans>Message, reasoning and tool</Trans>}>
      <Conversation />
    </Section>
    <Section title={<Trans>Prompt input</Trans>}>
      <Composer />
    </Section>
  </>
);
