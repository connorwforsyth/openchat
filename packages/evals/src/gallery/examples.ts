import { readFileSync } from "node:fs";

import { artifactProblems } from "@workspace/ai/tools/artifact-content";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { imageDataUrl } from "@workspace/artifacts-kit/kinds/image";
import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

import { renderDawnPng } from "./image";

// The artifact gallery: one hand-made example of every built-in artifact
// kind, all for one made-up Melbourne bakery (Copperloaf) opening its fourth
// shop, so the seeded chat reads as one piece of work. Each `content` is
// what the model would send to `create_artifact`, stored and checked the
// way the tool does it (`storedGallery`). Pages, SVG and the React
// component bring their own colours, so they live in `content/` as data
// files rather than as product source.

export interface GalleryExample {
  /** The model's text: create_artifact's `content`. */
  readonly content: string;
  /** What the assistant says about it, just before its card. */
  readonly intro: string;
  /** For `code`: the language, as a code fence names it. */
  readonly language?: string;
  readonly title: string;
}

const file = (name: string): string =>
  readFileSync(new URL(`content/${name}`, import.meta.url), "utf8");

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const diagram = {
  direction: "TB",
  edges: [
    { from: "app", label: "pre-order", to: "api" },
    { from: "portal", label: "standing order", to: "api" },
    { from: "api", label: "charge", to: "payments" },
    { from: "api", label: "before 2 pm?", to: "cutoffs" },
    { from: "api", label: "save", to: "orders" },
    { from: "api", label: "confirm", to: "notify" },
    { from: "orders", label: "2 pm export", to: "planner" },
    { from: "cutoffs", to: "planner" },
    { from: "planner", to: "sheet" },
    { from: "planner", to: "labels" },
    { from: "sheet", to: "vans" },
    { from: "labels", to: "shelf" },
    { from: "notify", label: "ready by 7 am", to: "shelf" },
  ],
  nodes: [
    { group: "Customers", id: "app", label: "Customer app", shape: "stadium" },
    {
      group: "Customers",
      id: "portal",
      label: "Café portal",
      shape: "stadium",
    },
    {
      group: "Copperloaf cloud",
      id: "api",
      label: "Orders API",
      shape: "rounded",
    },
    { group: "Copperloaf cloud", id: "payments", label: "Payments" },
    {
      group: "Copperloaf cloud",
      id: "cutoffs",
      label: "Stock and cutoffs",
      shape: "diamond",
    },
    {
      group: "Copperloaf cloud",
      id: "orders",
      label: "Orders database",
      shape: "circle",
    },
    { group: "Copperloaf cloud", id: "notify", label: "SMS and email" },
    {
      group: "Bake floor",
      id: "planner",
      label: "Bake planner",
      shape: "rounded",
    },
    { group: "Bake floor", id: "sheet", label: "Bake sheet" },
    { group: "Bake floor", id: "labels", label: "Pickup labels" },
    {
      group: "Shops",
      id: "vans",
      label: "Delivery vans, 6:15 am",
      shape: "stadium",
    },
    {
      group: "Shops",
      id: "shelf",
      label: "Pickup shelf by the door",
      shape: "stadium",
    },
  ],
};

