"use client";

import { Plural, Trans } from "@lingui/react/macro";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";

import { useDuplicateNotice } from "../hooks";

/**
 * Shown on a fresh copy whose original had knowledge files the copier can
 * only search through the original: the server leaves those out, so the
 * copy doesn't outlive the grant that reached them.
 */
export function DuplicateNotice({ id }: { readonly id: LibraryItemId }) {
  const { dismiss, notice } = useDuplicateNotice(id);
  if (!notice) {
    return null;
  }
  const count = notice.omittedKnowledgeFiles;
  return (
    <Alert>
      <AlertTitle>
        <Plural
          one="# knowledge file wasn't copied"
          other="# knowledge files weren't copied"
          value={count}
        />
      </AlertTitle>
      <AlertDescription>
        <Trans>
          You could only search them through the original. Add your own files to
          give this copy knowledge.
        </Trans>
      </AlertDescription>
      <AlertAction>
        <Button onClick={dismiss} size="sm" variant="ghost">
          <Trans>Dismiss</Trans>
        </Button>
      </AlertAction>
    </Alert>
  );
}
