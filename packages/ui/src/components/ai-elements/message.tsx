"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PaperclipIcon,
  XIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  ButtonGroup,
  ButtonGroupText,
} from "@workspace/ui/components/button-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import type { FileUIPart, UIMessage } from "ai";
import type { ComponentProps, HTMLAttributes, ReactElement } from "react";
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { Streamdown } from "streamdown";

import { useStreamdownDefaults } from "./streamdown";

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
  from: UIMessage["role"];
};

// The chat's message layout follows shadcn's chatbot template (MIT,
// github.com/shadcn-ui/chatbot-template): the user's turn is a muted bubble
// at the end of the column, at most 80% of its width; the assistant's is
// plain prose across the column, with no avatars on either side.

export const Message = ({ className, from, ...props }: MessageProps) => (
  <div
    className={cn(
      "group flex w-full min-w-0 flex-col gap-2",
      from === "user" ? "is-user items-end" : "is-assistant",
      className
    )}
    {...props}
  />
);

export type MessageContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageContent = ({
  children,
  className,
  ...props
}: MessageContentProps) => (
  <div
    className={cn(
      "wrap-break-word flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-foreground",
      "group-[.is-user]:max-w-[80%] group-[.is-user]:rounded-3xl group-[.is-user]:bg-muted group-[.is-user]:px-4 group-[.is-user]:py-2.5 group-[.is-user]:text-[15px] group-[.is-user]:leading-relaxed",
      "group-[.is-assistant]:text-[15px] group-[.is-assistant]:leading-[1.75]",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type MessageActionsProps = ComponentProps<"div">;

export const MessageActions = ({
  className,
  children,
  ...props
}: MessageActionsProps) => (
  <div className={cn("flex items-center gap-1", className)} {...props}>
    {children}
  </div>
);

export type MessageActionProps = ComponentProps<typeof Button> & {
  tooltip?: string;
  label?: string;
};

export const MessageAction = ({
  tooltip,
  children,
  label,
  variant = "ghost",
  size = "icon-sm",
  ...props
}: MessageActionProps) => {
  const button = (
    <Button size={size} type="button" variant={variant} {...props}>
      {children}
      <span className="sr-only">{label || tooltip}</span>
    </Button>
  );

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger render={button} />
          <TooltipContent>
            <p>{tooltip}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return button;
};

interface MessageBranchContextType {
  branches: ReactElement[];
  currentBranch: number;
  goToNext: () => void;
  goToPrevious: () => void;
  setBranches: (branches: ReactElement[]) => void;
  totalBranches: number;
}

const MessageBranchContext = createContext<MessageBranchContextType | null>(
  null
);

const useMessageBranch = () => {
  const context = useContext(MessageBranchContext);

  if (!context) {
    // A programming error (a part rendered outside its root), not a runtime
    // condition, so it throws like React's own context misuse does.
    throw new Error(
      "MessageBranch components must be used within MessageBranch"
    );
  }

  return context;
};

export type MessageBranchProps = HTMLAttributes<HTMLDivElement> & {
  defaultBranch?: number;
  onBranchChange?: (branchIndex: number) => void;
};

export const MessageBranch = ({
  defaultBranch = 0,
  onBranchChange,
  className,
  ...props
}: MessageBranchProps) => {
  const [currentBranch, setCurrentBranch] = useState(defaultBranch);
  const [branches, setBranches] = useState<ReactElement[]>([]);

  const handleBranchChange = (newBranch: number) => {
    setCurrentBranch(newBranch);
    onBranchChange?.(newBranch);
  };

  const goToPrevious = () => {
    const newBranch =
      currentBranch > 0 ? currentBranch - 1 : branches.length - 1;
    handleBranchChange(newBranch);
  };

  const goToNext = () => {
    const newBranch =
      currentBranch < branches.length - 1 ? currentBranch + 1 : 0;
    handleBranchChange(newBranch);
  };

  const contextValue: MessageBranchContextType = {
    branches,
    currentBranch,
    goToNext,
    goToPrevious,
    setBranches,
    totalBranches: branches.length,
  };

  return (
    <MessageBranchContext.Provider value={contextValue}>
      <div
        className={cn("grid w-full gap-2 [&>div]:pb-0", className)}
        {...props}
      />
    </MessageBranchContext.Provider>
  );
};

export type MessageBranchContentProps = HTMLAttributes<HTMLDivElement>;

export const MessageBranchContent = ({
  children,
  ...props
}: MessageBranchContentProps) => {
  const { currentBranch, setBranches, branches } = useMessageBranch();
  const childrenArray = (
    Array.isArray(children) ? children : [children]
  ) as ReactElement[];

  // The branch count lives in context so the selector can render "n of m";
  // sync it whenever the set of branches changes.
  useEffect(() => {
    if (branches.length !== childrenArray.length) {
      setBranches(childrenArray);
    }
  }, [childrenArray, branches, setBranches]);

  return childrenArray.map((branch, index) => (
    <div
      className={cn(
        "grid gap-2 overflow-hidden [&>div]:pb-0",
        index === currentBranch ? "block" : "hidden"
      )}
      key={branch.key}
      {...props}
    >
      {branch}
    </div>
  ));
};

export type MessageBranchSelectorProps = ComponentProps<typeof ButtonGroup> & {
  from: UIMessage["role"];
};

export const MessageBranchSelector = ({
  className,
  from: _from,
  ...props
}: MessageBranchSelectorProps) => {
  const { totalBranches } = useMessageBranch();

  // Nothing to switch between with a single branch.
  if (totalBranches <= 1) {
    return null;
  }

  return (
    <ButtonGroup
      className={cn(
        "[&>*:not(:first-child)]:rounded-s-md [&>*:not(:last-child)]:rounded-e-md",
        className
      )}
      orientation="horizontal"
      {...props}
    />
  );
};

export type MessageBranchPreviousProps = ComponentProps<typeof Button>;

export const MessageBranchPrevious = ({
  children,
  ...props
}: MessageBranchPreviousProps) => {
  const { t } = useLingui();
  const { goToPrevious, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label={t`Previous branch`}
      disabled={totalBranches <= 1}
      onClick={goToPrevious}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronLeftIcon className="rtl:rotate-180" size={14} />}
    </Button>
  );
};

export type MessageBranchNextProps = ComponentProps<typeof Button>;

export const MessageBranchNext = ({
  children,
  ...props
}: MessageBranchNextProps) => {
  const { t } = useLingui();
  const { goToNext, totalBranches } = useMessageBranch();

  return (
    <Button
      aria-label={t`Next branch`}
      disabled={totalBranches <= 1}
      onClick={goToNext}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    >
      {children ?? <ChevronRightIcon className="rtl:rotate-180" size={14} />}
    </Button>
  );
};

export type MessageBranchPageProps = ComponentProps<typeof ButtonGroupText>;

export const MessageBranchPage = ({
  className,
  ...props
}: MessageBranchPageProps) => {
  const { currentBranch, totalBranches } = useMessageBranch();
  const page = currentBranch + 1;

  return (
    <ButtonGroupText
      className={cn(
        "border-none bg-transparent text-muted-foreground shadow-none",
        className
      )}
      {...props}
    >
      <Trans>
        {page} of {totalBranches}
      </Trans>
    </ButtonGroupText>
  );
};

export type MessageResponseProps = ComponentProps<typeof Streamdown>;

export const MessageResponse = memo(
  ({ className, ...props }: MessageResponseProps) => {
    const defaults = useStreamdownDefaults();

    return (
      <Streamdown
        className={cn(
          "size-full [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
          className
        )}
        icons={defaults.icons}
        translations={defaults.translations}
        {...props}
      />
    );
  },
  // Re-rendering markdown is the expensive part of streaming; only a change in
  // the text itself warrants it.
  (prevProps, nextProps) => prevProps.children === nextProps.children
);

MessageResponse.displayName = "MessageResponse";

export type MessageAttachmentProps = HTMLAttributes<HTMLDivElement> & {
  data: FileUIPart;
  className?: string;
  onRemove?: () => void;
};

export function MessageAttachment({
  data,
  className,
  onRemove,
  ...props
}: MessageAttachmentProps) {
  const { t } = useLingui();
  const filename = data.filename || "";
  const isImage = Boolean(data.mediaType?.startsWith("image/") && data.url);
  const attachmentLabel = filename || (isImage ? t`Image` : t`Attachment`);
  const handleRemove = useCallback(
    (event: { stopPropagation: () => void }) => {
      event.stopPropagation();
      onRemove?.();
    },
    [onRemove]
  );

  const removeButton = onRemove ? (
    <Button
      aria-label={t`Remove attachment`}
      className={cn(
        "size-6 rounded-full p-0 opacity-0 transition-opacity group-hover:opacity-100 [&>svg]:size-3",
        isImage
          ? "absolute end-2 top-2 bg-background/80 backdrop-blur-sm hover:bg-background"
          : "shrink-0 hover:bg-accent"
      )}
      onClick={handleRemove}
      type="button"
      variant="ghost"
    >
      <XIcon />
      <span className="sr-only">
        <Trans>Remove</Trans>
      </span>
    </Button>
  ) : null;

  return (
    <div
      className={cn(
        "group relative size-24 overflow-hidden rounded-lg",
        className
      )}
      {...props}
    >
      {isImage ? (
        // biome-ignore lint/performance/noImgElement: packages/ui is framework-agnostic, so next/image isn't available here.
        <img
          alt={attachmentLabel}
          className="size-full object-cover"
          height={100}
          src={data.url}
          width={100}
        />
      ) : (
        <Tooltip>
          <TooltipTrigger
            render={
              <div className="flex size-full shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground" />
            }
          >
            <PaperclipIcon className="size-4" />
          </TooltipTrigger>
          <TooltipContent>
            <p>{attachmentLabel}</p>
          </TooltipContent>
        </Tooltip>
      )}
      {removeButton}
    </div>
  );
}

export type MessageAttachmentsProps = ComponentProps<"div">;

export function MessageAttachments({
  children,
  className,
  ...props
}: MessageAttachmentsProps) {
  if (!children) {
    return null;
  }

  return (
    <div
      className={cn(
        "ms-auto flex w-fit flex-wrap items-start gap-2",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export type MessageToolbarProps = ComponentProps<"div">;

export const MessageToolbar = ({
  className,
  children,
  ...props
}: MessageToolbarProps) => (
  <div
    className={cn(
      "mt-4 flex w-full items-center justify-between gap-4",
      className
    )}
    {...props}
  >
    {children}
  </div>
);