const slides = [
  {
    id: "title",
    notes:
      "Thank everyone for the site visit last week. This is the decision we put off in June.",
    source: `import { Title } from "@workspace/slide-ui";

export default function Opening() {
  return (
    <Title
      eyebrow="Board meeting · 28 October 2026"
      title="Why Northcote, why now"
      subtitle="The case for Copperloaf's fourth shop, and what we need from the board today."
    />
  );
}`,
  },
  {
    id: "agenda",
    source: `import { Agenda } from "@workspace/slide-ui";

export default function Plan() {
  return (
    <Agenda
      items={[
        "Where the three shops are today",
        "Why Northcote",
        "What it costs and when it pays back",
        "What could go wrong",
        "The decision",
      ]}
    />
  );
}`,
  },
  {
    id: "capacity",
    notes:
      "Saturday is the constraint, not the weekdays. All three shops sell out before 11.",
    source: `import { Slide } from "@workspace/slide-ui";

const shops = [
  { name: "Fitzroy", weekday: 310, saturday: 540, colour: "var(--chart-1)" },
  { name: "Carlton", weekday: 240, saturday: 470, colour: "var(--chart-2)" },
  { name: "Brunswick", weekday: 220, saturday: 455, colour: "var(--chart-3)" },
];
const most = 560;

export default function Capacity() {
  return (
    <Slide>
      <h2 style={{ fontSize: 64, margin: 0 }}>Every shop sells out on Saturday</h2>
      <p style={{ fontSize: 40, margin: 0, color: "var(--muted-foreground)" }}>
        Loaves sold per day, September 2026. The bar ends where the shelves ran empty.
      </p>
      <div style={{ display: "grid", gap: 40, marginTop: 24 }}>
        {shops.map((shop) => (
          <div key={shop.name} style={{ display: "grid", gridTemplateColumns: "280px 1fr", alignItems: "center", gap: 32 }}>
            <span style={{ fontSize: 40, fontWeight: 600 }}>{shop.name}</span>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ height: 48, width: (shop.weekday / most) * 1000, borderRadius: 12, background: "var(--muted)" }} />
                <span style={{ fontSize: 28, color: "var(--muted-foreground)" }}>{shop.weekday} on a weekday</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
                <div style={{ height: 48, width: (shop.saturday / most) * 1000, borderRadius: 12, background: shop.colour }} />
                <span style={{ fontSize: 28, fontWeight: 600 }}>{shop.saturday} on Saturday</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Slide>
  );
}`,
  },
  {
    id: "northcote",
    notes:
      "The pre-order data is the strongest argument: these people already travel to us.",
    source: `import { Stat } from "@workspace/slide-ui";

export default function WhyNorthcote() {
  return (
    <Stat
      title="Why Northcote"
      value="1 in 4"
      label="Fitzroy pre-orders come from Northcote and Thornbury"
      detail="They already ride 3 km for a loaf. A shop on High Street meets them halfway."
    />
  );
}`,
  },
  {
    id: "cost",
    source: `import { TwoColumn } from "@workspace/slide-ui";

const row = { display: "flex", justifyContent: "space-between", fontSize: 40, paddingBlock: 16, borderBottom: "2px solid var(--border)" };

export default function Cost() {
  return (
    <TwoColumn
      title="What it costs, and when it pays back"
      left={
        <div>
          <div style={row}><span>Equipment</span><strong>$164k</strong></div>
          <div style={row}><span>Build and fit-out</span><strong>$146k</strong></div>
          <div style={row}><span>Contingency</span><strong>$25k</strong></div>
          <div style={{ ...row, borderBottom: 0, color: "var(--primary)" }}><span>Forecast total</span><strong>$335k</strong></div>
        </div>
      }
      right={
        <div style={{ display: "grid", gap: 32 }}>
          <div style={{ background: "var(--muted)", borderRadius: 24, padding: 40 }}>
            <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1 }}>Week 10</div>
            <div style={{ fontSize: 40, marginTop: 16 }}>covers its weekly running costs</div>
          </div>
          <div style={{ background: "var(--muted)", borderRadius: 24, padding: 40 }}>
            <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1 }}>3.1 years</div>
            <div style={{ fontSize: 40, marginTop: 16 }}>to pay back the fit-out</div>
          </div>
        </div>
      }
    />
  );
}`,
  },
  {
    id: "risks",
    notes: "Walk through each, then stop for questions before the quote.",
    source: `import { Bullets } from "@workspace/slide-ui";

export default function Risks() {
  return (
    <Bullets
      title="What could go wrong"
      steps
      items={[
        "The oven ships late from Italy: we open with bread baked in Fitzroy",
        "We can't hire two 4 am bakers: Tomás and a Fitzroy baker cover four weeks",
        "February is slow: we've budgeted a loss and review it at week 6",
        "Builders find more under the florist's floor: $25k contingency, 7% of spend",
      ]}
    />
  );
}`,
  },
  {
    id: "quote",
    source: `import { Quote } from "@workspace/slide-ui";

export default function Neighbour() {
  return (
    <Quote
      quote="We'd take forty loaves a day from a shop on High Street, starting the week it opens."
      author="Jess Romano"
      byline="Owner, Hearth Grocer, Northcote"
    />
  );
}`,
  },
  {
    id: "decision",
    source: `import { Closing } from "@workspace/slide-ui";

export default function Decision() {
  return (
    <Closing
      title="Approve $340k for Northcote"
      subtitle="Builders start 9 November. Opening day is Saturday 6 February."
      contact="Mia Tran · mia@copperloaf.com.au"
    />
  );
}`,
  },
];

