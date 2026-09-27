"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useHotkeyRecorder } from "@tanstack/react-hotkeys";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Kbd } from "@workspace/ui/components/kbd";
import { memo, useCallback, useState } from "react";

import { isOverridden, type RecordingError } from "../overrides";
import {
  getShortcut,
  type ShortcutDefinition,
  type ShortcutId,
} from "../registry";
import { useShortcuts } from "./context";
import { GroupHeading, groupShortcuts } from "./help-dialog";
import { ComboKbd } from "./shortcut-kbd";

// View, record and reset shortcuts (settings → Shortcuts). Recording uses
// TanStack's recorder: the next combo pressed is captured (Escape cancels,
// Backspace turns the shortcut off), checked for clashes and reserved browser
// keys, then saved through the provider's store.

interface Problem {
  readonly error: RecordingError;
  readonly id: ShortcutId;
}

const ProblemText = ({ error }: { readonly error: RecordingError }) => {
  const { i18n } = useLingui();
  switch (error.type) {
    case "invalid":
      return <Trans>Those keys can't be used as a shortcut.</Trans>;
    case "reserved":
      return (
        <Trans>Your browser keeps that combination; pick another one.</Trans>
      );
    case "conflict": {
      const other = i18n._(getShortcut(error.id).description);
      return <Trans>Already used by “{other}”.</Trans>;
    }
    default:
      return error satisfies never;
  }
};

interface ShortcutRowProps {
  readonly combos: readonly string[];
  readonly definition: ShortcutDefinition;
  readonly onCancel: () => void;
  readonly onRecord: (id: ShortcutId) => void;
  readonly onReset: (id: ShortcutId) => void;
  readonly overridden: boolean;
  readonly problem: RecordingError | null;
  readonly recording: boolean;
}

const ShortcutRow = memo(function ShortcutRowView({
  combos,
  definition,
  onCancel,
  onRecord,
  onReset,
  overridden,
  problem,
  recording,
}: ShortcutRowProps) {
  const { i18n, t } = useLingui();
  const description = i18n._(definition.description);
  const handleRecord = useCallback(
    () => onRecord(definition.id),
    [definition.id, onRecord]
  );
  const handleReset = useCallback(
    () => onReset(definition.id),
    [definition.id, onReset]
  );

  return (
    <li className="flex flex-col gap-1 px-3 py-2">
      <div className="flex min-h-8 items-center gap-3">
        <span className="min-w-0 flex-1 truncate">{description}</span>
        {recording ? (
          <Kbd aria-live="polite">
            <Trans>Press keys…</Trans>
          </Kbd>
        ) : (
          <span className="flex items-center gap-2">
            {combos.length > 0 ? (
              combos.map((combo) => <ComboKbd combo={combo} key={combo} />)
            ) : (
              <span className="text-muted-foreground text-xs">
                <Trans>Off</Trans>
              </span>
            )}
          </span>
        )}
        {recording ? (
          <Button onClick={onCancel} size="sm" variant="ghost">
            <Trans>Cancel</Trans>
          </Button>
        ) : (
          <Button
            aria-label={t`Record a shortcut for ${description}`}
            onClick={handleRecord}
            size="sm"
            variant="outline"
          >
            <Trans>Record</Trans>
          </Button>
        )}
        {overridden ? (
          <Button
            aria-label={t`Reset ${description}`}
            onClick={handleReset}
            size="sm"
            variant="ghost"
          >
            <Trans>Reset</Trans>
          </Button>
        ) : null}
      </div>
      {problem ? (
        <p className="text-destructive text-xs" role="alert">
          <ProblemText error={problem} />
        </p>
      ) : null}
    </li>
  );
});

export const ShortcutsEditor = () => {
  const {
    bindings,
    disable,
    overrides,
    platform,
    record,
    reset,
    resetAll,
    saveError,
  } = useShortcuts();
  const [recordingId, setRecordingId] = useState<ShortcutId | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const recorder = useHotkeyRecorder({
    onCancel: () => setRecordingId(null),
    onClear: () => {
      if (recordingId) {
        disable(recordingId);
      }
      setRecordingId(null);
    },
    onRecord: (hotkey) => {
      if (!recordingId) {
        return;
      }
      const result = record(recordingId, hotkey);
      setProblem(result.ok ? null : { error: result.error, id: recordingId });
      setRecordingId(null);
    },
    platform,
    // Record the character typed, not the physical key, so `?` and `[` mean
    // the same thing on any keyboard layout.
    recordBy: "key",
  });
  const { cancelRecording, startRecording } = recorder;

  const handleRecord = useCallback(
    (id: ShortcutId) => {
      setProblem(null);
      setRecordingId(id);
      startRecording();
    },
    [startRecording]
  );

  const handleCancel = useCallback(() => {
    cancelRecording();
    setRecordingId(null);
  }, [cancelRecording]);

  const anyOverridden = Object.keys(overrides).length > 0;

  return (
    <div className="flex flex-col gap-6">
      {saveError ? (
        <Alert>
          <AlertDescription>
            <Trans>
              Your changes work now but couldn't be saved, so they'll reset when
              you reload.
            </Trans>
          </AlertDescription>
        </Alert>
      ) : null}
      {groupShortcuts().map(([group, definitions]) => (
        <section className="flex flex-col gap-2" key={group}>
          <h3 className="font-medium text-muted-foreground text-xs">
            <GroupHeading group={group} />
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-lg border">
            {definitions.map((definition) => (
              <ShortcutRow
                combos={bindings.get(definition.id) ?? []}
                definition={definition}
                key={definition.id}
                onCancel={handleCancel}
                onRecord={handleRecord}
                onReset={reset}
                overridden={isOverridden(overrides, definition.id)}
                problem={problem?.id === definition.id ? problem.error : null}
                recording={recordingId === definition.id}
              />
            ))}
          </ul>
        </section>
      ))}
      <div className="flex items-center justify-between gap-4">
        <p className="text-muted-foreground text-xs">
          <Trans>
            While recording, Escape cancels and Backspace turns a shortcut off.
          </Trans>
        </p>
        <Button disabled={!anyOverridden} onClick={resetAll} variant="outline">
          <Trans>Reset all</Trans>
        </Button>
      </div>
    </div>
  );
};
