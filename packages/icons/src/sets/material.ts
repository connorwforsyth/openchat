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

import type { Icon } from "../types";
import { materialGlyph as draw } from "./adapters";
// biome-ignore lint/performance/noNamespaceImport: only ever read as static `glyph.<symbol>`, which bundlers shake per member; it's also what the generator keys on.
import * as glyph from "./material.glyphs";

export const ArrowDownIcon: Icon = (p) => draw(p, glyph.arrow_downward);
export const ArrowLeftIcon: Icon = (p) => draw(p, glyph.arrow_back);
export const ArrowRightIcon: Icon = (p) => draw(p, glyph.arrow_forward);
export const ArrowUpIcon: Icon = (p) => draw(p, glyph.arrow_upward);
export const ChevronDownIcon: Icon = (p) => draw(p, glyph.keyboard_arrow_down);
export const ChevronLeftIcon: Icon = (p) => draw(p, glyph.chevron_left);
export const ChevronRightIcon: Icon = (p) => draw(p, glyph.chevron_right);
export const ChevronUpIcon: Icon = (p) => draw(p, glyph.keyboard_arrow_up);
export const ChevronsUpDownIcon: Icon = (p) => draw(p, glyph.unfold_more);
export const ExternalLinkIcon: Icon = (p) => draw(p, glyph.open_in_new);
export const MenuIcon: Icon = (p) => draw(p, glyph.menu);
export const PanelLeftIcon: Icon = (p) => draw(p, glyph.dock_to_right);
export const PanelRightIcon: Icon = (p) => draw(p, glyph.dock_to_left);
export const CheckIcon: Icon = (p) => draw(p, glyph.check);
export const CopyIcon: Icon = (p) => draw(p, glyph.content_copy);
export const CornerDownLeftIcon: Icon = (p) => draw(p, glyph.keyboard_return);
export const DownloadIcon: Icon = (p) => draw(p, glyph.download);
export const EllipsisIcon: Icon = (p) => draw(p, glyph.more_horiz);
export const EllipsisVerticalIcon: Icon = (p) => draw(p, glyph.more_vert);
export const GripVerticalIcon: Icon = (p) => draw(p, glyph.drag_indicator);
export const LinkIcon: Icon = (p) => draw(p, glyph.link);
export const LogOutIcon: Icon = (p) => draw(p, glyph.logout);
export const Maximize2Icon: Icon = (p) => draw(p, glyph.open_in_full);
export const MicIcon: Icon = (p) => draw(p, glyph.mic);
export const MinusIcon: Icon = (p) => draw(p, glyph.remove);
export const MoreHorizontalIcon: Icon = (p) => draw(p, glyph.more_horiz);
export const PaperclipIcon: Icon = (p) => draw(p, glyph.attach_file);
export const PencilIcon: Icon = (p) => draw(p, glyph.edit);
export const PinIcon: Icon = (p) => draw(p, glyph.keep);
export const PinOffIcon: Icon = (p) => draw(p, glyph.keep_off);
export const PlayIcon: Icon = (p) => draw(p, glyph.play_arrow);
export const PlusIcon: Icon = (p) => draw(p, glyph.add);
export const RefreshCwIcon: Icon = (p) => draw(p, glyph.refresh);
export const RotateCcwIcon: Icon = (p) => draw(p, glyph.replay);
export const SearchIcon: Icon = (p) => draw(p, glyph.search);
export const SendIcon: Icon = (p) => draw(p, glyph.send);
export const SettingsIcon: Icon = (p) => draw(p, glyph.settings);
export const ShareIcon: Icon = (p) => draw(p, glyph.ios_share);
export const SquareIcon: Icon = (p) => draw(p, glyph.square);
export const SquarePenIcon: Icon = (p) => draw(p, glyph.edit_square);
export const ThumbsDownIcon: Icon = (p) => draw(p, glyph.thumb_down);
export const ThumbsUpIcon: Icon = (p) => draw(p, glyph.thumb_up);
export const Trash2Icon: Icon = (p) => draw(p, glyph.delete);
export const UploadIcon: Icon = (p) => draw(p, glyph.upload);
export const UserPlusIcon: Icon = (p) => draw(p, glyph.person_add);
export const XIcon: Icon = (p) => draw(p, glyph.close);
export const ZoomInIcon: Icon = (p) => draw(p, glyph.zoom_in);
export const ZoomOutIcon: Icon = (p) => draw(p, glyph.zoom_out);
export const CircleAlertIcon: Icon = (p) => draw(p, glyph.error);
export const CircleCheckIcon: Icon = (p) => draw(p, glyph.check_circle);
export const CircleIcon: Icon = (p) => draw(p, glyph.circle);
export const CircleXIcon: Icon = (p) => draw(p, glyph.cancel);
export const ClockIcon: Icon = (p) => draw(p, glyph.schedule);
export const InfoIcon: Icon = (p) => draw(p, glyph.info);
export const Loader2Icon: Icon = (p) => draw(p, glyph.progress_activity);
export const LoaderCircleIcon: Icon = (p) => draw(p, glyph.progress_activity);
export const LoaderIcon: Icon = (p) => draw(p, glyph.progress_activity);
export const OctagonXIcon: Icon = (p) => draw(p, glyph.dangerous);
export const TriangleAlertIcon: Icon = (p) => draw(p, glyph.warning);
export const AppWindowIcon: Icon = (p) => draw(p, glyph.web_asset);
export const ArchiveIcon: Icon = (p) => draw(p, glyph.archive);
export const AtSignIcon: Icon = (p) => draw(p, glyph.alternate_email);
export const BotIcon: Icon = (p) => draw(p, glyph.smart_toy);
export const Building2Icon: Icon = (p) => draw(p, glyph.domain);
export const BrainIcon: Icon = (p) => draw(p, glyph.neurology);
export const CalendarIcon: Icon = (p) => draw(p, glyph.calendar_today);
export const CodeIcon: Icon = (p) => draw(p, glyph.code);
export const EyeIcon: Icon = (p) => draw(p, glyph.visibility);
export const EyeOffIcon: Icon = (p) => draw(p, glyph.visibility_off);
export const FileIcon: Icon = (p) => draw(p, glyph.draft);
export const FileTextIcon: Icon = (p) => draw(p, glyph.description);
export const FolderIcon: Icon = (p) => draw(p, glyph.folder);
export const GlobeIcon: Icon = (p) => draw(p, glyph.language);
export const ImageIcon: Icon = (p) => draw(p, glyph.image);
export const KeyboardIcon: Icon = (p) => draw(p, glyph.keyboard);
export const LayersIcon: Icon = (p) => draw(p, glyph.layers);
export const LibraryIcon: Icon = (p) => draw(p, glyph.library_books);
export const LockIcon: Icon = (p) => draw(p, glyph.lock);
export const MessageSquareIcon: Icon = (p) => draw(p, glyph.chat_bubble);
export const MonitorIcon: Icon = (p) => draw(p, glyph.desktop_windows);
export const MoonIcon: Icon = (p) => draw(p, glyph.dark_mode);
export const ShieldIcon: Icon = (p) => draw(p, glyph.shield);
export const SparklesIcon: Icon = (p) => draw(p, glyph.star_shine);
export const StarIcon: Icon = (p) => draw(p, glyph.star);
export const SunIcon: Icon = (p) => draw(p, glyph.light_mode);
export const TerminalIcon: Icon = (p) => draw(p, glyph.terminal);
export const UserIcon: Icon = (p) => draw(p, glyph.person);
export const UsersIcon: Icon = (p) => draw(p, glyph.group);
export const WrenchIcon: Icon = (p) => draw(p, glyph.build);
export const HistoryIcon: Icon = (p) => draw(p, glyph.history);
export const KeyRoundIcon: Icon = (p) => draw(p, glyph.key);
export const LanguagesIcon: Icon = (p) => draw(p, glyph.translate);
export const MailIcon: Icon = (p) => draw(p, glyph.mail);
export const NetworkIcon: Icon = (p) => draw(p, glyph.lan);
export const PaletteIcon: Icon = (p) => draw(p, glyph.palette);
export const WalletIcon: Icon = (p) => draw(p, glyph.wallet);
export const AgentIcon: Icon = (p) => draw(p, glyph.smart_toy);
export const AttachIcon: Icon = (p) => draw(p, glyph.attach_file);
export const BranchIcon: Icon = (p) => draw(p, glyph.call_split);
export const ContextIcon: Icon = (p) => draw(p, glyph.layers);
export const NewChatIcon: Icon = (p) => draw(p, glyph.edit_square);
export const ReasoningIcon: Icon = (p) => draw(p, glyph.neurology);
export const StopIcon: Icon = (p) => draw(p, glyph.stop);
export const ToolIcon: Icon = (p) => draw(p, glyph.build);