const siteHome = `import { Cta, Faq, FeatureGrid, Footer, Hero, Nav, Page, Stats, Testimonial } from "@workspace/site-ui";

const links = [
  { label: "Our bread", href: "#bread" },
  { label: "Shops", href: "#shops" },
  { label: "Wholesale", href: "wholesale.html" },
];

export default function Home() {
  return (
    <Page>
      <title>Copperloaf Bakehouse</title>
      <Nav brand="Copperloaf" label="Main" links={links} cta={{ label: "Pre-order", href: "#shops" }} />
      <Hero
        eyebrow="Now baking in Northcote"
        title="Slow bread, baked every morning in Melbourne's north"
        description="Sourdough, rye and laminated pastry from four neighbourhood bakehouses. Our fourth opens at 212 High Street, Northcote, on 6 February."
        actions={[
          { label: "Pre-order for tomorrow", href: "#shops", icon: "arrow-right" },
          { label: "Wholesale for cafés", href: "wholesale.html", variant: "outline" },
        ]}
      />
      <FeatureGrid
        id="bread"
        title="How we bake"
        description="Nothing about it is quick, and that's the point."
        features={[
          { icon: "clock", title: "Sixteen-hour proof", description: "Every loaf rests overnight at 3 °C, so the flavour develops and the crust blisters." },
          { icon: "globe", title: "Australian grain", description: "Flour milled by Laucke in South Australia and wholemeal stone-ground in Victoria." },
          { icon: "sun", title: "Out by 7 am", description: "The first bake is on the shelves when the doors open. Baguettes come out again at 10 and noon." },
          { icon: "users", title: "Bakers you can talk to", description: "The bake floor is behind glass in every shop. Ask us anything." },
          { icon: "zap", title: "Pre-order, skip the queue", description: "Order by 2 pm for the next morning; your loaves wait on the shelf by the door." },
          { icon: "shield", title: "Nothing wasted", description: "What's left at close goes to Fareshare and the Brunswick community pantry." },
        ]}
      />
      <Stats
        tone="muted"
        stats={[
          { value: "4", label: "Shops in the north" },
          { value: "6,400", label: "Loaves a week" },
          { value: "38", label: "Cafés we supply" },
          { value: "4.8", label: "Google rating" },
        ]}
      />
      <FeatureGrid
        id="shops"
        title="Our shops"
        columns={4}
        features={[
          { icon: "building", title: "Fitzroy", description: "88 Gertrude Street. Our first shop and the main bake floor. 7 am to 3 pm." },
          { icon: "building", title: "Carlton", description: "301 Lygon Street, near the Rathdowne Street corner. 7 am to 3 pm." },
          { icon: "building", title: "Brunswick", description: "140 Sydney Road, beside the market. 7 am to 2 pm." },
          { icon: "sparkles", title: "Northcote", description: "212 High Street. Opening Saturday 6 February 2027." },
        ]}
      />
      <Testimonial
        tone="muted"
        quote="The country loaf is the only bread my kids will eat. We've bought one every Saturday for four years."
        author="Lena Vasquez"
        byline="Regular at Brunswick since 2022"
      />
      <Faq
        title="Questions"
        items={[
          { question: "Is your sourdough really just flour, water and salt?", answer: "Yes, and our levain. Seeded and fruit loaves add seeds, fruit and spice, and nothing else." },
          { question: "Do you bake anything gluten-free?", answer: "No. Our bake floors are full of flour, so we can't promise anything is free of gluten." },
          { question: "Can I pre-order for a party?", answer: "Yes. Order in the app up to two weeks ahead, or email the shop for more than 20 loaves." },
        ]}
      />
      <Cta
        title="Tomorrow's bread, ordered today"
        description="Pre-orders close at 2 pm for the next morning."
        actions={[{ label: "Pre-order now", href: "#shops", icon: "arrow-right" }]}
      />
      <Footer
        label="Footer"
        brand="Copperloaf"
        links={[
          { label: "Wholesale", href: "wholesale.html" },
          { label: "Instagram", href: "https://instagram.com/copperloafbakehouse" },
        ]}
        note="© 2026 Copperloaf Bakehouse Pty Ltd · Baked on Wurundjeri country"
      />
    </Page>
  );
}
`;

