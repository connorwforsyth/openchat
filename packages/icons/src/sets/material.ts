// Material Symbols (Apache-2.0) mapped onto the lucide vocabulary. Names
// without a faithful symbol are left out on purpose and fall back to lucide:
// `GitBranchIcon` (Material has no git branch; `BranchIcon`, a conversation
// branch, draws `call_split`).
//
// The path data lives in `./material.glyphs`, which `icons:select` generates
// from the committed subset in `vendor/material-symbols` in the configured
// style, weight and fill, so the choice costs nothing at runtime. To add a
// symbol, reference it below and run `bun run icons:vendor`: both scripts read
// the `glyph.<symbol>` references.

import { fromMaterial } from "./adapters";
// biome-ignore lint/performance/noNamespaceImport: only ever read as static `glyph.<symbol>`, which bundlers shake per member; it's also what the generator keys on.
import * as glyph from "./material.glyphs";

// `@__PURE__` lets minifiers drop the wrappers (and so the path data) of icons
// nothing renders.

export const ArrowDownIcon = /* @__PURE__ */ fromMaterial(glyph.arrow_downward);
export const ArrowLeftIcon = /* @__PURE__ */ fromMaterial(glyph.arrow_back);
export const ArrowRightIcon = /* @__PURE__ */ fromMaterial(glyph.arrow_forward);
export const ArrowUpIcon = /* @__PURE__ */ fromMaterial(glyph.arrow_upward);
export const ChevronDownIcon = /* @__PURE__ */ fromMaterial(
  glyph.keyboard_arrow_down
);
export const ChevronLeftIcon = /* @__PURE__ */ fromMaterial(glyph.chevron_left);
export const ChevronRightIcon = /* @__PURE__ */ fromMaterial(
  glyph.chevron_right
);
export const ChevronUpIcon = /* @__PURE__ */ fromMaterial(
  glyph.keyboard_arrow_up
);
export const ChevronsUpDownIcon = /* @__PURE__ */ fromMaterial(
  glyph.unfold_more
);
export const ExternalLinkIcon = /* @__PURE__ */ fromMaterial(glyph.open_in_new);
export const MenuIcon = /* @__PURE__ */ fromMaterial(glyph.menu);
export const PanelLeftIcon = /* @__PURE__ */ fromMaterial(glyph.dock_to_right);
export const PanelRightIcon = /* @__PURE__ */ fromMaterial(glyph.dock_to_left);
export const CheckIcon = /* @__PURE__ */ fromMaterial(glyph.check);
export const CopyIcon = /* @__PURE__ */ fromMaterial(glyph.content_copy);
export const CornerDownLeftIcon = /* @__PURE__ */ fromMaterial(
  glyph.keyboard_return
);
export const DownloadIcon = /* @__PURE__ */ fromMaterial(glyph.download);
export const EllipsisIcon = /* @__PURE__ */ fromMaterial(glyph.more_horiz);
export const EllipsisVerticalIcon = /* @__PURE__ */ fromMaterial(
  glyph.more_vert
);
export const GripVerticalIcon = /* @__PURE__ */ fromMaterial(
  glyph.drag_indicator
);
export const LinkIcon = /* @__PURE__ */ fromMaterial(glyph.link);
export const LogOutIcon = /* @__PURE__ */ fromMaterial(glyph.logout);
export const Maximize2Icon = /* @__PURE__ */ fromMaterial(glyph.open_in_full);
export const MicIcon = /* @__PURE__ */ fromMaterial(glyph.mic);
export const MinusIcon = /* @__PURE__ */ fromMaterial(glyph.remove);
export const MoreHorizontalIcon = /* @__PURE__ */ fromMaterial(
  glyph.more_horiz
);
export const PaperclipIcon = /* @__PURE__ */ fromMaterial(glyph.attach_file);
export const PencilIcon = /* @__PURE__ */ fromMaterial(glyph.edit);
export const PinIcon = /* @__PURE__ */ fromMaterial(glyph.keep);
export const PinOffIcon = /* @__PURE__ */ fromMaterial(glyph.keep_off);
export const PlayIcon = /* @__PURE__ */ fromMaterial(glyph.play_arrow);
export const PlusIcon = /* @__PURE__ */ fromMaterial(glyph.add);
export const RefreshCwIcon = /* @__PURE__ */ fromMaterial(glyph.refresh);
export const RotateCcwIcon = /* @__PURE__ */ fromMaterial(glyph.replay);
export const SearchIcon = /* @__PURE__ */ fromMaterial(glyph.search);
export const SendIcon = /* @__PURE__ */ fromMaterial(glyph.send);
export const SettingsIcon = /* @__PURE__ */ fromMaterial(glyph.settings);
export const ShareIcon = /* @__PURE__ */ fromMaterial(glyph.ios_share);
export const SquareIcon = /* @__PURE__ */ fromMaterial(glyph.square);
export const SquarePenIcon = /* @__PURE__ */ fromMaterial(glyph.edit_square);
export const ThumbsDownIcon = /* @__PURE__ */ fromMaterial(glyph.thumb_down);
export const ThumbsUpIcon = /* @__PURE__ */ fromMaterial(glyph.thumb_up);
export const Trash2Icon = /* @__PURE__ */ fromMaterial(glyph.delete);
export const UploadIcon = /* @__PURE__ */ fromMaterial(glyph.upload);
export const UserPlusIcon = /* @__PURE__ */ fromMaterial(glyph.person_add);
export const XIcon = /* @__PURE__ */ fromMaterial(glyph.close);
export const ZoomInIcon = /* @__PURE__ */ fromMaterial(glyph.zoom_in);
export const ZoomOutIcon = /* @__PURE__ */ fromMaterial(glyph.zoom_out);
export const CircleAlertIcon = /* @__PURE__ */ fromMaterial(glyph.error);
export const CircleCheckIcon = /* @__PURE__ */ fromMaterial(glyph.check_circle);
export const CircleIcon = /* @__PURE__ */ fromMaterial(glyph.circle);
export const CircleXIcon = /* @__PURE__ */ fromMaterial(glyph.cancel);
export const ClockIcon = /* @__PURE__ */ fromMaterial(glyph.schedule);
export const InfoIcon = /* @__PURE__ */ fromMaterial(glyph.info);
export const Loader2Icon = /* @__PURE__ */ fromMaterial(
  glyph.progress_activity
);
export const LoaderCircleIcon = /* @__PURE__ */ fromMaterial(
  glyph.progress_activity
);
export const LoaderIcon = /* @__PURE__ */ fromMaterial(glyph.progress_activity);
export const OctagonXIcon = /* @__PURE__ */ fromMaterial(glyph.dangerous);
export const TriangleAlertIcon = /* @__PURE__ */ fromMaterial(glyph.warning);
export const AppWindowIcon = /* @__PURE__ */ fromMaterial(glyph.web_asset);
export const ArchiveIcon = /* @__PURE__ */ fromMaterial(glyph.archive);
export const AtSignIcon = /* @__PURE__ */ fromMaterial(glyph.alternate_email);
export const BotIcon = /* @__PURE__ */ fromMaterial(glyph.smart_toy);
export const Building2Icon = /* @__PURE__ */ fromMaterial(glyph.domain);
export const BrainIcon = /* @__PURE__ */ fromMaterial(glyph.neurology);
export const CalendarIcon = /* @__PURE__ */ fromMaterial(glyph.calendar_today);
export const CodeIcon = /* @__PURE__ */ fromMaterial(glyph.code);
export const EyeIcon = /* @__PURE__ */ fromMaterial(glyph.visibility);
export const EyeOffIcon = /* @__PURE__ */ fromMaterial(glyph.visibility_off);
export const FileIcon = /* @__PURE__ */ fromMaterial(glyph.draft);
export const FileTextIcon = /* @__PURE__ */ fromMaterial(glyph.description);
export const FolderIcon = /* @__PURE__ */ fromMaterial(glyph.folder);
export const GlobeIcon = /* @__PURE__ */ fromMaterial(glyph.language);
export const ImageIcon = /* @__PURE__ */ fromMaterial(glyph.image);
export const KeyboardIcon = /* @__PURE__ */ fromMaterial(glyph.keyboard);
export const LayersIcon = /* @__PURE__ */ fromMaterial(glyph.layers);
export const LibraryIcon = /* @__PURE__ */ fromMaterial(glyph.library_books);
export const LockIcon = /* @__PURE__ */ fromMaterial(glyph.lock);
export const MessageSquareIcon = /* @__PURE__ */ fromMaterial(
  glyph.chat_bubble
);
export const MonitorIcon = /* @__PURE__ */ fromMaterial(glyph.desktop_windows);
export const MoonIcon = /* @__PURE__ */ fromMaterial(glyph.dark_mode);
export const ShieldIcon = /* @__PURE__ */ fromMaterial(glyph.shield);
export const SparklesIcon = /* @__PURE__ */ fromMaterial(glyph.star_shine);
export const StarIcon = /* @__PURE__ */ fromMaterial(glyph.star);
export const SunIcon = /* @__PURE__ */ fromMaterial(glyph.light_mode);
export const TerminalIcon = /* @__PURE__ */ fromMaterial(glyph.terminal);
export const UserIcon = /* @__PURE__ */ fromMaterial(glyph.person);
export const UsersIcon = /* @__PURE__ */ fromMaterial(glyph.group);
export const WrenchIcon = /* @__PURE__ */ fromMaterial(glyph.build);
export const HistoryIcon = /* @__PURE__ */ fromMaterial(glyph.history);
export const KeyRoundIcon = /* @__PURE__ */ fromMaterial(glyph.key);
export const LanguagesIcon = /* @__PURE__ */ fromMaterial(glyph.translate);
export const MailIcon = /* @__PURE__ */ fromMaterial(glyph.mail);
export const NetworkIcon = /* @__PURE__ */ fromMaterial(glyph.lan);
export const PaletteIcon = /* @__PURE__ */ fromMaterial(glyph.palette);
export const WalletIcon = /* @__PURE__ */ fromMaterial(glyph.wallet);
export const AgentIcon = /* @__PURE__ */ fromMaterial(glyph.smart_toy);
export const AttachIcon = /* @__PURE__ */ fromMaterial(glyph.attach_file);
export const BranchIcon = /* @__PURE__ */ fromMaterial(glyph.call_split);
export const ContextIcon = /* @__PURE__ */ fromMaterial(glyph.layers);
export const NewChatIcon = /* @__PURE__ */ fromMaterial(glyph.edit_square);
export const ReasoningIcon = /* @__PURE__ */ fromMaterial(glyph.neurology);
export const StopIcon = /* @__PURE__ */ fromMaterial(glyph.stop);
export const ToolIcon = /* @__PURE__ */ fromMaterial(glyph.build);
