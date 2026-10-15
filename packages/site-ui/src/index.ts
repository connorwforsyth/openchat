// What a site's TSX page imports from `@workspace/site-ui` (163). Its
// value exports are exactly the Site kind's `SITE_UI_EXPORTS`
// (`index.test.tsx` keeps them equal), so a save can name an unknown
// component before anyone opens the page.

// biome-ignore lint/performance/noBarrelFile: this module is the package's public surface, the list a site imports from.
export {
  Cta,
  type CtaProps,
  Faq,
  type FaqItem,
  type FaqProps,
  type Feature,
  FeatureGrid,
  type FeatureGridProps,
  Hero,
  type HeroProps,
  type Plan,
  Pricing,
  type PricingProps,
  type Stat,
  Stats,
  type StatsProps,
  Testimonial,
  type TestimonialProps,
} from "./blocks";
export type { SiteIconName } from "./icons";
export {
  Footer,
  type FooterProps,
  Nav,
  type NavProps,
  Page,
  Prose,
  Section,
  type SectionProps,
} from "./layout";
export type { SiteAction, SiteLink } from "./links";
