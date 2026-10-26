"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import type { ProviderKeyId } from "@workspace/contract/schemas/common";
import type { Space } from "@workspace/contract/schemas/spaces";
import type { UsageSummary } from "@workspace/contract/schemas/usage";
import { formatDate, formatNumber } from "@workspace/i18n/format";
import { ExternalLinkIcon } from "@workspace/icons";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import {
  type ComponentType,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useApi } from "@/app/(app)/_shared/api";
import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { Cost, PricesNote } from "@/app/(app)/(pages)/admin/_components/cost";

// Tokens and cost from our own usage table (D17): yours everywhere, yours in
// one space, or everyone's in a space you manage. By day, by model, by chat
// (yours only: chat titles are private) or by person, and by key.

type Row = UsageSummary["rows"][number];
type GroupBy = "day" | "model" | "conversation" | "user" | "key";

/** Whose usage the section shows. */
export type UsageScope =
  | { readonly kind: "mine" }
  | { readonly kind: "mine-in"; readonly space: Space }
  | { readonly kind: "everyone-in"; readonly space: Space };

const scopeValue = (scope: UsageScope): string =>
  scope.kind === "mine" ? "mine" : `${scope.kind}:${scope.space.id}`;

/** Yours everywhere, then for each shared space yours in it, and everyone's where you manage it. */
export const usageScopes = (spaces: readonly Space[]): UsageScope[] => [
  { kind: "mine" },
  ...spaces
    .filter((space) => !space.isPersonal)
    .flatMap((space): UsageScope[] =>
      space.canManage
        ? [
            { kind: "mine-in", space },
            { kind: "everyone-in", space },
          ]
        : [{ kind: "mine-in", space }]
    ),
];

/** The summary query's principal and space for a scope. */
export const scopeInput = (scope: UsageScope, userId: string) => {
  switch (scope.kind) {
    case "mine":
      return { principalId: userId, principalType: "user" } as const;
    case "mine-in":
      return {
        principalId: userId,
        principalType: "user",
        spaceId: scope.space.id,
        spaceType: scope.space.type,
      } as const;
    case "everyone-in":
      return {
        principalId: scope.space.id,
        principalType: scope.space.type,
      } as const;
    default:
      return scope satisfies never;
  }
};

const RANGES = ["7", "30", "90"] as const;
type RangeDays = (typeof RANGES)[number];

/** The last `days` days up to now, starting at midnight UTC (usage days are UTC). */
export const lastDays = (days: number, now: Date) => {
  const today = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  return {
    from: new Date(today - (days - 1) * 24 * 60 * 60 * 1000).toISOString(),
    to: now.toISOString(),
  };
};

const tokensOf = (row: Row) => row.usage.inputTokens + row.usage.outputTokens;

const ALL_KEYS = "all";

