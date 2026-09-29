"use client";

import type {
  LineAnnotation,
  SelectedLineRange,
  SupportedLanguages,
} from "@pierre/diffs";
import { File } from "@pierre/diffs/react";
import { cn } from "@workspace/ui/lib/utils";
import { type ReactNode, useMemo } from "react";

import { CodeHeader } from "./code-header";
import { codeThemeNames } from "./theme/code-theme";
import { diffsHostStyle } from "./theme/host-styles";
import { registerCodeThemes } from "./theme/register";
import { useCodeThemeType } from "./theme/use-code-theme-type";

registerCodeThemes();

export type { LineAnnotation, SelectedLineRange } from "@pierre/diffs";

export interface CodeViewProps<Meta = undefined> {
  /** Line annotations (comments, pins) rendered under their lines. */
  readonly annotations?: LineAnnotation<Meta>[];
  readonly className?: string;
  readonly contents: string;
  readonly header?: boolean;
  /** Header actions; pass `header={false}` to drop the header entirely. */
  readonly headerActions?: ReactNode;
  /** Overrides the language inferred from `path`. */
  readonly language?: SupportedLanguages;
  /** Called when the user finishes selecting lines (enables selection). */
  readonly onSelectLines?: (range: SelectedLineRange | null) => void;
  readonly path: string;
  readonly renderAnnotation?: (annotation: LineAnnotation<Meta>) => ReactNode;
  readonly selectedLines?: SelectedLineRange | null;
  /** Wrap long lines instead of scrolling. */
  readonly wrap?: boolean;
}

/** A read-only file with Shiki highlighting and line annotations. */
export function CodeView<Meta = undefined>({
  annotations,
  className,
  contents,
  header = true,
  headerActions,
  language,
  onSelectLines,
  path,
  renderAnnotation,
  selectedLines,
  wrap = false,
}: CodeViewProps<Meta>) {
  const { themeType } = useCodeThemeType();
  const file = useMemo(
    () => ({ contents, lang: language, name: path }),
    [contents, language, path]
  );
  const options = useMemo(
    () => ({
      disableFileHeader: true,
      enableLineSelection: onSelectLines !== undefined,
      onLineSelectionEnd: onSelectLines,
      overflow: wrap ? ("wrap" as const) : ("scroll" as const),
      theme: codeThemeNames,
      themeType,
    }),
    [onSelectLines, themeType, wrap]
  );

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border bg-background",
        className
      )}
    >
      {header ? <CodeHeader actions={headerActions} path={path} /> : null}
      <File
        file={file}
        lineAnnotations={annotations}
        options={options}
        renderAnnotation={renderAnnotation}
        selectedLines={selectedLines}
        style={diffsHostStyle(themeType)}
      />
    </div>
  );
}