const siteWholesale = `import { Cta, Footer, Hero, Nav, Page, Pricing, Prose } from "@workspace/site-ui";

export default function Wholesale() {
  return (
    <Page>
      <title>Wholesale · Copperloaf Bakehouse</title>
      <Nav brand="Copperloaf" brandHref="index.html" label="Main" links={[{ label: "Home", href: "index.html" }]} cta={{ label: "Become a stockist", href: "mailto:wholesale@copperloaf.com.au" }} />
      <Hero
        align="start"
        eyebrow="Wholesale"
        title="Bread for cafés, grocers and restaurants"
        description="Delivered before 7 am, six days a week, anywhere within 8 km of Fitzroy."
      />
      <Pricing
        title="Standing orders"
        description="Prices per loaf, excluding GST. Change your order by 2 pm for the next day."
        plans={[
          { name: "Café", price: "$7.20", period: "/loaf", description: "For cafés making toast and sandwiches.", features: ["Country loaf and seeded rye", "Minimum 10 loaves a day", "Delivery included"], action: { label: "Start an order", href: "mailto:wholesale@copperloaf.com.au", variant: "outline" } },
          { name: "Grocer", price: "$6.80", period: "/loaf", badge: "Most popular", highlighted: true, description: "For shelves that sell out by lunch.", features: ["The whole bread range", "Minimum 25 loaves a day", "Bags and shelf labels", "Delivery included"], action: { label: "Start an order", href: "mailto:wholesale@copperloaf.com.au" } },
          { name: "Restaurant", price: "$3.40", period: "/baguette", description: "For dinner service.", features: ["Baguettes and dinner rolls", "Second delivery at 3 pm", "Par-baked on request"], action: { label: "Talk to us", href: "mailto:wholesale@copperloaf.com.au", variant: "outline" } },
        ]}
      />
      <Prose>
        <h2>How it works</h2>
        <p>Tell us what you need each day of the week, and we bake it every morning until you change it. Most of our stockists adjust their order in the app on Thursday for the weekend.</p>
        <p>We invoice weekly on Friday, with 14-day terms. There's no contract: pause or stop with a day's notice.</p>
      </Prose>
      <Cta title="Try a week of bread" description="We'll deliver your first week at half price." actions={[{ label: "Email the wholesale team", href: "mailto:wholesale@copperloaf.com.au", icon: "mail" }]} />
      <Footer label="Footer" brand="Copperloaf" links={[{ label: "Home", href: "index.html" }]} note="© 2026 Copperloaf Bakehouse Pty Ltd" />
    </Page>
  );
}
`;

type Row = readonly (number | string | null)[];

/**
 * A sheet as the spreadsheet kind's JSON: `rows` from A1, a leading `=`
 * making a formula, number formats by column letter or by cell (which
 * wins), and widths by column letter.
 */
const sheet = (
  name: string,
  rows: readonly Row[],
  formats: Readonly<Record<string, string>>,
  widths: Readonly<Record<string, number>>
) => ({
  cells: Object.fromEntries(
    rows.flatMap((row, rowIndex) =>
      row.flatMap((value, colIndex) => {
        if (value === null || value === "") {
          return [];
        }
        const column = String.fromCharCode(65 + colIndex);
        const address = `${column}${rowIndex + 1}`;
        const fmt =
          rowIndex > 0 ? (formats[address] ?? formats[column]) : undefined;
        const cell =
          typeof value === "string" && value.startsWith("=")
            ? { f: value.slice(1) }
            : { v: value };
        return [[address, fmt ? { ...cell, fmt } : cell]] as const;
      })
    )
  ),
  cols: Object.fromEntries(
    Object.entries(widths).map(([column, width]) => [column, { width }])
  ),
  name,
});

const fitOutRow = (
  row: number,
  item: string,
  supplier: string,
  quoted: number | string,
  actual: number | null,
  status: string
): Row => [
  item,
  supplier,
  quoted,
  actual,
  `=IF(ISBLANK(D${row}),C${row},D${row})`,
  `=E${row}-C${row}`,
  status,
];

