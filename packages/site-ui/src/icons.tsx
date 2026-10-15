import {
  ArrowRightIcon,
  BrainIcon,
  Building2Icon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  CodeIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GlobeIcon,
  type Icon,
  ImageIcon,
  InfoIcon,
  LayersIcon,
  LayoutGridIcon,
  LockIcon,
  MailIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PaletteIcon,
  ShieldIcon,
  SparklesIcon,
  StarIcon,
  SunIcon,
  UsersIcon,
  WrenchIcon,
  ZapIcon,
} from "@workspace/icons";
import { cn } from "cn";

// The icons a site can name (163). A site is content, so it names an icon
// by what it shows ("sparkles") rather than importing a component; the
// blocks map the name to the instance's icon set here. A short list keeps
// the guide short and the runtime bundle small.

const SITE_ICONS = {
  "arrow-right": ArrowRightIcon,
  brain: BrainIcon,
  building: Building2Icon,
  calendar: CalendarIcon,
  check: CheckIcon,
  clock: ClockIcon,
  code: CodeIcon,
  "external-link": ExternalLinkIcon,
  "file-text": FileTextIcon,
  globe: GlobeIcon,
  image: ImageIcon,
  info: InfoIcon,
  layers: LayersIcon,
  "layout-grid": LayoutGridIcon,
  lock: LockIcon,
  mail: MailIcon,
  message: MessageSquareIcon,
  monitor: MonitorIcon,
  moon: MoonIcon,
  palette: PaletteIcon,
  shield: ShieldIcon,
  sparkles: SparklesIcon,
  star: StarIcon,
  sun: SunIcon,
  users: UsersIcon,
  wrench: WrenchIcon,
  zap: ZapIcon,
} as const satisfies Readonly<Record<string, Icon>>;

export type SiteIconName = keyof typeof SITE_ICONS;

/** Every name a block's `icon` prop takes. */
export const SITE_ICON_NAMES = Object.keys(
  SITE_ICONS
) as readonly SiteIconName[];

/**
 * The icon `name` draws, decorative (its text is beside it). An unknown
 * name draws nothing rather than breaking the page.
 */
export function SiteIcon({
  className,
  name,
}: {
  readonly className?: string;
  readonly name: SiteIconName | undefined;
}) {
  // `hasOwn`: the name is the model's, so `"constructor"` mustn't resolve.
  const Drawn =
    name !== undefined && Object.hasOwn(SITE_ICONS, name)
      ? SITE_ICONS[name]
      : undefined;
  return Drawn ? (
    <Drawn aria-hidden className={cn("size-5 shrink-0", className)} />
  ) : null;
}
