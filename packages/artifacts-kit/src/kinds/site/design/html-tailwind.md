### Design guide (html-tailwind)

Write clean, semantic HTML styled with Tailwind utility classes, on this instance's theme.

- **Colour:** only the theme's semantic tokens: `bg-background`, `text-foreground`, `bg-card`, `text-card-foreground`, `bg-primary` with `text-primary-foreground`, `bg-secondary`, `bg-muted`, `text-muted-foreground`, `bg-accent`, `border-border`, `ring-ring`, `text-destructive`, `bg-chart-1` to `bg-chart-5`. No hex values, and no palette classes (a colour name with a shade, such as blue-500). Light and dark follow the visitor's system setting, so the tokens are all you need.
- **Shape:** `rounded-md`, `rounded-lg` and `rounded-xl` follow the theme's radius. Borders are `border border-border`; shadows are rare and soft (`shadow-sm`).
- **Type:** the system sans-serif unless a font is wanted; then link it from Google Fonts in `<head>` and set it on `body`. One `h1` per page, headings in order, body text `text-base` with `leading-relaxed`, secondary text `text-muted-foreground`.
- **Layout:** landmarks (`header`, `nav`, `main`, `section`, `footer`); a centred column (`mx-auto max-w-5xl px-6`); generous vertical rhythm (`py-16`, `space-y-6`, `gap-6`). Mobile first: it must read at 375 px, then widen with `md:` and `lg:`.
- **Direction:** logical utilities (`ms-`, `me-`, `ps-`, `pe-`, `text-start`, `start-`, `end-`) so it works right to left.
- **Images:** inline SVG, an `.svg` file in the site, or an allowed origin, always with `alt` (empty for decoration).
- **Accessible:** real `<a>` and `<button>` elements, labels on inputs, visible focus (`focus-visible:ring-2 focus-visible:ring-ring`), alt text, enough contrast (the tokens have it).
- **Motion:** sparing; animate only `transform` and `opacity`, and add `motion-reduce:` variants.
- **Scripts:** small and optional; every page reads without them. Data lives in the page.
