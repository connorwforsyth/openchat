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
  useState,
} from "react";

// "Save as site" (125): a folder of the workspace becomes a Site artifact,
// if it passes the site checks. The dialog asks for the folder and a title,
// and lists whatever the checks found, for the person (or the agent) to fix.

/** Saves the folder at `path`; resolves to the checks' problems, or `null` once saved. */
export type SaveSite = (
  path: string,
  title: string
) => Promise<readonly string[] | null>;

export function SaveSiteDialog({
  onOpenChange,
  onSave,
  open,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onSave: SaveSite;
  readonly open: boolean;
}) {
  const { t } = useLingui();
  const folderId = useId();
  const titleId = useId();
  const [folder, setFolder] = useState("");
  const [title, setTitle] = useState("");
  const [problems, setProblems] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const changeFolder = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setFolder(event.target.value);
    setProblems([]);
  }, []);
  const changeTitle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setTitle(event.target.value);
  }, []);
  const openChange = useCallback(
    (next: boolean) => {
      if (!next) {
        setFolder("");
        setTitle("");
        setProblems([]);
        setSaved(null);
      }
      onOpenChange(next);
    },
    [onOpenChange]
  );
  const done = useCallback(() => openChange(false), [openChange]);
  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setBusy(true);
      const name = title.trim();
      const found = await onSave(folder.trim() || ".", name);
      setBusy(false);
      if (found) {
        setProblems(found);
      } else {
        setSaved(name);
      }
    },
    [folder, onSave, title]
  );

  return (
    <Dialog onOpenChange={openChange} open={open}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>
              <Trans>Save as site</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                A folder of plain HTML, CSS and JavaScript, with an index.html,
                becomes a site you can preview and publish. Build an app first
                and save the folder it builds to.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          {saved === null ? (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-sm" htmlFor={folderId}>
                  <Trans>Folder</Trans>
                </label>
                <Input
                  autoComplete="off"
                  id={folderId}
                  onChange={changeFolder}
                  placeholder={t`site (the whole workspace if empty)`}
                  value={folder}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="font-medium text-sm" htmlFor={titleId}>
                  <Trans>Title</Trans>
                </label>
                <Input
                  autoComplete="off"
                  id={titleId}
                  maxLength={200}
                  onChange={changeTitle}
                  value={title}
                />
              </div>
              {problems.length > 0 ? (
                <div className="text-destructive text-sm" role="alert">
                  <p>
                    <Trans>It can't be saved as a site yet:</Trans>
                  </p>
                  <ul className="mt-1 list-disc ps-5">
                    {problems.map((problem) => (
                      <li key={problem}>{problem}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <p className="text-sm" role="status">
              <Trans>
                Saved "{saved}". It's with this chat's artifacts, and on your
                Artifacts page.
              </Trans>
            </p>
          )}
          <DialogFooter>
            {saved === null ? (
              <Button disabled={busy || title.trim() === ""} type="submit">
                <Trans>Save as site</Trans>
              </Button>
            ) : (
              <Button onClick={done} type="button">
                <Trans>Done</Trans>
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
