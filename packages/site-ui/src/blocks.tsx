import { Badge } from "@workspace/ui/components/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { cn } from "cn";

import { SiteIcon, type SiteIconName } from "./icons";
import { Section } from "./layout";
import { ActionLink, Actions, type SiteAction } from "./links";

// The sections a landing page is made of (163), each a function of plain
// data: a site is written as props, so the model fills in content rather
// than styling markup. Built from the kit's static parts (card, badge,
// button styles, separator): no overlays and no animation utilities, which
// a site's Tailwind doesn't have.

export interface HeroProps {
  readonly actions?: readonly SiteAction[];
  readonly align?: "center" | "start";
  readonly description?: string;
  /** A short line above the title, like "New in 2026". */
  readonly eyebrow?: string;
  readonly title: string;
}

/** The top of a page: what this is, in a sentence, and what to do next. */
export function Hero({
  actions,
  align = "center",
  description,
  eyebrow,
  title,
}: HeroProps) {
  const centered = align === "center";
  return (
    <section className="py-24">
      <div
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-col gap-6 px-6",
          centered ? "items-center text-center" : "items-start text-start"
        )}
      >
        {eyebrow ? <Badge variant="secondary">{eyebrow}</Badge> : null}
        <h1 className="max-w-3xl text-balance font-semibold text-5xl tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="max-w-2xl text-pretty text-muted-foreground text-xl">
            {description}
          </p>
        ) : null}
        <Actions
          actions={actions}
          className={cn("pt-2", centered && "justify-center")}
        />
      </div>
    </section>
  );
}

export interface Feature {
  readonly description: string;
  readonly icon?: SiteIconName;
  readonly title: string;
}

export interface FeatureGridProps {
  readonly columns?: 2 | 3 | 4;
  readonly description?: string;
  readonly features: readonly Feature[];
  readonly id?: string;
  readonly title?: string;
  readonly tone?: "default" | "muted";
}

const COLUMNS = {
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-2 lg:grid-cols-3",
  4: "sm:grid-cols-2 lg:grid-cols-4",
} as const;