export const UsageSettings = () => {
  const { t } = useLingui();
  const { query } = useApi();
  const me = useQuery(query.me.get.queryOptions());
  const spaces = useQuery(query.spaces.list.queryOptions());
  const scopes = useMemo(() => usageScopes(spaces.data ?? []), [spaces.data]);
  const [scopeKey, setScopeKey] = useState("mine");
  const [days, setDays] = useState<RangeDays>("30");
  const [keyId, setKeyId] = useState(ALL_KEYS);
  // Fixed per range so the query keys don't change every render.
  const range = useMemo(() => lastDays(Number(days), new Date()), [days]);
  const scope =
    scopes.find((each) => scopeValue(each) === scopeKey) ?? scopes[0];

  const scopeOptions: Option<string>[] = scopes.map((each) => {
    switch (each.kind) {
      case "mine":
        return { label: t`All your usage`, value: "mine" };
      case "mine-in":
        return {
          label: t`Yours in ${each.space.name}`,
          value: scopeValue(each),
        };
      case "everyone-in":
        return {
          label: t`Everyone in ${each.space.name}`,
          value: scopeValue(each),
        };
      default:
        return each satisfies never;
    }
  });
  const rangeOptions: Option<RangeDays>[] = [
    { label: t`Last 7 days`, value: "7" },
    { label: t`Last 30 days`, value: "30" },
    { label: t`Last 90 days`, value: "90" },
  ];

  const pickScope = useCallback((value: string) => {
    setScopeKey(value);
    setKeyId(ALL_KEYS);
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        <OptionSelect
          label={t`Whose usage`}
          onChange={pickScope}
          options={scopeOptions}
          value={scope ? scopeValue(scope) : "mine"}
        />
        <OptionSelect
          label={t`Period`}
          onChange={setDays}
          options={rangeOptions}
          value={days}
        />
      </div>
      {me.data && scope ? (
        <UsageReport
          base={{ ...range, ...scopeInput(scope, me.data.user.id) }}
          byPerson={scope.kind === "everyone-in"}
          keyId={keyId}
          onKeyChange={setKeyId}
        />
      ) : (
        <QueryState query={me}>{() => null}</QueryState>
      )}
    </div>
  );
};

type SummaryInput = ReturnType<typeof scopeInput> & {
  readonly from: string;
  readonly to: string;
};

const useSummary = (input: SummaryInput, groupBy: GroupBy, keyId: string) => {
  const { query } = useApi();
  return useQuery(
    query.usage.summary.queryOptions({
      input: {
        ...input,
        groupBy,
        ...(keyId === ALL_KEYS ? {} : { keyId: keyId as ProviderKeyId }),
      },
    })
  );
};

const UsageReport = ({
  base,
  byPerson,
  keyId,
  onKeyChange,
}: {
  readonly base: SummaryInput;
  readonly byPerson: boolean;
  readonly keyId: string;
  readonly onKeyChange: (keyId: string) => void;
}) => {
  const { i18n, t } = useLingui();
  const byDay = useSummary(base, "day", keyId);
  const byModel = useSummary(base, "model", keyId);
  const byWho = useSummary(base, byPerson ? "user" : "conversation", keyId);
  const byKey = useSummary(base, "key", keyId);
  // Every key, whichever is picked, so the picker keeps its options.
  const keys = useSummary(base, "key", ALL_KEYS);

  const keyOptions: Option<string>[] = [
    { label: t`All keys`, value: ALL_KEYS },
    ...(keys.data?.rows ?? [])
      .filter((row) => row.key !== "")
      .map((row) => ({
        label: row.label ?? t`A key you don't manage`,
        value: row.key,
      })),
  ];

  return (
    <QueryState query={byDay}>
      {(days) => {
        if (days.rows.length === 0 && keyId === ALL_KEYS) {
          return (
            <p className="text-muted-foreground text-sm">
              <Trans>No usage in this period.</Trans>
            </p>
          );
        }
        const tokens = days.rows.reduce((sum, row) => sum + tokensOf(row), 0);
        return (
          <div className="flex flex-col gap-8">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <dl className="flex gap-8">
                <Stat label={<Trans>Tokens</Trans>}>
                  {formatNumber(tokens, i18n.locale)}
                </Stat>
                <Stat label={<Trans>Cost</Trans>}>
                  <Cost micros={days.totalCostMicros} tokens={tokens} />
                </Stat>
              </dl>
              {keyOptions.length > 1 ? (
                <OptionSelect
                  label={t`Key`}
                  onChange={onKeyChange}
                  options={keyOptions}
                  value={keyId}
                />
              ) : null}
            </div>
            <PricesNote />
            <DayTable rows={days.rows} />
            <QueryState query={byModel}>
              {(data) => <GroupTable groupBy="model" summary={data} />}
            </QueryState>
            <QueryState query={byWho}>
              {(data) => (
                <GroupTable
                  groupBy={byPerson ? "user" : "conversation"}
                  summary={data}
                />
              )}
            </QueryState>
            <QueryState query={byKey}>
              {(data) => <GroupTable groupBy="key" summary={data} />}
            </QueryState>
          </div>
        );
      }}
    </QueryState>
  );
};

const Stat = ({
  children,
  label,
}: {
  readonly children: ReactNode;
  readonly label: ReactNode;
}) => (
  <div className="flex flex-col gap-1">
    <dt className="text-muted-foreground text-xs">{label}</dt>
    <dd className="font-medium text-2xl tabular-nums">{children}</dd>
  </div>
);

const PersonName = ({ row }: { readonly row: Row }) => {
  const { t } = useLingui();
  const name = row.label ?? row.key;
  return (
    <span className="flex items-center gap-2">
      {name}
      {row.traceUrl ? (
        <a
          aria-label={t`Traces for ${name}`}
          className="text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-3.5"
          href={row.traceUrl}
          rel="noopener noreferrer"
          target="_blank"
          title={t`Traces for ${name}`}
        >
          <ExternalLinkIcon />
        </a>
      ) : null}
    </span>
  );
};

const AmountCells = ({ row }: { readonly row: Row }) => {
  const { i18n } = useLingui();
  return (
    <>
      <TableCell className="text-end tabular-nums">
        {formatNumber(tokensOf(row), i18n.locale)}
      </TableCell>
      <TableCell className="text-end tabular-nums">
        <Cost micros={row.costMicros} tokens={tokensOf(row)} />
      </TableCell>
    </>
  );
};

const AmountHeads = () => (
  <>
    <TableHead className="w-28 text-end">
      <Trans>Tokens</Trans>
    </TableHead>
    <TableHead className="w-28 text-end">
      <Trans>Cost</Trans>
    </TableHead>
  </>
);

const TotalRow = ({ rows }: { readonly rows: readonly Row[] }) => {
  const { i18n } = useLingui();
  const cost = rows.reduce((sum, row) => sum + row.costMicros, 0);
  const tokens = rows.reduce((sum, row) => sum + tokensOf(row), 0);
  return (
    <TableFooter>
      <TableRow>
        <TableCell>
          <Trans>Total</Trans>
        </TableCell>
        <TableCell className="text-end tabular-nums">
          {formatNumber(tokens, i18n.locale)}
        </TableCell>
        <TableCell className="text-end tabular-nums">
          <Cost micros={cost} tokens={tokens} />
        </TableCell>
      </TableRow>
    </TableFooter>
  );
};

/** Newest day first, each with a bar for its share of the busiest day's cost. */
const DayTable = ({ rows }: { readonly rows: readonly Row[] }) => {
  const { i18n } = useLingui();
  const newestFirst = [...rows].sort((a, b) => b.key.localeCompare(a.key));
  const most = Math.max(...rows.map((row) => row.costMicros), 1);
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">
        <Trans>By day</Trans>
      </h2>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>
              <Trans>Day</Trans>
            </TableHead>
            <AmountHeads />
          </TableRow>
        </TableHeader>
        <TableBody>
          {newestFirst.map((row) => (
            <TableRow key={row.key}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <span className="w-28 shrink-0">
                    {formatDate(`${row.key}T00:00:00Z`, i18n.locale, {
                      dateStyle: "medium",
                      timeZone: "UTC",
                    })}
                  </span>
                  <div
                    aria-hidden="true"
                    className="h-1.5 flex-1 rounded-full bg-muted"
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(row.costMicros / most) * 100}%` }}
                    />
                  </div>
                </div>
              </TableCell>
              <AmountCells row={row} />
            </TableRow>
          ))}
        </TableBody>
        <TotalRow rows={rows} />
      </Table>
    </section>
  );
};

const ModelName = ({ row }: { readonly row: Row }) => (
  <span className="font-mono text-xs">{row.key}</span>
);

const ChatName = ({ row }: { readonly row: Row }) => {
  if (row.key === "") {
    return (
      <span className="text-muted-foreground">
        <Trans>Outside chats</Trans>
      </span>
    );
  }
  // No label: the chat is one you can no longer read. `""`: it has no title yet.
  if (row.label === undefined) {
    return (
      <span className="text-muted-foreground">
        <Trans>A chat you no longer have access to</Trans>
      </span>
    );
  }
  return row.label || <Trans>Untitled chat</Trans>;
};

const KeyName = ({ row }: { readonly row: Row }) =>
  row.key === "" ? (
    <span className="text-muted-foreground">
      <Trans>Server keys</Trans>
    </span>
  ) : (
    (row.label ?? (
      <span className="text-muted-foreground">
        <Trans>A key you don't manage</Trans>
      </span>
    ))
  );

type Grouping = Exclude<GroupBy, "day">;

const GROUPINGS: Record<
  Grouping,
  {
    readonly heading: ReactNode;
    readonly Name: ComponentType<{ readonly row: Row }>;
  }
> = {
  conversation: { heading: <Trans>By chat</Trans>, Name: ChatName },
  key: { heading: <Trans>By key</Trans>, Name: KeyName },
  model: { heading: <Trans>By model</Trans>, Name: ModelName },
  user: { heading: <Trans>By person</Trans>, Name: PersonName },
};

const GroupTable = ({
  groupBy,
  summary,
}: {
  readonly groupBy: Grouping;
  readonly summary: UsageSummary;
}) => {
  const { heading, Name } = GROUPINGS[groupBy];
  return (
    <section className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">{heading}</h2>
      {summary.rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          <Trans>No usage in this period.</Trans>
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>
                <Trans>Name</Trans>
              </TableHead>
              <AmountHeads />
            </TableRow>
          </TableHeader>
          <TableBody>
            {summary.rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell className="max-w-0 truncate">
                  <Name row={row} />
                </TableCell>
                <AmountCells row={row} />
              </TableRow>
            ))}
          </TableBody>
          <TotalRow rows={summary.rows} />
        </Table>
      )}
    </section>
  );
};
