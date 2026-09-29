"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useId,
  useRef,
  useState,
} from "react";

import type { FileNameProblem } from "./model/editor";
import { parseNewFileName } from "./model/editor";

// "New file": asks for a name, then the panel creates it empty (only if the
// name is free) and opens it.

/** Creates `path`; resolves to an error message, or `null` once it exists. */
export type CreateFile = (path: string) => Promise<string | null>;

export function NewFileDialog({
  onCreate,
  onOpenChange,
  open,
}: {
  readonly onCreate: CreateFile;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) {
  const { t } = useLingui();
  const inputId = useId();
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setName(event.target.value);
    setProblem(null);
  }, []);
  const openChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setName("");
        setProblem(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );

  const problems = {
    directory: t`That's a folder name. Add a file name after the slash.`,
    empty: t`Give the file a name.`,
    outside: t`File names can't use . or .. to leave the workspace.`,
  } satisfies Record<FileNameProblem, string>;
  const create = async (value: string) => {
    setBusy(true);
    const failed = await onCreate(value);
    setBusy(false);
    if (failed) {
      setProblem(failed);
    } else {
      openChange(false);
    }
  };
  const latest = useRef({ create, problems });
  latest.current = { create, problems };
  const submit = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      const parsed = parseNewFileName(name);
      if (parsed.ok) {
        latest.current.create(parsed.value).catch(() => undefined);
      } else {
        setProblem(latest.current.problems[parsed.error]);
      }
    },
    [name]
  );

  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogContent className="sm:max-w-sm">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Trans>New file</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                Add it to this chat's workspace, where you and the agent can
                both edit it.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1.5">
            <label className="font-medium text-sm" htmlFor={inputId}>
              <Trans>Name</Trans>
            </label>
            <Input
              aria-describedby={problem ? `${inputId}-problem` : undefined}
              aria-invalid={problem !== null}
              autoComplete="off"
              autoFocus
              id={inputId}
              onChange={change}
              placeholder={t`notes.md`}
              spellCheck={false}
              value={name}
            />
            {problem ? (
              <p
                className="text-destructive text-sm"
                id={`${inputId}-problem`}
                role="alert"
              >
                {problem}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button disabled={busy} type="submit">
              <Trans>Create</Trans>
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
