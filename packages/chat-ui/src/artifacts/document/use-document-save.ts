"use client";

import type { ArtifactVersionId } from "@workspace/contract/schemas/common";
import type { ArtifactVersion } from "@workspace/contract/schemas/files";
import { useCallback, useEffect, useRef, useState } from "react";

// Saving a person's edits to a document (126): each pause in typing saves
// the document as a new version (`POST /artifacts/{id}/versions`), on top
// of the version they were editing. The state is always on screen, so a
// person knows whether what they see is kept.
//
// - `saved`: nothing waiting. `unsaved`: edits wait for the pause.
// - `saving`: a save is going. `error`: it failed; the edits are still here.
// - `conflict`: another version landed first (the model, or someone else):
//   the person picks theirs or the new one, nothing is lost silently.

export type DocumentSaveState =
  | "conflict"
  | "error"
  | "saved"
  | "saving"
  | "unsaved";

/** The save port: the next version on top of `baseVersionId`. */
export type SaveDocumentVersion = (input: {
  readonly baseVersionId: ArtifactVersionId;
  readonly content: string;
}) => Promise<ArtifactVersion>;

/** The save's bookkeeping between renders. */
interface Live {
  /** The version edits go on top of. */
  base: ArtifactVersionId;
  /** Another version landed first; nothing saves until the person picks. */
  conflicted: boolean;
  inFlight: Promise<boolean> | null;
  /** Versions this editor saved. */
  readonly mine: Set<ArtifactVersionId>;
  /** The document as edited, waiting to be saved. */
  pending: string | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** How long typing pauses before a save. */
export const SAVE_DELAY_MS = 800;

const isConflict = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  (error as { readonly code?: unknown }).code === "CONFLICT";

export interface DocumentSave {
  /** The version edits are saved on top of. */
  readonly baseVersionId: ArtifactVersionId;
  /** Records an edit (the whole document as it now stands) and saves after a pause. */
  readonly change: (content: string) => void;
  /** Saves now; `true` once nothing is waiting. */
  readonly flush: () => Promise<boolean>;
  /** After a conflict, saves the person's edits on top of `versionId`: "Keep mine". */
  readonly keepMine: (versionId: ArtifactVersionId) => void;
  /** Drops waiting edits and takes `versionId` as the base: "Load the latest". */
  readonly reset: (versionId: ArtifactVersionId) => void;
  /** Whether a version is one this editor saved, so seeing it isn't news. */
  readonly saved: (versionId: ArtifactVersionId) => boolean;
  readonly state: DocumentSaveState;
}

export function useDocumentSave({
  baseVersionId,
  delay = SAVE_DELAY_MS,
  save,
}: {
  /** The latest version when the editor opened it. */
  readonly baseVersionId: ArtifactVersionId;
  readonly delay?: number;
  readonly save: SaveDocumentVersion;
}): DocumentSave {
  const [state, setState] = useState<DocumentSaveState>("saved");
  // What changes between renders without being shown: one mutable record,
  // read by the timers and the save in flight.
  const live = useRef<Live>({
    base: baseVersionId,
    conflicted: false,
    inFlight: null,
    mine: new Set(),
    pending: null,
    timer: null,
  });
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  const clearTimer = useCallback(() => {
    const waiting = live.current.timer;
    live.current.timer = null;
    if (waiting !== null) {
      clearTimeout(waiting);
    }
  }, []);

  const run = useCallback(async (): Promise<boolean> => {
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Biome types the record by its initial values; saves and timers change it.
    if (live.current.inFlight) {
      await live.current.inFlight;
    }
    const content = live.current.pending;
    if (content === null) {
      return true;
    }
    // biome-ignore lint/suspicious/noUnnecessaryConditions: Biome types the record by its initial values; saves and timers change it.
    if (live.current.conflicted) {
      return false;
    }
    setState("saving");
    const attempt = (async () => {
      try {
        const version = await saveRef.current({
          baseVersionId: live.current.base,
          content,
        });
        live.current.mine.add(version.id);
        live.current.base = version.id;
        if (live.current.pending === content) {
          live.current.pending = null;
          setState("saved");
          return true;
        }
        // More edits came while it saved: they wait for their own pause.
        setState("unsaved");
        return false;
      } catch (error) {
        if (isConflict(error)) {
          live.current.conflicted = true;
          setState("conflict");
        } else {
          setState("error");
        }
        return false;
      }
    })();
    live.current.inFlight = attempt;
    const done = await attempt;
    live.current.inFlight = null;
    if (!done && live.current.pending !== null && !live.current.conflicted) {
      // Edits made while saving: save them after the pause too.
      clearTimer();
      live.current.timer = setTimeout(() => {
        run().catch(() => undefined);
      }, delay);
    }
    return done;
  }, [clearTimer, delay]);

  const change = useCallback(
    (content: string) => {
      live.current.pending = content;
      // biome-ignore lint/suspicious/noUnnecessaryConditions: Biome types the record by its initial values; saves and timers change it.
      if (live.current.conflicted) {
        return;
      }
      setState("unsaved");
      clearTimer();
      live.current.timer = setTimeout(() => {
        run().catch(() => undefined);
      }, delay);
    },
    [clearTimer, delay, run]
  );

  const flush = useCallback(async () => {
    clearTimer();
    if (live.current.pending === null && !live.current.inFlight) {
      return !live.current.conflicted;
    }
    const done = await run();
    return done && live.current.pending === null;
  }, [clearTimer, run]);

  const reset = useCallback(
    (versionId: ArtifactVersionId) => {
      clearTimer();
      live.current.pending = null;
      live.current.conflicted = false;
      live.current.base = versionId;
      setState("saved");
    },
    [clearTimer]
  );

  const keepMine = useCallback(
    (versionId: ArtifactVersionId) => {
      live.current.conflicted = false;
      live.current.base = versionId;
      run().catch(() => undefined);
    },
    [run]
  );

  // A newer version arrived (the model, or another editor) while nothing
  // waits: edits from here go on top of it.
  useEffect(() => {
    if (
      baseVersionId !== live.current.base &&
      live.current.pending === null &&
      !live.current.inFlight &&
      !live.current.mine.has(baseVersionId)
    ) {
      live.current.base = baseVersionId;
    }
  }, [baseVersionId]);

  // Leaving (closing the panel, a layout that remounts the page) saves
  // what's waiting rather than dropping it.
  useEffect(
    () => () => {
      clearTimer();
      if (live.current.pending !== null && !live.current.conflicted) {
        run().catch(() => undefined);
      }
    },
    [clearTimer, run]
  );

  const saved = useCallback(
    (versionId: ArtifactVersionId) => live.current.mine.has(versionId),
    []
  );

  return {
    baseVersionId: live.current.base,
    change,
    flush,
    keepMine,
    reset,
    saved,
    state,
  };
}
