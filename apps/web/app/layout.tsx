import { getMessages } from "@workspace/i18n/catalog";
import { LinguiClientProvider } from "@workspace/i18n/client";
import { initLingui } from "@workspace/i18n/server";

import "@workspace/ui/globals.css";
import { cn } from "@workspace/ui/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";
import { fontMono, fontSans } from "@/lib/fonts";
import { requestLocale } from "@/lib/i18n";

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
          <ThemeProvider>{children}</ThemeProvider>
        </LinguiClientProvider>
      </body>
    </html>
  );
}
