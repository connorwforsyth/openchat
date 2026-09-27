"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import type { LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  LibraryDefinitionInput,
  McpServerDefinition,
} from "@workspace/contract/schemas/library";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  LockIcon,
} from "@workspace/icons";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Skeleton } from "@workspace/ui/components/skeleton";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { useCallback } from "react";

import type { FormIssues } from "../form";
import { useDisconnectOAuth, useMcpStatus, useStartOAuth } from "../hooks";
import { issueAt, TextField } from "./fields";

// The MCP library's builder (D13): a saved server config. HTTP and SSE run
// on the server; stdio arrives with the desktop app. A header secret is
// write-only (D24): once saved it's shown as set, never read back, and
// typing a new one replaces it. OAuth is per user: each person connects
// their own account from here.

export type McpServerInput = Extract<
  LibraryDefinitionInput,
  { kind: "mcp_server" }
>;

export interface McpFormProps {
  readonly issues: FormIssues;
  readonly onChange: (next: McpServerInput) => void;
  readonly readOnly?: boolean;
  /** What's stored, to show whether a secret is set. */
  readonly saved: McpServerDefinition | null;
  readonly value: McpServerInput;
}

const WHITESPACE = /\s+/;

export function McpForm({
  issues,
  onChange,
  readOnly = false,
  saved,
  value,
}: McpFormProps) {
  const { t } = useLingui();
  const { auth } = value;
  const secretSet =
    saved?.auth.type === "header" &&
    saved.auth.configured &&
    auth.type === "header" &&
    saved.auth.headerName === auth.headerName &&
    saved.url === value.url;

  const setUrl = useCallback(
    (url: string) => onChange({ ...value, url }),
    [onChange, value]
  );
  const setTransport = useCallback(
    (values: string[]) => {
      const [next] = values;
      if (next === "http" || next === "sse") {
        onChange({ ...value, transport: next });
      }
    },
    [onChange, value]
  );
  const setAuthType = useCallback(
    (values: string[]) => {
      const [next] = values;
      if (next === "none") {
        onChange({ ...value, auth: { type: "none" } });
      } else if (next === "oauth") {
        onChange({ ...value, auth: { scopes: [], type: "oauth" } });
      } else if (next === "header") {
        onChange({
          ...value,
          auth: {
            headerName:
              saved?.auth.type === "header"
                ? saved.auth.headerName
                : "Authorization",
            type: "header",
          },
        });
      }
    },
    [onChange, saved, value]
  );
  const setHeaderName = useCallback(
    (headerName: string) =>
      onChange({ ...value, auth: { headerName, type: "header" } }),
    [onChange, value]
  );
  const setSecret = useCallback(
    (secret: string) => {
      if (value.auth.type !== "header") {
        return;
      }
      onChange({
        ...value,
        auth: {
          headerName: value.auth.headerName,
          type: "header",
          ...(secret === "" ? {} : { value: secret }),
        },
      });
    },
    [onChange, value]
  );
  const setScopes = useCallback(
    (scopes: string) =>
      onChange({
        ...value,
        auth: {
          scopes: scopes.split(WHITESPACE).filter((scope) => scope !== ""),
          type: "oauth",
        },
      }),
    [onChange, value]
  );

  return (
    <FieldGroup>
      <TextField
        description={t`The server's streamable HTTP or SSE endpoint.`}
        inputMode="url"
        issue={issueAt(issues, "definition.url")}
        label={t`URL`}
        name="url"
        onValueChange={setUrl}
        placeholder="https://"
        readOnly={readOnly}
        type="url"
        value={value.url}
      />
      <Field>
        <FieldLabel>
          <Trans>Transport</Trans>
        </FieldLabel>
        <ToggleGroup
          aria-label={t`Transport`}
          disabled={readOnly}
          onValueChange={setTransport}
          size="sm"
          value={[value.transport]}
          variant="outline"
        >
          <ToggleGroupItem value="http">
            <Trans>Streamable HTTP</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="sse">
            <Trans>SSE</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      <Field>
        <FieldLabel>
          <Trans>Authentication</Trans>
        </FieldLabel>
        <ToggleGroup
          aria-label={t`Authentication`}
          disabled={readOnly}
          onValueChange={setAuthType}
          size="sm"
          value={[auth.type]}
          variant="outline"
        >
          <ToggleGroupItem value="none">
            <Trans>None</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="header">
            <Trans>Header</Trans>
          </ToggleGroupItem>
          <ToggleGroupItem value="oauth">
            <Trans>OAuth</Trans>
          </ToggleGroupItem>
        </ToggleGroup>
      </Field>
      {auth.type === "header" ? (
        <>
          <TextField
            issue={issueAt(issues, "definition.auth.headerName")}
            label={t`Header name`}
            name="headerName"
            onValueChange={setHeaderName}
            readOnly={readOnly}
            value={auth.headerName}
          />
          <TextField
            autoComplete="off"
            description={
              secretSet ? (
                <span className="inline-flex items-center gap-1">
                  <LockIcon className="size-3" />
                  <Trans>
                    A secret is saved. It's never shown; type a new one to
                    replace it.
                  </Trans>
                </span>
              ) : (
                <Trans>
                  Stored encrypted and never shown again. Changing the URL or
                  header name needs it typed again.
                </Trans>
              )
            }
            issue={issueAt(issues, "definition.auth.value")}
            label={t`Secret`}
            name="secret"
            onValueChange={setSecret}
            placeholder={secretSet ? t`Saved` : ""}
            readOnly={readOnly}
            type="password"
            value={auth.value ?? ""}
          />
        </>
      ) : null}
      {auth.type === "oauth" ? (
        <TextField
          description={t`Space-separated. Leave empty for the server's defaults.`}
          label={t`Scopes`}
          name="scopes"
          onValueChange={setScopes}
          readOnly={readOnly}
          value={auth.scopes.join(" ")}
        />
      ) : null}
    </FieldGroup>
  );
}

