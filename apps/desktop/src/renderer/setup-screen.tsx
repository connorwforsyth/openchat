import { useLingui } from "@lingui/react/macro";
import { Button } from "@workspace/ui/components/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Spinner } from "@workspace/ui/components/spinner";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useState,
} from "react";

import type { SetupBridge } from "../preload/setup";
import type { ConnectError } from "../shared/ipc";

type Status =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly error: ConnectError; readonly kind: "failed" };

export function SetupScreen({ bridge }: { readonly bridge: SetupBridge }) {
  const { t } = useLingui();
  const inputId = useId();
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // Switching servers: start from the current one.
  useEffect(() => {
    bridge
      .current()
      .then(({ origin }) => {
        if (origin) {
          setUrl((typed) => (typed === "" ? origin : typed));
        }
      })
      .catch(() => undefined);
  }, [bridge]);

  const describe = (error: ConnectError): string => {
    switch (error) {
      case "empty":
        return t`Enter your server's address.`;
      case "invalid":
      case "unsupported-protocol":
        return t`That doesn't look like a web address.`;
      case "insecure":
        return t`Use an https:// address. Plain http:// only works for this computer.`;
      case "unreachable":
        return t`Couldn't reach that server. Check the address and your connection.`;
      case "not-an-instance":
        return t`That address answered, but it isn't a chat server.`;
      default:
        return error satisfies never;
    }
  };

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setStatus({ kind: "checking" });
      const result = await bridge
        .connect(url)
        .catch(() => ({ error: "unreachable", ok: false }) as const);
      // On success main swaps this window for the server's.
      setStatus(
        result.ok
          ? { kind: "checking" }
          : { error: result.error, kind: "failed" }
      );
    },
    [bridge, url]
  );
  const change = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setUrl(event.target.value);
  }, []);

  const checking = status.kind === "checking";
  return (
    <main className="flex min-h-svh flex-col justify-center gap-6 bg-background p-8 text-foreground">
      <div className="flex flex-col gap-1.5">
        <h1 className="font-heading font-semibold text-xl">{t`Connect to your server`}</h1>
        <p className="text-muted-foreground text-sm">
          {t`The app signs in to the same server you use in the browser.`}
        </p>
      </div>
      <form className="flex flex-col gap-4" noValidate onSubmit={submit}>
        <Field data-invalid={status.kind === "failed" || undefined}>
          <FieldLabel htmlFor={inputId}>{t`Server address`}</FieldLabel>
          <Input
            aria-invalid={status.kind === "failed" || undefined}
            autoCapitalize="none"
            autoComplete="url"
            autoCorrect="off"
            autoFocus
            disabled={checking}
            id={inputId}
            inputMode="url"
            onChange={change}
            placeholder={t`https://chat.example.com`}
            spellCheck={false}
            value={url}
          />
          {status.kind === "failed" ? (
            <FieldError>{describe(status.error)}</FieldError>
          ) : (
            <FieldDescription>
              {t`You can change it later from the app menu.`}
            </FieldDescription>
          )}
        </Field>
        <Button disabled={checking} type="submit">
          {checking ? <Spinner /> : null}
          {t`Connect`}
        </Button>
      </form>
    </main>
  );
}
