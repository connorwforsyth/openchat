"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrgId } from "@workspace/contract/schemas/common";
import type { TokenUsage } from "@workspace/contract/schemas/models";
import type { Team } from "@workspace/contract/schemas/tenancy";
import type { Budget } from "@workspace/contract/schemas/usage";
import { formatDate, formatNumber } from "@workspace/i18n/format";
import { Trash2Icon, WalletIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@workspace/ui/components/empty";
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@workspace/ui/components/field";
import { Input } from "@workspace/ui/components/input";
import { Switch } from "@workspace/ui/components/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@workspace/ui/components/table";
import { type FormEvent, useCallback, useMemo, useState } from "react";

import { useApi } from "@/app/(app)/_shared/api";
import { ConfirmButton } from "@/app/(app)/_shared/confirm";
import { useCurrency } from "@/app/(app)/_shared/currency";
import { type Option, OptionSelect } from "@/app/(app)/_shared/option-select";
import { QueryState } from "@/app/(app)/_shared/query-state";
import { Cost, PricesNote } from "./cost";

import { amountToMicros, formatMicros } from "./money";
import { buildTeamTree, flattenTree } from "./team-tree";

// Budgets and a usage summary (D17, D24). Spend is integer micro-USD; team
// totals include sub-teams and the org's include everything. Budgets are
// checked before a run starts: hard ones block, soft ones warn.

type Period = Budget["period"];

/** This calendar month so far, in UTC, which is how budgets reset. */
export const monthToDate = (now: Date) => ({
  from: new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString(),
  to: now.toISOString(),
});

const usePeriodLabels = (): Readonly<Record<Period, string>> => {
  const { t } = useLingui();
  return { day: t`Daily`, month: t`Monthly`, week: t`Weekly` };
};

const tokensOf = (row: { readonly usage: TokenUsage }) =>
  row.usage.inputTokens + row.usage.outputTokens;

const Summary = ({ orgId }: { readonly orgId: OrgId }) => {
  const { i18n } = useLingui();
  const { query } = useApi();
  // Fixed for the page's life so the query key doesn't change every render.
  const [range] = useState(() => monthToDate(new Date()));
  const summary = useQuery(
    query.usage.summary.queryOptions({
      input: {
        ...range,
        groupBy: "model",
        principalId: orgId,
        principalType: "org",
      },
    })
  );
  return (
    <QueryState query={summary}>
      {(data) => {
        const tokens = data.rows.reduce((sum, row) => sum + tokensOf(row), 0);
        return (
          <div className="flex flex-col gap-4">
            <p className="font-medium text-2xl tabular-nums">
              <Cost micros={data.totalCostMicros} tokens={tokens} />
            </p>
            {data.rows.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                <Trans>No usage this month yet.</Trans>
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Trans>Model</Trans>
                    </TableHead>
                    <TableHead className="text-end">
                      <Trans>Tokens</Trans>
                    </TableHead>
                    <TableHead className="text-end">
                      <Trans>Cost</Trans>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {[...data.rows]
                    .sort((a, b) => b.costMicros - a.costMicros)
                    .map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-mono text-xs">
                          {row.key}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          {formatNumber(
                            row.usage.inputTokens + row.usage.outputTokens,
                            i18n.locale
                          )}
                        </TableCell>
                        <TableCell className="text-end tabular-nums">
                          <Cost
                            micros={row.costMicros}
                            tokens={tokensOf(row)}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            )}
            <PricesNote />
          </div>
        );
      }}
    </QueryState>
  );
};

const BudgetRow = ({
  budget,
  name,
  onDelete,
}: {
  readonly budget: Budget;
  readonly name: string;
  readonly onDelete: (budget: Budget) => void;
}) => {
  const { i18n, t } = useLingui();
  const periods = usePeriodLabels();
  const currency = useCurrency();
  const remove = useCallback(() => onDelete(budget), [budget, onDelete]);
  const used = formatMicros(budget.usedMicros, i18n.locale, currency);
  const limit = formatMicros(budget.limitMicros, i18n.locale, currency);
  const resets = formatDate(budget.resetsAt, i18n.locale);
  return (
    <TableRow>
      <TableCell className="font-medium">{name}</TableCell>
      <TableCell>{periods[budget.period]}</TableCell>
      <TableCell className="tabular-nums">
        <Trans>
          {used} of {limit}
        </Trans>
      </TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {budget.hard ? <Trans>Blocks new chats</Trans> : <Trans>Warns</Trans>}
        {" · "}
        <Trans>Resets {resets}</Trans>
      </TableCell>
      <TableCell className="text-end">
        <ConfirmButton
          confirmLabel={<Trans>Delete budget</Trans>}
          description={<Trans>Spending here won't be limited any more.</Trans>}
          label={t`Delete the budget for ${name}`}
          onConfirm={remove}
          title={<Trans>Delete this budget?</Trans>}
        >
          <Trash2Icon />
        </ConfirmButton>
      </TableCell>
    </TableRow>
  );
};

const SetBudgetForm = ({
  onSaved,
  orgId,
  teams,
}: {
  readonly onSaved: () => void;
  readonly orgId: OrgId;
  readonly teams: readonly Team[];
}) => {
  const { t } = useLingui();
  const { query } = useApi();
  const currency = useCurrency();
  const periods = usePeriodLabels();
  const [target, setTarget] = useState<string>(orgId);
  const [period, setPeriod] = useState<Period>("month");
  const [hard, setHard] = useState(true);
  const [problem, setProblem] = useState<"amount" | "failed" | null>(null);
  const save = useMutation(query.usage.setBudget.mutationOptions());
  const { mutate } = save;
  const targets: readonly Option<string>[] = [
    { label: t`The whole org`, value: orgId },
    ...flattenTree(buildTeamTree(teams)).map((node) => ({
      label: `${"— ".repeat(node.depth)}${node.team.name}`,
      value: node.team.id,
    })),
  ];
  const periodOptions: readonly Option<Period>[] = (
    ["day", "week", "month"] as const
  ).map((value) => ({ label: periods[value], value }));

  const submit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const micros = amountToMicros(
        String(new FormData(form).get("amount") ?? ""),
        currency
      );
      if (micros === null || micros === 0) {
        setProblem("amount");
        return;
      }
      setProblem(null);
      const team = teams.find((each) => each.id === target);
      mutate(
        {
          hard,
          limitMicros: micros,
          orgId,
          period,
          principal: team
            ? { id: team.id, type: "team" }
            : { id: orgId, type: "org" },
        },
        {
          onError: () => setProblem("failed"),
          onSuccess: () => {
            form.reset();
            onSaved();
          },
        }
      );
    },
    [currency, hard, mutate, onSaved, orgId, period, target, teams]
  );

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <FieldLabel htmlFor="budget-target">
              <Trans>For</Trans>
            </FieldLabel>
            <OptionSelect
              id="budget-target"
              onChange={setTarget}
              options={targets}
              value={target}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="budget-period">
              <Trans>Period</Trans>
            </FieldLabel>
            <OptionSelect
              id="budget-period"
              onChange={setPeriod}
              options={periodOptions}
              value={period}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="budget-amount">
              <Trans>Limit ({currency.code})</Trans>
            </FieldLabel>
            <Input
              id="budget-amount"
              inputMode="decimal"
              name="amount"
              placeholder="100"
              required
            />
          </Field>
        </div>
        <Field orientation="horizontal">
          <Switch checked={hard} id="budget-hard" onCheckedChange={setHard} />
          <FieldContent>
            <FieldLabel htmlFor="budget-hard">
              <Trans>Block new chats when it's spent</Trans>
            </FieldLabel>
          </FieldContent>
        </Field>
        {problem ? (
          <FieldError>
            {problem === "amount" ? (
              <Trans>Enter an amount in dollars, like 25 or 12.50.</Trans>
            ) : (
              <Trans>The budget couldn't be saved. Try again.</Trans>
            )}
          </FieldError>
        ) : null}
        <div>
          <Button disabled={save.isPending} type="submit">
            <Trans>Set budget</Trans>
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};

