"use client";

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { CopyIcon, RefreshCwIcon } from "@workspace/icons";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageBranch,
  MessageBranchContent,
  MessageBranchNext,
  MessageBranchPage,
  MessageBranchPrevious,
  MessageBranchSelector,
  MessageContent,
  MessageResponse,
  MessageToolbar,
} from "@workspace/ui/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSpeechButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@workspace/ui/components/ai-elements/prompt-input";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@workspace/ui/components/ai-elements/reasoning";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@workspace/ui/components/ai-elements/tool";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@workspace/ui/components/message-scroller";
import { type ReactNode, useCallback, useRef, useState } from "react";

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
  answerAlt:
    "In short: stream when someone is waiting on the answer, batch when nobody is.",
  models: [
    { label: "Llama 3.2 (Ollama)", value: "llama3.2" },
    { label: "Qwen 2.5 Coder (Ollama)", value: "qwen2.5-coder" },
  ],
  question: "Should I stream model responses or batch them?",
  reasoning: `The user is weighing **streaming** against **batching**.

1. Streaming improves perceived latency.
2. Batching can be cheaper for offline jobs.

A small table should make the trade-off clear.`,
  toolError: "The search provider timed out after 10 s.",
  toolInput: { query: "streaming vs batch LLM responses", results: 3 },
  toolOutput: {
    results: [
      { title: "Streaming responses", url: "https://example.com/streaming" },
      { title: "Batch inference", url: "https://example.com/batch" },
    ],
  },
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

const Conversation = () => {
  const { t } = useLingui();
  const copyAnswer = useCallback(() => {
    // Clipboard access can be denied; copying is best-effort in a demo.
    navigator.clipboard.writeText(sample.answer).catch(() => undefined);
  }, []);
  const noop = useCallback(() => undefined, []);

  return (
    <div className="h-[36rem] rounded-lg border border-border">
      <MessageScrollerProvider autoScroll>
        <MessageScroller>
          <MessageScrollerViewport>
            <MessageScrollerContent className="p-4">
              <MessageScrollerItem messageId="user-1" scrollAnchor>
                <Message from="user">
                  <MessageContent>{sample.question}</MessageContent>
                </Message>
              </MessageScrollerItem>
              <MessageScrollerItem messageId="assistant-1">
                <Message from="assistant">
                  <MessageContent>
                    <Reasoning defaultOpen={false} duration={4}>
                      <ReasoningTrigger />
                      <ReasoningContent>{sample.reasoning}</ReasoningContent>
                    </Reasoning>
                    <Tool defaultOpen>
                      <ToolHeader
                        state="output-available"
                        type="tool-web_search"
                      />
                      <ToolContent>
                        <ToolInput input={sample.toolInput} />
                        <ToolOutput
                          errorText={undefined}
                          output={sample.toolOutput}
                        />
                      </ToolContent>
                    </Tool>
                    <Tool>
                      <ToolHeader state="output-error" type="tool-web_search" />
                      <ToolContent>
                        <ToolInput input={sample.toolInput} />
                        <ToolOutput
                          errorText={sample.toolError}
                          output={undefined}
                        />
                      </ToolContent>
                    </Tool>
                    <MessageBranch>
                      <MessageBranchContent>
                        <MessageResponse key="branch-1">
                          {sample.answer}
                        </MessageResponse>
                        <MessageResponse key="branch-2">
                          {sample.answerAlt}
                        </MessageResponse>
                      </MessageBranchContent>
                      <MessageToolbar>
                        <MessageBranchSelector from="assistant">
                          <MessageBranchPrevious />
                          <MessageBranchPage />
                          <MessageBranchNext />
                        </MessageBranchSelector>
                        <MessageActions>
                          <MessageAction onClick={copyAnswer} tooltip={t`Copy`}>
                            <CopyIcon />
                          </MessageAction>
                          <MessageAction onClick={noop} tooltip={t`Retry`}>
                            <RefreshCwIcon />
                          </MessageAction>
                        </MessageActions>
                      </MessageToolbar>
                    </MessageBranch>
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

const SubmittedNote = ({
  text,
  fileCount,
}: {
  text: string;
  fileCount: number;
}) => (
  <p className="text-muted-foreground text-xs">
    <Trans>
      Would send “{text}” with{" "}
      <Plural one="# attachment" other="# attachments" value={fileCount} />.
    </Trans>
  </p>
);

const Composer = () => {
  const { t } = useLingui();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [submitted, setSubmitted] = useState<PromptInputMessage | null>(null);

  // No model behind this demo: echo what would have been sent.
  const handleSubmit = useCallback((message: PromptInputMessage) => {
    setSubmitted(message);
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <PromptInput globalDrop multiple onSubmit={handleSubmit}>
        <PromptInputHeader>
          <PromptInputAttachments>
            {(attachment) => <PromptInputAttachment data={attachment} />}
          </PromptInputAttachments>
        </PromptInputHeader>
        <PromptInputBody>
          <PromptInputTextarea ref={textareaRef} />
        </PromptInputBody>
        <PromptInputFooter>
          <PromptInputTools>
            <PromptInputActionMenu>
              <PromptInputActionMenuTrigger />
              <PromptInputActionMenuContent>
                <PromptInputActionAddAttachments />
              </PromptInputActionMenuContent>
            </PromptInputActionMenu>
            <PromptInputSpeechButton textareaRef={textareaRef} />
            <PromptInputSelect
              defaultValue={sample.models[0].value}
              items={sample.models}
            >
              <PromptInputSelectTrigger aria-label={t`Model`}>
                <PromptInputSelectValue />
              </PromptInputSelectTrigger>
              <PromptInputSelectContent>
                {sample.models.map((model) => (
                  <PromptInputSelectItem key={model.value} value={model.value}>
                    {model.label}
                  </PromptInputSelectItem>
                ))}
              </PromptInputSelectContent>
            </PromptInputSelect>
          </PromptInputTools>
          <PromptInputSubmit status="ready" />
        </PromptInputFooter>
      </PromptInput>
      {submitted === null ? null : (
        <SubmittedNote
          fileCount={submitted.files.length}
          text={submitted.text}
        />
      )}
    </div>
  );
};

export const AiElementsDemo = () => (
  <>
    <Section title={<Trans>Conversation, message, reasoning and tool</Trans>}>
      <Conversation />
    </Section>
    <Section title={<Trans>Prompt input</Trans>}>
      <Composer />
    </Section>
  </>
);