const weekRow = (
  week: number,
  loaves: number,
  pastries: number,
  coffees: number
): Row => {
  const row = week + 1;
  return [
    `Week ${week}`,
    loaves,
    pastries,
    coffees,
    `=B${row}*11.5+C${row}*6.2+D${row}*5.2`,
    `=15600+0.3*E${row}`,
    `=E${row}-F${row}`,
  ];
};

const spreadsheet = {
  sheets: [
    sheet(
      "Fit-out",
      [
        [
          "Item",
          "Supplier",
          "Quoted",
          "Actual",
          "Forecast",
          "Variance",
          "Status",
        ],
        fitOutRow(
          2,
          "Four-deck oven",
          "Tagliavini via Moffat",
          96_000,
          98_400,
          "Ordered"
        ),
        fitOutRow(3, "Spiral mixer, 60 L", "Esmach", 18_500, 18_500, "Paid"),
        fitOutRow(4, "Retarder-prover", "Bongard", 27_000, 25_900, "Paid"),
        fitOutRow(
          5,
          "Espresso machine, two group",
          "La Marzocco",
          21_500,
          21_500,
          "Paid"
        ),
        fitOutRow(
          6,
          "Strip-out and flooring",
          "Northside Builders",
          38_000,
          41_250,
          "In progress"
        ),
        fitOutRow(
          7,
          "Plumbing and gas",
          "Merri Plumbing",
          26_500,
          24_800,
          "In progress"
        ),
        fitOutRow(
          8,
          "Three-phase power",
          "Volt Electrical",
          19_000,
          19_000,
          "Booked"
        ),
        fitOutRow(
          9,
          "Counter and joinery",
          "Oakwork Studio",
          34_000,
          null,
          "Quoted"
        ),
        fitOutRow(
          10,
          "Signage and window",
          "Sign Supply Co.",
          8500,
          null,
          "Quoted"
        ),
        fitOutRow(11, "Furniture", "Hub Furniture", 12_500, 11_900, "Paid"),
        fitOutRow(
          12,
          "Permits and fees",
          "City of Darebin",
          6200,
          6450,
          "Paid"
        ),
        fitOutRow(
          13,
          "Contingency, 8%",
          "Held back",
          "=ROUND(SUM(C2:C12)*0.08,0)",
          null,
          "Held"
        ),
        [
          "Total",
          null,
          "=SUM(C2:C13)",
          "=SUM(D2:D13)",
          "=SUM(E2:E13)",
          "=SUM(F2:F13)",
          null,
        ],
      ],
      { C: "$#,##0", D: "$#,##0", E: "$#,##0", F: "$#,##0" },
      { A: 230, B: 190, C: 100, D: 100, E: 100, F: 100, G: 110 }
    ),
    sheet(
      "First ten weeks",
      [
        ["Week", "Loaves", "Pastries", "Coffees", "Revenue", "Costs", "Profit"],
        weekRow(1, 260, 520, 1300),
        weekRow(2, 290, 580, 1450),
        weekRow(3, 310, 640, 1600),
        weekRow(4, 330, 700, 1750),
        weekRow(5, 350, 750, 1850),
        weekRow(6, 370, 790, 1950),
        weekRow(7, 385, 830, 2050),
        weekRow(8, 400, 860, 2150),
        weekRow(9, 410, 880, 2250),
        weekRow(10, 420, 900, 2300),
        [
          "Total",
          "=SUM(B2:B11)",
          "=SUM(C2:C11)",
          "=SUM(D2:D11)",
          "=SUM(E2:E11)",
          "=SUM(F2:F11)",
          "=SUM(G2:G11)",
        ],
      ],
      {
        B: "#,##0",
        C: "#,##0",
        D: "#,##0",
        E: "$#,##0",
        F: "$#,##0",
        G: "$#,##0",
      },
      { A: 120, B: 90, C: 90, D: 90, E: 110, F: 110, G: 110 }
    ),
    sheet(
      "Summary",
      [
        ["Measure", "Value", "How it's worked out"],
        ["Budget approved", 340_000, "Asked of the board on 28 October"],
        [
          "Forecast spend",
          "='Fit-out'!E14",
          "Actuals where paid, quotes where not",
        ],
        ["Headroom", "=B2-B3", "Approved less forecast"],
        ["Over or under quotes", "='Fit-out'!F14", "Positive means over"],
        [
          "First profitable week",
          "=COUNTIF('First ten weeks'!G2:G11,\"<0\")+1",
          "The week after the last loss",
        ],
        [
          "Profit, first ten weeks",
          "='First ten weeks'!G12",
          "Opening losses included",
        ],
        [
          "Average weekly revenue",
          "=AVERAGE('First ten weeks'!E2:E11)",
          "Weeks 1 to 10",
        ],
      ],
      { B: "$#,##0", B6: "0" },
      { A: 220, B: 120, C: 300 }
    ),
  ],
};

