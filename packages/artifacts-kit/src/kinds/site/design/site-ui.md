### Design guide (site-ui)

Write each page as a `.tsx` file that composes `@workspace/site-ui`'s blocks. The blocks are styled on this instance's theme, light and dark, mobile first and right-to-left ready, so a page is mostly content: fill in the props and the page looks right. A page imports only from `"@workspace/site-ui"` and `"react"`, and its default export is the page.

- Wrap every page in `<Page>`, then `Nav`, the sections, and `Footer` last. One `Hero` per page, at the top. Give the page a tab title with `<title>…</title>` inside `<Page>`; React puts it in the head.
- All words are props, aria labels included (`label` on `Nav` and `Footer`), in the language the user writes in.
- Links: `href` is a relative path to another page by its `.html` name (`about.html`, even for `about.tsx`), an anchor (`#pricing`, matching a block's `id`), or a full https URL.
- Actions (`SiteAction`): `{ label, href, variant?, icon? }`; `variant` is `"default"`, `"secondary"`, `"outline"` or `"ghost"`.
- Icons are names: `arrow-right`, `brain`, `building`, `calendar`, `check`, `clock`, `code`, `external-link`, `file-text`, `globe`, `image`, `info`, `layers`, `layout-grid`, `lock`, `mail`, `message`, `monitor`, `moon`, `palette`, `shield`, `sparkles`, `star`, `sun`, `users`, `wrench`, `zap`.
- `tone: "muted"` on a section sets it on the muted background; alternate it to separate sections.
- Anything the blocks don't cover goes inside `Section` (or `Prose` for running text) as plain elements with Tailwind classes, following the html-tailwind guide's rules for colour, type and direction.

The blocks:

- `Page({ children })`: the page.
- `Nav({ brand, label, links?, cta?, brandHref? })`: the top bar. `links` are `{ label, href }`; `cta` is one action.
- `Hero({ title, description?, eyebrow?, actions?, align? })`: the opening; `align` is `"center"` (default) or `"start"`.
- `FeatureGrid({ features, title?, description?, columns?, id?, tone? })`: `features` are `{ title, description, icon? }`; `columns` is 2, 3 (default) or 4.
- `Stats({ stats, title?, description?, id?, tone? })`: `stats` are `{ value, label }`, the value as it reads ("12k").
- `Testimonial({ quote, author, byline?, tone? })`.
- `Pricing({ plans, title?, description?, id?, tone? })`: `plans` are `{ name, price, period?, description?, features, action, highlighted?, badge? }`; `features` are strings.
- `Faq({ items, title?, description?, id?, tone? })`: `items` are `{ question, answer }`; they open and close without script.
- `Cta({ title, actions, description?, id? })`: the closing ask.
- `Footer({ label, brand?, links?, note? })`.
- `Section({ children, title?, description?, id?, tone? })`: a band for your own content.
- `Prose({ children })`: running text as plain `h1`, `h2`, `p`, `ul`, `a`, `blockquote`.

A home page:

```tsx
import { Cta, Faq, FeatureGrid, Footer, Hero, Nav, Page, Pricing, Stats } from "@workspace/site-ui";

const links = [
  { label: "Features", href: "#features" },
  { label: "Pricing", href: "#pricing" },
  { label: "About", href: "about.html" },
];

export default function Home() {
  return (
    <Page>
      <title>Harbour Walks</title>
      <Nav brand="Harbour" label="Main" links={links} cta={{ label: "Book a walk", href: "#pricing" }} />
      <Hero
        eyebrow="Spring 2026"
        title="Walks around the old harbour"
        description="Small groups, local guides, two hours on foot."
        actions={[
          { label: "See prices", href: "#pricing", icon: "arrow-right" },
          { label: "About us", href: "about.html", variant: "outline" },
        ]}
      />
      <FeatureGrid
        id="features"
        title="Why walk with us"
        features={[
          { icon: "users", title: "Small groups", description: "Eight people at most." },
          { icon: "clock", title: "Two hours", description: "Morning and evening starts." },
          { icon: "globe", title: "Four languages", description: "English, French, German, Spanish." },
        ]}
      />
      <Stats tone="muted" stats={[{ value: "12k", label: "Walkers" }, { value: "4.9/5", label: "Rating" }]} />
      <Pricing
        id="pricing"
        title="Prices"
        plans={[
          { name: "Day walk", price: "$25", period: "/person", features: ["Two hours", "Guide"], action: { label: "Book", href: "#book" } },
          { name: "Private", price: "$180", badge: "Popular", highlighted: true, features: ["Your group", "Any time"], action: { label: "Enquire", href: "mailto:hello@example.com" } },
        ]}
      />
      <Faq title="Questions" items={[{ question: "What if it rains?", answer: "We walk anyway, or move you to another day." }]} />
      <Cta title="Ready to walk?" actions={[{ label: "Book a walk", href: "#pricing" }]} />
      <Footer label="Footer" brand="Harbour" links={[{ label: "About", href: "about.html" }]} note="© 2026 Harbour Walks" />
    </Page>
  );
}
```

A text page with your own markup:

```tsx
import { Footer, Nav, Page, Prose, Section, Testimonial } from "@workspace/site-ui";

export default function About() {
  return (
    <Page>
      <Nav brand="Harbour" label="Main" links={[{ label: "Home", href: "index.html" }]} />
      <Prose>
        <h1>About Harbour Walks</h1>
        <p>We started in 2019 with one guide and a map.</p>
      </Prose>
      <Testimonial tone="muted" quote="The best morning of our trip." author="Ana" byline="Visitor from Lisbon" />
      <Section title="Find us">
        <p className="text-center text-muted-foreground">Meet at the clock tower on the quay.</p>
      </Section>
      <Footer label="Footer" note="© 2026 Harbour Walks" />
    </Page>
  );
}
```
