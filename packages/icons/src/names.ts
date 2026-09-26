/**
 * The icon vocabulary. Names follow lucide (`ChevronRightIcon`, …) because
 * shadcn, AI Elements and React Native Reusables all import lucide names, so
 * the codemod can point their imports here unchanged. Semantic aliases name
 * what an icon means (`BranchIcon`) so a set can draw it differently.
 *
 * Adding an icon: add the name here, map it in `sets/lucide.ts` and
 * `sets/lucide.native.ts` (the fallback set must be complete), and optionally
 * in the other sets. `bun run icons:gaps` lists what each set still lacks.
 */
export const iconNames = [
  // Navigation
  "ArrowDownIcon",
  "ArrowLeftIcon",
  "ArrowRightIcon",
  "ArrowUpIcon",
  "ChevronDownIcon",
  "ChevronLeftIcon",
  "ChevronRightIcon",
  "ChevronUpIcon",
  "ChevronsUpDownIcon",
  "ExternalLinkIcon",
  "MenuIcon",
  "PanelLeftIcon",
  // Actions
  "CheckIcon",
  "CopyIcon",
  "DownloadIcon",
  "EllipsisIcon",
  "EllipsisVerticalIcon",
  "GripVerticalIcon",
  "LogOutIcon",
  "MicIcon",
  "MinusIcon",
  "MoreHorizontalIcon",
  "PaperclipIcon",
  "PencilIcon",
  "PlusIcon",
  "RefreshCwIcon",
  "RotateCcwIcon",
  "SearchIcon",
  "SendIcon",
  "SettingsIcon",
  "ShareIcon",
  "SquareIcon",
  "SquarePenIcon",
  "ThumbsDownIcon",
  "ThumbsUpIcon",
  "Trash2Icon",
  "UploadIcon",
  "XIcon",
  // Status
  "CircleAlertIcon",
  "CircleCheckIcon",
  "CircleIcon",
  "CircleXIcon",
  "InfoIcon",
  "Loader2Icon",
  "LoaderCircleIcon",
  "LoaderIcon",
  "OctagonXIcon",
  "TriangleAlertIcon",
  // Objects
  "BotIcon",
  "BrainIcon",
  "CalendarIcon",
  "EyeIcon",
  "EyeOffIcon",
  "FileIcon",
  "FileTextIcon",
  "GitBranchIcon",
  "GlobeIcon",
  "ImageIcon",
  "LayersIcon",
  "LockIcon",
  "MessageSquareIcon",
  "MonitorIcon",
  "MoonIcon",
  "SparklesIcon",
  "StarIcon",
  "SunIcon",
  "UserIcon",
  // Semantic aliases: what the icon means in this app, not what it draws
  "AgentIcon",
  "AttachIcon",
  "BranchIcon",
  "ContextIcon",
  "NewChatIcon",
  "ReasoningIcon",
  "StopIcon",
] as const;

export type IconName = (typeof iconNames)[number];
