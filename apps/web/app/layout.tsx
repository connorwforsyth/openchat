import { getMessages } from "@workspace/i18n/catalog";
import { LinguiClientProvider } from "@workspace/i18n/client";
import { initLingui } from "@workspace/i18n/server";
import type { Metadata, Viewport } from "next";

import "@workspace/ui/globals.css";
import { cn } from "@workspace/ui/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { fontMono, fontSans } from "@/lib/fonts";
import { requestLocale } from "@/lib/i18n";
import { getPublicConfig } from "@/lib/public-config";

export const viewport: Viewport = {
  initialScale: 1,
  // Android's keyboard shrinks the layout viewport instead of covering it, so
  // the docked composer stays above the keyboard (031, Q40).
  interactiveWidget: "resizes-content",
  width: "device-width",
};

// The name comes from `brand:` in app.config.yaml (D18), never a literal.
export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublicConfig();
  return config.ok ? { title: config.config.brand.name } : {};
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await requestLocale();
  initLingui(locale);

  return (
    <html
      className={cn(
        "antialiased",
        fontMono.variable,
        "font-sans",
        fontSans.variable
      )}
      lang={locale}
      suppressHydrationWarning
    >
      <body>
        <LinguiClientProvider locale={locale} messages={getMessages(locale)}>
          {/* next-themes applies the saved theme with an inline script before
              paint (D27); the app shell adds its own for the sidebar. */}
          <ThemeProvider>{children}</ThemeProvider>
        </LinguiClientProvider>
      </body>
    </html>
  );
}