/** What it does, as a grid of short cards. */
export function FeatureGrid({
  columns = 3,
  description,
  features,
  id,
  title,
  tone,
}: FeatureGridProps) {
  return (
    <Section description={description} id={id} title={title} tone={tone}>
      <ul className={cn("grid gap-6", COLUMNS[columns] ?? COLUMNS[3])}>
        {features.map((feature) => (
          <li className="flex" key={feature.title}>
            <Card className="w-full">
              <CardHeader className="gap-3">
                {feature.icon ? (
                  <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <SiteIcon name={feature.icon} />
                  </span>
                ) : null}
                <CardTitle>
                  <h3>{feature.title}</h3>
                </CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export interface Stat {
  readonly label: string;
  /** The figure, as it should read: "12k", "99.9%", "4.8/5". */
  readonly value: string;
}

export interface StatsProps {
  readonly description?: string;
  readonly id?: string;
  readonly stats: readonly Stat[];
  readonly title?: string;
  readonly tone?: "default" | "muted";
}

/** A row of figures with what each counts. */
export function Stats({ description, id, stats, title, tone }: StatsProps) {
  return (
    <Section description={description} id={id} title={title} tone={tone}>
      <dl className="grid grid-cols-2 gap-8 text-center md:grid-cols-4">
        {stats.map((stat) => (
          <div className="flex flex-col-reverse gap-1" key={stat.label}>
            <dt className="text-muted-foreground text-sm">{stat.label}</dt>
            <dd className="font-semibold text-4xl tracking-tight">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

export interface TestimonialProps {
  readonly author: string;
  /** Who they are, like "Head of Design, Acme". */
  readonly byline?: string;
  readonly quote: string;
  readonly tone?: "default" | "muted";
}

/** One person's words, large. */
export function Testimonial({ author, byline, quote, tone }: TestimonialProps) {
  return (
    <Section tone={tone}>
      <figure className="mx-auto flex max-w-3xl flex-col gap-6 text-center">
        <blockquote className="text-balance font-medium text-2xl leading-snug">
          <p>{quote}</p>
        </blockquote>
        <figcaption className="text-sm">
          <span className="font-semibold">{author}</span>
          {byline ? (
            <span className="text-muted-foreground"> · {byline}</span>
          ) : null}
        </figcaption>
      </figure>
    </Section>
  );
}

export interface Plan {
  readonly action: SiteAction;
  /** A short tag on the card, like "Popular". */
  readonly badge?: string;
  readonly description?: string;
  readonly features: readonly string[];
  /** Drawn as the one to pick. */
  readonly highlighted?: boolean;
  readonly name: string;
  /** What it's charged per, like "/month". */
  readonly period?: string;
  /** As it should read: "$12", "Free". */
  readonly price: string;
}

export interface PricingProps {
  readonly description?: string;
  readonly id?: string;
  readonly plans: readonly Plan[];
  readonly title?: string;
  readonly tone?: "default" | "muted";
}

/** Plans side by side, each with what it includes and a way to start. */
export function Pricing({ description, id, plans, title, tone }: PricingProps) {
  return (
    <Section description={description} id={id} title={title} tone={tone}>
      <ul className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <li className="flex" key={plan.name}>
            <Card
              className={cn(
                "w-full",
                plan.highlighted && "ring-2 ring-primary"
              )}
            >
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <h3>{plan.name}</h3>
                  {plan.badge ? <Badge>{plan.badge}</Badge> : null}
                </CardTitle>
                {plan.description ? (
                  <CardDescription>{plan.description}</CardDescription>
                ) : null}
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-6">
                <p className="flex items-baseline gap-1">
                  <span className="font-semibold text-4xl tracking-tight">
                    {plan.price}
                  </span>
                  {plan.period ? (
                    <span className="text-muted-foreground">{plan.period}</span>
                  ) : null}
                </p>
                <ul className="flex flex-col gap-2">
                  {plan.features.map((feature) => (
                    <li className="flex items-start gap-2" key={feature}>
                      <SiteIcon className="size-4 text-primary" name="check" />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <ActionLink
                  action={{
                    ...plan.action,
                    variant:
                      plan.action.variant ??
                      (plan.highlighted ? "default" : "outline"),
                  }}
                  className="w-full"
                />
              </CardFooter>
            </Card>
          </li>
        ))}
      </ul>
    </Section>
  );
}

export interface FaqItem {
  readonly answer: string;
  readonly question: string;
}

export interface FaqProps {
  readonly description?: string;
  readonly id?: string;
  readonly items: readonly FaqItem[];
  readonly title?: string;
  readonly tone?: "default" | "muted";
}

/**
 * Questions that open to their answers. Native `<details>`, so they work
 * with the keyboard and need no script.
 */
export function Faq({ description, id, items, title, tone }: FaqProps) {
  return (
    <Section description={description} id={id} title={title} tone={tone}>
      <div className="mx-auto flex w-full max-w-3xl flex-col divide-y divide-border border-border border-y">
        {items.map((item) => (
          <details className="group py-4" key={item.question}>
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
              {item.question}
              <span
                aria-hidden
                className="text-muted-foreground group-open:rotate-45"
              >
                +
              </span>
            </summary>
            <p className="pt-3 text-muted-foreground">{item.answer}</p>
          </details>
        ))}
      </div>
    </Section>
  );
}

export interface CtaProps {
  readonly actions: readonly SiteAction[];
  readonly description?: string;
  readonly id?: string;
  readonly title: string;
}

/** The closing ask: a heading and one or two actions on a card. */
export function Cta({ actions, description, id, title }: CtaProps) {
  return (
    <section className="py-20" id={id}>
      <div className="mx-auto w-full max-w-6xl px-6">
        <div className="flex flex-col items-center gap-6 rounded-2xl bg-primary px-6 py-16 text-center text-primary-foreground">
          <SectionHeadingOnPrimary description={description} title={title} />
          <Actions
            actions={actions.map((action) => ({
              ...action,
              variant: action.variant ?? "secondary",
            }))}
            className="justify-center"
          />
        </div>
      </div>
    </section>
  );
}

function SectionHeadingOnPrimary({
  description,
  title,
}: {
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <div className="flex max-w-2xl flex-col gap-3">
      <h2 className="text-balance font-semibold text-3xl tracking-tight">
        {title}
      </h2>
      {description ? (
        <p className="text-lg text-primary-foreground/80">{description}</p>
      ) : null}
    </div>
  );
}
