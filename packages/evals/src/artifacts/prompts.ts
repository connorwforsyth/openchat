import type { ArtifactKind } from "@workspace/contract/schemas/message-parts";

// Ten realistic requests per artifact kind, worded the way people ask, for
// the live artifact eval (`live.ts`). Each names what it wants in plain
// words ("a slide deck", "an SVG"), never the tool or the kind's id, so
// the model has to pick the kind as it would in the app. Ids are stable:
// fixtures and baselines refer to them.

export interface ArtifactPrompt {
  readonly id: string;
  readonly prompt: string;
}

export const ARTIFACT_PROMPTS: Readonly<
  Record<ArtifactKind, readonly ArtifactPrompt[]>
> = {
  code: [
    {
      id: "code-csv-dedupe",
      prompt:
        "Write a Python script that reads contacts.csv, removes duplicate rows by email (case-insensitive), and writes contacts-clean.csv.",
    },
    {
      id: "code-debounce",
      prompt:
        "Give me a TypeScript debounce function with proper generics and a cancel method, as a file I can drop into my utils folder.",
    },
    {
      id: "code-sql-retention",
      prompt:
        "Write a Postgres SQL query for monthly cohort retention from a `events(user_id, occurred_at)` table.",
    },
    {
      id: "code-bash-backup",
      prompt:
        "I need a bash script that backs up ~/projects to a dated tar.gz in ~/backups and deletes archives older than 14 days.",
    },
    {
      id: "code-go-http",
      prompt:
        "Write a small Go HTTP server with a /health endpoint and graceful shutdown on SIGTERM.",
    },
    {
      id: "code-rust-wordfreq",
      prompt:
        "Rust program that counts word frequencies from stdin and prints the top 10. Make it a single main.rs.",
    },
    {
      id: "code-express-ratelimit",
      prompt:
        "Write an Express middleware that rate limits by IP, 100 requests per 15 minutes, in memory, no dependencies.",
    },
    {
      id: "code-pandas-sales",
      prompt:
        "Python with pandas: load sales.xlsx, group revenue by region and month, and save a pivot table to summary.xlsx.",
    },
    {
      id: "code-github-action",
      prompt:
        "Create a GitHub Actions workflow YAML that runs bun install, typecheck and tests on every pull request.",
    },
    {
      id: "code-binary-search",
      prompt:
        "Write a Java class with an iterative binary search and a few JUnit 5 tests for it.",
    },
  ],
  diagram: [
    {
      id: "diagram-signup-flow",
      prompt:
        "Make an editable diagram of our signup flow: landing page, sign up form, email verification, onboarding, dashboard, with a branch for invalid email.",
    },
    {
      id: "diagram-org-chart",
      prompt:
        "Draw an org chart diagram I can edit: CEO, then CTO, CFO and COO; under the CTO, Platform and Product engineering leads.",
    },
    {
      id: "diagram-aws-arch",
      prompt:
        "Create a diagram of a simple web architecture: users, CloudFront, load balancer, two app servers, Postgres primary and a read replica, plus Redis.",
    },
    {
      id: "diagram-support-triage",
      prompt:
        "I want a node diagram of how support tickets get triaged: new ticket, auto-tag, priority check, then urgent goes to on-call and the rest to the queue.",
    },
    {
      id: "diagram-ci-pipeline",
      prompt:
        "Diagram our CI pipeline as boxes and arrows: commit, lint, unit tests, build image, deploy to staging, smoke tests, manual approval, production.",
    },
    {
      id: "diagram-data-flow",
      prompt:
        "Make a data flow diagram: mobile app and web app send events to an ingest API, which writes to Kafka, then a stream processor feeds the warehouse and alerts.",
    },
    {
      id: "diagram-hiring",
      prompt:
        "Can you draw our hiring process as an editable flow diagram? Application, recruiter screen, take-home, onsite, debrief, offer or reject.",
    },
    {
      id: "diagram-mindmap-launch",
      prompt:
        "Create a diagram mapping out a product launch: the launch in the middle connected to marketing, sales enablement, docs, support readiness and pricing.",
    },
    {
      id: "diagram-order-states",
      prompt:
        "Diagram the states an e-commerce order goes through, from cart to delivered, including cancelled and refunded.",
    },
    {
      id: "diagram-network",
      prompt:
        "Draw a home network diagram: ISP modem, router, mesh nodes in the office and bedroom, a NAS, and a printer.",
    },
  ],
  document: [
    {
      id: "document-project-brief",
      prompt:
        "Write a project brief document for migrating our billing system from Stripe Billing to an in-house ledger. Goals, scope, risks, timeline.",
    },
    {
      id: "document-meeting-notes",
      prompt:
        "Turn this into tidy meeting notes I can edit later: we agreed to delay launch by two weeks, Priya owns QA, Sam will brief sales on Friday, budget unchanged.",
    },
    {
      id: "document-onboarding-guide",
      prompt:
        "Draft an onboarding guide document for new engineers joining a 20-person startup: first day, first week, who to ask, tools.",
    },
    {
      id: "document-cover-letter",
      prompt:
        "Write me a cover letter for a senior product designer role at a fintech, emphasising design systems and research.",
    },
    {
      id: "document-incident-postmortem",
      prompt:
        "Write a postmortem document for a 45-minute outage caused by an expired TLS certificate. Timeline, impact, root cause, action items.",
    },
    {
      id: "document-policy-remote",
      prompt:
        "Create a remote work policy document for a 50-person company: eligibility, hours, equipment stipend, security, travel.",
    },
    {
      id: "document-quarterly-report",
      prompt:
        "Write a Q3 report document for our customer success team: headline numbers, wins, churn reasons, and priorities for Q4. Make up plausible numbers.",
    },
    {
      id: "document-rfc",
      prompt:
        "Write an RFC document proposing we move from REST to tRPC for internal services. Include alternatives considered.",
    },
    {
      id: "document-lesson-plan",
      prompt:
        "Make a lesson plan document for a 60-minute high school class introducing photosynthesis.",
    },
    {
      id: "document-press-release",
      prompt:
        "Draft a press release document announcing that a small Melbourne coffee roaster has opened its second café.",
    },
  ],
  html: [
    {
      id: "html-pricing-page",
      prompt:
        "Make a single HTML page with a pricing table: three tiers, monthly/yearly toggle, highlight the middle plan.",
    },
    {
      id: "html-pomodoro",
      prompt:
        "Build me a pomodoro timer as one HTML file with start, pause and reset, and a progress ring.",
    },
    {
      id: "html-invoice",
      prompt:
        "Create an HTML invoice template for a freelance designer, nicely styled, ready to print.",
    },
    {
      id: "html-404",
      prompt: "Design a playful 404 page in HTML and CSS with a link home.",
    },
    {
      id: "html-tip-calculator",
      prompt:
        "Make a tip calculator web page in plain HTML/JS: bill amount, tip percentage buttons, split between people.",
    },
    {
      id: "html-event-invite",
      prompt:
        "Create an HTML page invitation for our team offsite in the Blue Mountains, 14-15 March, with an agenda and RSVP button.",
    },
    {
      id: "html-css-animation",
      prompt:
        "Write an HTML page that shows a loading animation of three bouncing dots, pure CSS.",
    },
    {
      id: "html-color-palette",
      prompt:
        "Make an HTML page that displays a five-colour palette for a calm wellness brand, with hex codes you can click to copy.",
    },
    {
      id: "html-resume",
      prompt:
        "Create a one-page HTML resume for a backend engineer with 6 years of experience.",
    },
    {
      id: "html-quiz",
      prompt:
        "Build a 5-question geography quiz as a single HTML page that scores you at the end.",
    },
  ],
  image: [
    {
      id: "image-hero-coffee",
      prompt:
        "Generate an image of a cosy coffee shop interior in the morning light, for a website hero.",
    },
    {
      id: "image-mascot",
      prompt:
        "Create an image of a friendly robot mascot holding a wrench, flat illustration style.",
    },
    {
      id: "image-product-shot",
      prompt:
        "Generate a product photo of a matte black water bottle on a concrete surface.",
    },
    {
      id: "image-landscape",
      prompt: "Make an image of a misty mountain lake at sunrise.",
    },
    {
      id: "image-book-cover",
      prompt:
        "Generate a book cover image for a sci-fi novel called 'The Quiet Orbit'.",
    },
    {
      id: "image-icon-set",
      prompt:
        "Create an image of a set of four pastel app icons: calendar, notes, weather, music.",
    },
    {
      id: "image-food",
      prompt: "Generate an overhead photo of a bowl of ramen with a soft egg.",
    },
    {
      id: "image-pattern",
      prompt: "Make a seamless pattern image of lemons and leaves.",
    },
    {
      id: "image-poster",
      prompt:
        "Generate a retro travel poster image for Kyoto in the style of the 1960s.",
    },
    {
      id: "image-avatar",
      prompt:
        "Create an image I can use as a profile avatar: a minimalist fox head, geometric.",
    },
  ],
  markdown: [
    {
      id: "markdown-readme",
      prompt:
        "Write a README.md for an open-source CLI called `tidy` that formats JSON and YAML files.",
    },
    {
      id: "markdown-cheatsheet",
      prompt: "Make a git cheat sheet in Markdown, grouped by task.",
    },
    {
      id: "markdown-changelog",
      prompt:
        "Write a CHANGELOG.md entry for version 2.4.0 with added, changed and fixed sections for a note-taking app.",
    },
    {
      id: "markdown-contributing",
      prompt:
        "Create a CONTRIBUTING.md for a TypeScript monorepo: setup, branching, commit style, PR checklist.",
    },
    {
      id: "markdown-recipe",
      prompt:
        "Give me a Markdown recipe for a weeknight chickpea curry with ingredients and steps.",
    },
    {
      id: "markdown-comparison",
      prompt:
        "Write a Markdown comparison of Postgres, MySQL and SQLite for a small SaaS, with a table.",
    },
    {
      id: "markdown-reading-list",
      prompt:
        "Make a Markdown reading list of 10 books on product management, with one line on each.",
    },
    {
      id: "markdown-api-docs",
      prompt:
        "Write Markdown API docs for a `POST /v1/invoices` endpoint: request body, response, errors, curl example.",
    },
    {
      id: "markdown-travel-itinerary",
      prompt:
        "Write a 5-day Tokyo itinerary in Markdown for a first-time visitor who likes food and design.",
    },
    {
      id: "markdown-adr",
      prompt:
        "Write an architecture decision record in Markdown for choosing Bun over Node for our tooling.",
    },
  ],
  mermaid: [
    {
      id: "mermaid-oauth-sequence",
      prompt: "Draw a Mermaid sequence diagram of an OAuth 2 PKCE login.",
    },
    {
      id: "mermaid-er",
      prompt:
        "Make a Mermaid ER diagram for a blog: users, posts, comments, tags, and post_tags.",
    },
    {
      id: "mermaid-gantt",
      prompt:
        "Create a Mermaid Gantt chart for a 10-week website redesign: discovery, design, build, QA, launch.",
    },
    {
      id: "mermaid-flowchart-refund",
      prompt:
        "Mermaid flowchart of our refund decision: within 30 days? item damaged? then refund, store credit or decline.",
    },
    {
      id: "mermaid-state-traffic",
      prompt:
        "Mermaid state diagram for a traffic light with a pedestrian button.",
    },
    {
      id: "mermaid-class",
      prompt:
        "Mermaid class diagram for a simple library system: Book, Member, Loan, Librarian.",
    },
    {
      id: "mermaid-pie",
      prompt:
        "Make a Mermaid pie chart of where our time goes: meetings 30%, coding 40%, reviews 15%, support 15%.",
    },
    {
      id: "mermaid-git-graph",
      prompt:
        "Show a Mermaid git graph of a feature branch, a hotfix, and both merged into main.",
    },
    {
      id: "mermaid-timeline",
      prompt:
        "Create a Mermaid timeline of the history of the web from 1989 to 2010.",
    },
    {
      id: "mermaid-mindmap",
      prompt:
        "Make a Mermaid mindmap for planning a wedding: venue, guests, food, music, budget.",
    },
  ],
  presentation: [
    {
      id: "slides-coffee-pitch",
      prompt:
        "Make a 6-slide pitch deck for a specialty coffee subscription startup: problem, solution, market, business model, traction, ask.",
    },
    {
      id: "slides-quarterly-review",
      prompt:
        "Create a slide deck for our Q3 engineering review: highlights, metrics, incidents, what's next. Around 7 slides.",
    },
    {
      id: "slides-onboarding",
      prompt:
        "Build a short presentation welcoming new hires: our mission, values, how we work, first-week checklist.",
    },
    {
      id: "slides-climate-lecture",
      prompt:
        "Make slides for a 10-minute talk to high school students about how solar panels work.",
    },
    {
      id: "slides-product-launch",
      prompt:
        "Create a product launch deck for a new budgeting app feature called Smart Envelopes, with speaker notes.",
    },
    {
      id: "slides-design-crit",
      prompt:
        "I need 5 slides to present a checkout redesign to stakeholders: goals, research findings, before/after, metrics, next steps.",
    },
    {
      id: "slides-sales-kickoff",
      prompt:
        "Make a sales kickoff presentation with a big title slide, last year's numbers, this year's targets and three priorities.",
    },
    {
      id: "slides-book-summary",
      prompt:
        "Turn the key ideas of 'Atomic Habits' into a 6-slide presentation.",
    },
    {
      id: "slides-wedding-toast",
      prompt:
        "Make a fun slideshow for my brother's wedding toast: how they met, funny moments, a toast at the end.",
    },
    {
      id: "slides-security-training",
      prompt:
        "Create a security awareness training deck: phishing, passwords, MFA, reporting incidents. Include a quiz slide.",
    },
  ],
  react: [
    {
      id: "react-todo",
      prompt:
        "Build a React todo list component with add, complete, delete and a filter for active/done.",
    },
    {
      id: "react-kanban",
      prompt:
        "Make a React kanban board with three columns where I can move cards between columns with buttons.",
    },
    {
      id: "react-mortgage",
      prompt:
        "Create a React mortgage calculator: loan amount, interest rate, term, and a monthly payment readout.",
    },
    {
      id: "react-weather-card",
      prompt:
        "Make a React weather dashboard card with a 5-day forecast using made-up data.",
    },
    {
      id: "react-chart",
      prompt:
        "Build a React component that shows monthly revenue as a bar chart with recharts, using sample data.",
    },
    {
      id: "react-form-validation",
      prompt:
        "Make a React signup form with live validation for email, password strength and matching confirm password.",
    },
    {
      id: "react-memory-game",
      prompt:
        "Create a memory card matching game in React with 8 pairs of emoji.",
    },
    {
      id: "react-stopwatch",
      prompt: "Make a React stopwatch with laps.",
    },
    {
      id: "react-data-table",
      prompt:
        "Build a React data table of 20 employees with sorting by column and a search box.",
    },
    {
      id: "react-habit-tracker",
      prompt:
        "Create a React habit tracker showing the last 7 days for 4 habits, clickable to toggle.",
    },
  ],
  site: [
    {
      id: "site-bakery",
      prompt:
        "Build a website for a neighbourhood bakery: home page with hero, menu highlights, opening hours and location.",
    },
    {
      id: "site-saas-landing",
      prompt:
        "Make a landing site for a B2B SaaS that automates expense reports: hero, features, pricing, FAQ, sign-up call to action.",
    },
    {
      id: "site-portfolio",
      prompt:
        "Create a portfolio website for a freelance photographer with a gallery, about section and contact.",
    },
    {
      id: "site-conference",
      prompt:
        "Build a site for a one-day design conference in Sydney: speakers, schedule, venue and tickets.",
    },
    {
      id: "site-nonprofit",
      prompt:
        "Make a website for a local animal shelter: adoptable pets, how to volunteer, donate button.",
    },
    {
      id: "site-restaurant",
      prompt:
        "Create a multi-page site for an Italian restaurant: home, menu page, and bookings page.",
    },
    {
      id: "site-app-launch",
      prompt:
        "Build a launch website for a meditation app with screenshots placeholders, testimonials and app store buttons.",
    },
    {
      id: "site-agency",
      prompt:
        "Make a website for a small branding agency: case studies, services, team, contact.",
    },
    {
      id: "site-wedding",
      prompt:
        "Create a wedding website with our story, the day's schedule, travel info and an RSVP section.",
    },
    {
      id: "site-docs",
      prompt:
        "Build a simple documentation site for an API: getting started, authentication, endpoints overview.",
    },
  ],
  spreadsheet: [
    {
      id: "sheet-budget",
      prompt:
        "Make a monthly household budget spreadsheet with income, categories of expenses, totals and what's left over.",
    },
    {
      id: "sheet-loan-schedule",
      prompt:
        "Create a spreadsheet loan amortisation schedule for $25,000 at 7% over 3 years.",
    },
    {
      id: "sheet-sales-tracker",
      prompt:
        "Build a sales tracker spreadsheet for 8 reps with quarterly numbers, totals and percent of target.",
    },
    {
      id: "sheet-project-plan",
      prompt:
        "Make a project plan spreadsheet: tasks, owner, start date, end date, duration in days, status.",
    },
    {
      id: "sheet-grade-book",
      prompt:
        "Create a grade book spreadsheet for 10 students across 4 assignments with averages and letter grades.",
    },
    {
      id: "sheet-pricing-model",
      prompt:
        "Spreadsheet for a SaaS pricing model: three plans, customers per plan, monthly price, MRR and ARR.",
    },
    {
      id: "sheet-inventory",
      prompt:
        "Make an inventory spreadsheet for a small shop with reorder level and a column flagging what to reorder.",
    },
    {
      id: "sheet-travel-expenses",
      prompt:
        "Create a travel expense sheet for a 4-day trip with categories, amounts in two currencies and a total.",
    },
    {
      id: "sheet-workout-log",
      prompt:
        "Make a spreadsheet workout log for 4 weeks of squats, bench and deadlift with weekly volume.",
    },
    {
      id: "sheet-break-even",
      prompt:
        "Build a break-even analysis spreadsheet for a food truck: fixed costs, price per meal, variable cost, break-even units.",
    },
  ],
  svg: [
    {
      id: "svg-sun-icon",
      prompt: "Make an SVG icon of a sun, simple line style, 24x24.",
    },
    {
      id: "svg-logo-bakery",
      prompt: "Design an SVG logo for a bakery called Crumb & Co.",
    },
    {
      id: "svg-bar-chart",
      prompt:
        "Create an SVG bar chart of quarterly revenue: Q1 120, Q2 150, Q3 135, Q4 190.",
    },
    {
      id: "svg-badge",
      prompt: "Make an SVG 'Verified' badge with a checkmark.",
    },
    {
      id: "svg-illustration",
      prompt:
        "Draw an SVG illustration of a little house with a tree and clouds.",
    },
    {
      id: "svg-loader",
      prompt: "Create an animated SVG spinner.",
    },
    {
      id: "svg-map-pin",
      prompt: "Make an SVG map pin icon with a drop shadow.",
    },
    {
      id: "svg-pie",
      prompt:
        "Create an SVG donut chart showing 45% mobile, 35% desktop, 20% tablet with a legend.",
    },
    {
      id: "svg-wave-divider",
      prompt: "Make an SVG wave section divider for a website, 1440 wide.",
    },
    {
      id: "svg-avatar",
      prompt: "Draw a simple SVG avatar of a person with glasses, flat style.",
    },
  ],
};
