// What a slide imports from `@workspace/slide-ui` (164). Its value exports
// are exactly the Presentation kind's `SLIDE_UI_EXPORTS` (`slides.test.tsx`
// keeps them equal), so a save can name an unknown component before anyone
// opens the deck.

// biome-ignore lint/performance/noBarrelFile: this module is the package's public surface, the list a slide imports from.
export {
  Agenda,
  type AgendaProps,
  Bullets,
  type BulletsProps,
  Closing,
  type ClosingProps,
  ImageSlide,
  type ImageSlideProps,
  Quote,
  type QuoteProps,
  Section,
  type SectionProps,
  Stat,
  type StatProps,
  Title,
  type TitleProps,
  TwoColumn,
  type TwoColumnProps,
} from "./layouts";
export {
  Logo,
  type LogoProps,
  Notes,
  Slide,
  type SlideProps,
  type SlideTone,
  Step,
} from "./primitives";
