"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { FileTextIcon, TerminalIcon, XIcon } from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@workspace/ui/components/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { type ReactNode, useCallback, useState } from "react";

import { type RightPanel as Panel, rightPanelSchema } from "../model/layout";
import { ShortcutHint } from "../shortcuts/shortcut-hint";

// The right panel's two tabs (ticket 009, from the Workspace direction):
// the chat's sandbox and its artifacts. A tab's content mounts the first time
// it's shown and then stays mounted, so the terminal keeps its scrollback
// when you glance at an artifact.

export interface RightPanelProps {
  readonly artifacts: ReactNode;
  readonly onPanelChange: (panel: Panel | null) => void;
  readonly panel: Panel;
  readonly sandbox: ReactNode;
}

export function RightPanel({
  artifacts,
  onPanelChange,
  panel,
  sandbox,
}: RightPanelProps) {
  const { t } = useLingui();
  const [visited, setVisited] = useState<ReadonlySet<Panel>>(
    () => new Set([panel])
  );
  if (!visited.has(panel)) {
    setVisited(new Set([...visited, panel]));
  }

  const onValueChange = useCallback(
    (value: unknown) => {
      const parsed = rightPanelSchema.safeParse(value);
      if (parsed.success) {
        onPanelChange(parsed.data);
      }
    },
    [onPanelChange]
  );
  const close = useCallback(() => onPanelChange(null), [onPanelChange]);

  return (
    <Tabs
      className="h-full min-h-0 gap-0"
      onValueChange={onValueChange}
      value={panel}
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b px-2">
        <TabsList aria-label={t`Side panel`} variant="line">
          <Tooltip>
            <TooltipTrigger render={<TabsTrigger value="sandbox" />}>
              <TerminalIcon aria-hidden data-icon="inline-start" />
              <Trans>Sandbox</Trans>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Trans>Sandbox panel</Trans>
              <ShortcutHint id="panel.sandbox" />
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<TabsTrigger value="artifacts" />}>
              <FileTextIcon aria-hidden data-icon="inline-start" />
              <Trans>Artifacts</Trans>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <Trans>Artifacts panel</Trans>
              <ShortcutHint id="panel.artifacts" />
            </TooltipContent>
          </Tooltip>
        </TabsList>
        <Button
          aria-label={t`Close panel`}
          className="ms-auto"
          onClick={close}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon aria-hidden />
        </Button>
      </div>
      <TabsContent
        className="min-h-0"
        keepMounted={visited.has("sandbox")}
        value="sandbox"
      >
        {visited.has("sandbox") ? sandbox : null}
      </TabsContent>
      <TabsContent
        className="min-h-0"
        keepMounted={visited.has("artifacts")}
        value="artifacts"
      >
        {visited.has("artifacts") ? artifacts : null}
      </TabsContent>
    </Tabs>
  );
}
