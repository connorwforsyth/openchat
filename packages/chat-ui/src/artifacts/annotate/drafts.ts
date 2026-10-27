import {
  type AnnotationMark,
  type AnnotationNote,
  type AnnotationTarget,
  annotationMarkSchema,
  annotationTargetSchema,
  MAX_ANNOTATIONS,
  MAX_NOTE_LENGTH,
} from "@workspace/ai/messages/annotations";
import {
  type ArtifactId,
  type ArtifactVersionId,
  artifactVersionIdSchema,
} from "@workspace/contract/schemas/common";
import { useCallback, useSyncExternalStore } from "react";
import { z } from "zod";

// The notes someone is drafting on an artifact, before they send them.
// They're kept in this browser's storage, per artifact, so a reload keeps
// them and a second tab shows the same ones (the `storage` event). Each
// note keeps the version it was made on: the agent may write a new version
// while someone drafts, and the note still means the one they saw.

export const draftNoteSchema = z.object({
  id: z.string().min(1).max(64),
  mark: annotationMarkSchema,
  /** Empty while the person is still writing it. */
  note: z.string().max(MAX_NOTE_LENGTH),
  /** `undefined` while the view is still being asked what's there. */
  target: annotationTargetSchema.nullable().optional(),
  version: z.int().min(1),
  versionId: artifactVersionIdSchema,
});
export type DraftNote = z.infer<typeof draftNoteSchema>;

const draftsSchema = z.array(draftNoteSchema).max(MAX_ANNOTATIONS);

export type DraftAction =
  | {
      readonly id: string;
      readonly mark: AnnotationMark;
      readonly type: "add";
      readonly version: number;
      readonly versionId: ArtifactVersionId;
    }
  | { readonly id: string; readonly note: string; readonly type: "write" }
  | {
      readonly id: string;
      readonly target: AnnotationTarget | null;
      readonly type: "locate";
    }
  | { readonly id: string; readonly type: "remove" }
  | { readonly type: "clear" };

/** The drafts after `action`. Pure. */
export const draftsReducer = (
  drafts: readonly DraftNote[],
  action: DraftAction
): readonly DraftNote[] => {
  switch (action.type) {
    case "add":
      return drafts.length >= MAX_ANNOTATIONS
        ? drafts
        : [
            ...drafts,
            {
              id: action.id,
              mark: action.mark,
              note: "",
              version: action.version,
              versionId: action.versionId,
            },
          ];
    case "write":
      return drafts.map((draft) =>
        draft.id === action.id
          ? { ...draft, note: action.note.slice(0, MAX_NOTE_LENGTH) }
          : draft
      );
    case "locate":
      return drafts.map((draft) =>
        draft.id === action.id ? { ...draft, target: action.target } : draft
      );
    case "remove":
      return drafts.filter((draft) => draft.id !== action.id);
    case "clear":
      return [];
    default:
      return action satisfies never;
  }
};

/** The drafts ready to send: written, with whatever is known of where. Pure. */
export const sendable = (
  drafts: readonly DraftNote[]
): readonly AnnotationNote[] =>
  drafts.flatMap((draft) => {
    const note = draft.note.trim();
    return note
      ? [
          {
            mark: draft.mark,
            note,
            target: draft.target ?? null,
            version: draft.version,
            versionId: draft.versionId,
          },
        ]
      : [];
  });

const KEY_PREFIX = "annotate-drafts:v1:";
const EMPTY: readonly DraftNote[] = [];

/** The drafts stored as `raw`, or none when it isn't a list of drafts. Pure. */
export const parseDrafts = (raw: string | null): readonly DraftNote[] => {
  if (!raw) {
    return EMPTY;
  }
  try {
    const parsed = draftsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY;
  } catch {
    return EMPTY;
  }
};

const storage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage the browser refuses (a sandbox, a privacy mode): drafts
    // then last as long as the page.
    return null;
  }
};

// One snapshot per stored string, so `useSyncExternalStore` sees the same
// list until the drafts change.
const snapshots = new Map<
  string,
  { raw: string | null; value: readonly DraftNote[] }
>();
const memory = new Map<string, string>();
const listeners = new Set<() => void>();

const read = (key: string): readonly DraftNote[] => {
  const raw = storage()?.getItem(key) ?? memory.get(key) ?? null;
  const last = snapshots.get(key);
  if (last && last.raw === raw) {
    return last.value;
  }
  const value = parseDrafts(raw);
  snapshots.set(key, { raw, value });
  return value;
};

const write = (key: string, drafts: readonly DraftNote[]) => {
  const store = storage();
  if (drafts.length === 0) {
    store?.removeItem(key);
    memory.delete(key);
  } else {
    const raw = JSON.stringify(drafts);
    if (store) {
      store.setItem(key, raw);
    } else {
      memory.set(key, raw);
    }
  }
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  // Another tab's change.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
};

/** The drafts on `artifactId`, and how to change them. */
export const useDrafts = (artifactId: ArtifactId) => {
  const key = `${KEY_PREFIX}${artifactId}`;
  const drafts = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => EMPTY
  );
  const dispatch = useCallback(
    (action: DraftAction) => write(key, draftsReducer(read(key), action)),
    [key]
  );
  return [drafts, dispatch] as const;
};
