"use client";

import { Trans } from "@lingui/react/macro";
import { ComposerLoader } from "@workspace/composer/components/composer-loader";
import { AUTO_TARGET, contextOptionsFromMe } from "@workspace/composer/options";
import type {
  ComposerStatus,
  ComposerValue,
  PromptOption,
} from "@workspace/composer/schemas";
import {
  agentItem,
  fixtureId,
  me,
  modelOptions,
  publicConfig,
  userAda,
  userBo,
} from "@workspace/contract/fixtures";
import type { RunTarget } from "@workspace/contract/schemas/runs";
import type { ChatContext } from "@workspace/contract/schemas/tenancy";
import {
  type ChangeEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useState,
} from "react";

// Prompt templates stand in for a user's library. They're content, not UI
// copy, so they stay out of the Lingui catalog.
const prompts: PromptOption[] = [
  {
    definition: {
      command: "summarise",
      kind: "prompt",
      template: "Summarise the thread above in three bullet points.",
      variables: [],
    },
    description: "Three bullets, no preamble.",
    id: fixtureId("libraryItem", 40),
    name: "Summarise",
  },
  {
    definition: {
      command: "explain",
      kind: "prompt",
      template: "Explain {{topic}} to {{audience}}, with one example.",
      variables: [
        { description: "What to explain", name: "topic" },
        {
          default: "a new hire",
          description: "Who it's for",
          name: "audience",
        },
      ],
    },
    description: "Plain-language explainer.",
    id: fixtureId("libraryItem", 41),
    name: "Explain a concept",
  },
  {
    definition: {
      command: "review",
      kind: "prompt",
      template: "Review this {{language}} for bugs and naming:\n\n",
      variables: [{ name: "language" }],
    },
    description: "",
    id: fixtureId("libraryItem", 42),
    name: "Code review",
  },
];

const contexts = contextOptionsFromMe(me, publicConfig.policies.chatContexts);

const attachmentLimits = {
  maxFileSize: publicConfig.limits.uploadMaxMb * 1024 * 1024,
  maxFiles: 4,
};

// How long the pretend run streams before it finishes on its own.
const FAKE_RUN_MS = 3000;

/** What was sent, as JSON: files by name and size, since a File doesn't serialise. */
const describe = (value: ComposerValue) =>
  JSON.stringify(
    {
      ...value,
      attachments: value.attachments.map(({ file }) => ({
        name: file.name,
        size: file.size,
        type: file.type,
      })),
    },
    null,
    2
  );

function Toggle({
  checked,
  children,
  onChange,
}: {
  checked: boolean;
  children: ReactNode;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input
        checked={checked}
        className="size-4 accent-primary"
        onChange={onChange}
        type="checkbox"
      />
      {children}
    </label>
  );
}

export function ComposerDemo() {
  const [target, setTarget] = useState<RunTarget>(AUTO_TARGET);
  const [context, setContext] = useState<ChatContext>({ type: "personal" });
  const [status, setStatus] = useState<ComposerStatus>("ready");
  const [sent, setSent] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [disabled, setDisabled] = useState(false);

  useEffect(() => {
    if (status !== "streaming") {
      return;
    }
    const timer = setTimeout(() => setStatus("ready"), FAKE_RUN_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const handleSubmit = useCallback((value: ComposerValue) => {
    setSent(describe(value));
    setStatus("streaming");
    // The context is fixed once the chat has a first message (D17).
    setLocked(true);
  }, []);

  const handleStop = useCallback(() => setStatus("ready"), []);
  const toggleLocked = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setLocked(event.currentTarget.checked),
    []
  );
  const toggleDisabled = useCallback(
    (event: ChangeEvent<HTMLInputElement>) =>
      setDisabled(event.currentTarget.checked),
    []
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-4">
        <Toggle checked={locked} onChange={toggleLocked}>
          <Trans>Context locked</Trans>
        </Toggle>
        <Toggle checked={disabled} onChange={toggleDisabled}>
          <Trans>Disabled</Trans>
        </Toggle>
      </div>
      <ComposerLoader
        agents={[agentItem]}
        attachmentLimits={attachmentLimits}
        context={context}
        contextLocked={locked}
        contexts={contexts}
        disabled={disabled}
        models={modelOptions}
        onContextChange={setContext}
        onStop={handleStop}
        onSubmit={handleSubmit}
        onTargetChange={setTarget}
        people={[userAda, userBo]}
        prompts={prompts}
        status={status}
        target={target}
      />
      <section className="flex flex-col gap-2">
        <h2 className="font-medium text-muted-foreground text-sm">
          <Trans>Last submitted value</Trans>
        </h2>
        {sent === null ? (
          <p className="text-muted-foreground text-sm">
            <Trans>Nothing sent yet.</Trans>
          </p>
        ) : (
          <pre className="overflow-x-auto rounded-lg border border-border bg-muted p-3 font-mono text-xs">
            {sent}
          </pre>
        )}
      </section>
    </div>
  );
}