/** Every built-in kind's example. */
export const galleryExamples: Readonly<Record<ArtifactKind, GalleryExample>> = {
  code: {
    content: file("code.ts.txt"),
    intro:
      "**Code.** The scheduling function behind the planner: it times each mix back from the van that needs it.",
    language: "ts",
    title: "bake-schedule.ts",
  },
  diagram: {
    content: json(diagram),
    intro:
      "**Diagram.** How a pre-order moves through our systems, from the app to the pickup shelf. Drag the nodes to rearrange it.",
    title: "Pre-order system",
  },
  document: {
    content: file("document.md"),
    intro:
      "**Document.** The opening plan, as rich text you can edit in the full-page editor and export to Word, PDF or Markdown.",
    title: "Northcote shop: opening plan",
  },
  html: {
    content: file("html.html.txt"),
    intro:
      "**Web page.** The counter menu for the new shop, as one HTML page ready to print or put on a screen.",
    title: "Northcote counter menu",
  },
  image: {
    content: imageDataUrl("image/png", renderDawnPng().toString("base64")),
    intro:
      "**Image.** Dawn over High Street, for the opening-week poster and the website's header.",
    title: "Dawn over High Street",
  },
  markdown: {
    content: file("markdown.md"),
    intro:
      "**Markdown.** The country loaf's production method for the bake floor: formula, timeline and fixes.",
    title: "Country loaf: production method",
  },
  mermaid: {
    content: file("mermaid.mmd"),
    intro:
      "**Mermaid.** The fit-out schedule as a Gantt chart, from permits to opening day.",
    title: "Fit-out schedule",
  },
  presentation: {
    content: json({ slides, title: "Why Northcote, why now" }),
    intro:
      "**Presentation.** Eight slides for Tuesday's board meeting, with speaker notes. Present it full screen or export to PowerPoint.",
    title: "Why Northcote, why now",
  },
  react: {
    content: file("react.tsx.txt"),
    intro:
      "**React component.** An interactive bake planner: pick a day, adjust café orders and watch the bake sheet update.",
    title: "Wholesale bake planner",
  },
  site: {
    content: json({
      files: { "index.tsx": siteHome, "wholesale.tsx": siteWholesale },
    }),
    intro:
      "**Site.** A two-page website (home and wholesale) you can preview here and publish to a link.",
    title: "Copperloaf website",
  },
  spreadsheet: {
    content: json(spreadsheet),
    intro:
      "**Spreadsheet.** The fit-out budget and a ten-week forecast, with live formulas across three sheets. It exports to Excel.",
    title: "Northcote budget and forecast",
  },
  svg: {
    content: file("svg.svg.txt"),
    intro:
      "**SVG.** The brand mark with its colours, drawn as a vector you can scale to a shop sign.",
    title: "Copperloaf brand mark",
  },
};

/** The order the chat shows them in: the plan first, the code last. */
export const GALLERY_ORDER: readonly ArtifactKind[] = [
  "document",
  "spreadsheet",
  "presentation",
  "site",
  "react",
  "html",
  "diagram",
  "mermaid",
  "svg",
  "image",
  "markdown",
  "code",
];

export interface StoredExample extends GalleryExample {
  readonly kind: ArtifactKind;
  /** Why `create_artifact` would refuse it; empty when it would save it. */
  readonly problems: readonly string[];
  /** The text a version stores (`kinds.fromModel`). */
  readonly stored: string;
}

/** The examples in order, as `create_artifact` would store and check them. */
export const storedGallery = (): readonly StoredExample[] =>
  GALLERY_ORDER.map((kind) => {
    const example = galleryExamples[kind];
    const stored = builtinArtifactKinds.fromModel(kind, example.content);
    return {
      ...example,
      kind,
      problems: artifactProblems({
        content: stored,
        language: example.language ?? null,
        title: example.title,
        type: kind,
      }),
      stored,
    };
  });