export const UsageAdmin = ({ orgId }: { readonly orgId: OrgId }) => {
  const { t } = useLingui();
  const { query } = useApi();
  const queryClient = useQueryClient();
  const budgets = useQuery(
    query.usage.budgets.queryOptions({ input: { orgId } })
  );
  const teams = useQuery(query.teams.list.queryOptions({ input: { orgId } }));
  const refresh = useCallback(
    () => queryClient.invalidateQueries({ queryKey: query.usage.key() }),
    [query, queryClient]
  );
  const remove = useMutation(
    query.usage.deleteBudget.mutationOptions({ onSettled: refresh })
  );
  const { mutate } = remove;
  const onDelete = useCallback(
    (budget: Budget) => mutate({ id: budget.id }),
    [mutate]
  );
  const teamNames = useMemo(
    () => new Map((teams.data ?? []).map((team) => [team.id, team.name])),
    [teams.data]
  );
  const nameOf = (budget: Budget): string => {
    switch (budget.principal.type) {
      case "org":
        return t`The whole org`;
      case "team":
        return teamNames.get(budget.principal.id) ?? t`A team`;
      case "user":
        return t`A member`;
      default:
        return budget.principal satisfies never;
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Spend this month</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>Everything in the org, including its teams.</Trans>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Summary orgId={orgId} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Budgets</Trans>
          </CardTitle>
          <CardDescription>
            <Trans>
              A team's spend counts toward its parents' budgets and the org's.
            </Trans>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <QueryState query={budgets}>
            {(list) =>
              list.length === 0 ? (
                <Empty className="border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon">
                      <WalletIcon />
                    </EmptyMedia>
                    <EmptyTitle>
                      <Trans>No budgets</Trans>
                    </EmptyTitle>
                    <EmptyDescription>
                      <Trans>
                        Spending isn't limited anywhere in this org.
                      </Trans>
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>
                        <Trans>For</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>Period</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>Spent</Trans>
                      </TableHead>
                      <TableHead>
                        <Trans>When spent</Trans>
                      </TableHead>
                      <TableHead className="text-end">
                        <span className="sr-only">
                          <Trans>Actions</Trans>
                        </span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {list.map((budget) => (
                      <BudgetRow
                        budget={budget}
                        key={budget.id}
                        name={nameOf(budget)}
                        onDelete={onDelete}
                      />
                    ))}
                  </TableBody>
                </Table>
              )
            }
          </QueryState>
          <SetBudgetForm
            onSaved={refresh}
            orgId={orgId}
            teams={teams.data ?? []}
          />
        </CardContent>
      </Card>
    </div>
  );
};