/** Live connection state, with the caller's own OAuth connect and disconnect. */
export function McpStatusPanel({
  id,
  usesOAuth,
}: {
  /** `null` before the server is saved. */
  readonly id: LibraryItemId | null;
  readonly usesOAuth: boolean;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-medium text-sm">
        <Trans>Connection</Trans>
      </h2>
      {id === null ? (
        <FieldDescription>
          <Trans>Save the server to check its connection.</Trans>
        </FieldDescription>
      ) : (
        <StatusBody id={id} usesOAuth={usesOAuth} />
      )}
    </section>
  );
}

function StatusBody({
  id,
  usesOAuth,
}: {
  readonly id: LibraryItemId;
  readonly usesOAuth: boolean;
}) {
  const status = useMcpStatus(id);
  const start = useStartOAuth(id);
  const disconnect = useDisconnectOAuth(id);
  const { mutate: startOAuth } = start;
  const { mutate: disconnectOAuth } = disconnect;
  const connect = useCallback(
    () =>
      startOAuth(undefined, {
        onSuccess: ({ authorizationUrl }) =>
          window.open(authorizationUrl, "_blank", "noopener"),
      }),
    [startOAuth]
  );
  const signOut = useCallback(() => disconnectOAuth(), [disconnectOAuth]);

  if (status.isPending) {
    return <Skeleton className="h-8 w-48" />;
  }
  if (status.isError) {
    return (
      <Badge variant="destructive">
        <CircleAlertIcon data-icon="inline-start" />
        <Trans>Status unavailable</Trans>
      </Badge>
    );
  }
  const state = status.data;
  switch (state.state) {
    case "connected": {
      const count = state.toolCount;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            <CircleCheckIcon data-icon="inline-start" />
            <Trans>Connected · {count} tools</Trans>
          </Badge>
          {usesOAuth ? (
            <Button
              disabled={disconnect.isPending}
              onClick={signOut}
              size="sm"
              variant="ghost"
            >
              <Trans>Disconnect</Trans>
            </Button>
          ) : null}
        </div>
      );
    }
    case "needs_auth":
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">
            <Trans>Needs you to sign in</Trans>
          </Badge>
          <Button disabled={start.isPending} onClick={connect} size="sm">
            <ExternalLinkIcon data-icon="inline-start" />
            <Trans>Connect</Trans>
          </Button>
        </div>
      );
    case "error": {
      const { message } = state;
      return (
        <div className="flex flex-col gap-1">
          <Badge variant="destructive">
            <CircleAlertIcon data-icon="inline-start" />
            <Trans>Can't connect</Trans>
          </Badge>
          <p className="text-muted-foreground text-xs">{message}</p>
        </div>
      );
    }
    case "disabled":
      return (
        <Badge variant="outline">
          <Trans>Turned off on this instance</Trans>
        </Badge>
      );
    default:
      return state satisfies never;
  }
}
