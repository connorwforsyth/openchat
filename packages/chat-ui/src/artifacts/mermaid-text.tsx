"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { QueryUtils } from "@workspace/client/api";
import type {
  Artifact,
  ArtifactVersion,
} from "@workspace/contract/schemas/files";
import { Button } from "@workspace/ui/components/button";
import { Textarea } from "@workspace/ui/components/textarea";
import { type ChangeEvent, useCallback, useState } from "react";

import { useSaveVersion } from "./editor/use-version-save";

// "Edit as text" (Connor, night 2): a Mermaid artifact is a Diagram whose
// format is text, so its source is where a person changes it. A save is a
// new version, through the kind's checks, like a document's edit.

type SaveState =
  | { readonly type: "idle" }
  | { readonly type: "saving" }
  | { readonly message: string; readonly type: "failed" };

export function MermaidText({
  api,
  artifactId,
  onSaved,
  version,
}: {
  readonly api: QueryUtils;
  readonly artifactId: Artifact["id"];
  /** The new version, to show it once it's saved. */
  readonly onSaved: (version: ArtifactVersion) => void;
  readonly version: ArtifactVersion;
}) {
  const { t } = useLingui();
  const save = useSaveVersion(api, artifactId);
  const [text, setText] = useState(version.content);
  const [state, setState] = useState<SaveState>({ type: "idle" });
  const change = useCallback(
    (event: ChangeEvent<HTMLTextAreaElement>) => setText(event.target.value),
    []
  );
  const submit = useCallback(async () => {
    setState({ type: "saving" });
    try {
      onSaved(await save({ baseVersionId: version.id, content: text }));
      setState({ type: "idle" });
    } catch (error) {
      setState({
        message: error instanceof Error ? error.message : String(error),
        type: "failed",
      });
    }
  }, [onSaved, save, text, version.id]);
  const unchanged = text === version.content;

  return (
    <div className="flex flex-col gap-2 p-3">
      <Textarea
        aria-label={t`Diagram source`}
        className="min-h-80 font-mono text-xs"
        onChange={change}
        spellCheck={false}
        value={text}
      />
      <div className="flex items-center gap-2">
        <Button
          disabled={unchanged || state.type === "saving"}
          onClick={submit}
          size="sm"
        >
          <Trans>Save</Trans>
        </Button>
        {state.type === "failed" ? (
          <p className="text-destructive text-sm" role="alert">
            <Trans>This version wasn't saved: {state.message}</Trans>
          </p>
        ) : null}
      </div>
    </div>
  );
}
