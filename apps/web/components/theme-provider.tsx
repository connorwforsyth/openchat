"use client";

import { isTypingEvent } from "@workspace/chat-ui/shortcuts/registry";
import { ThemeProvider as NextThemesProvider, useTheme } from "next-themes";
import { type ComponentProps, useEffect } from "react";

function ThemeProvider({
  children,
  ...props
}: ComponentProps<typeof NextThemesProvider>) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      disableTransitionOnChange
      enableSystem
      {...props}
    >
      <ThemeHotkey />
      {children}
    </NextThemesProvider>
  );
}

function ThemeHotkey() {
  const { resolvedTheme, setTheme } = useTheme();

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.defaultPrevented || event.repeat || event.isComposing) {
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }

      if (event.key.toLowerCase() !== "d") {
        return;
      }

      // Through shadow roots: typing "d" in the Workspace editor (whose
      // host is all `event.target` shows) used to flip the theme (070).
      if (isTypingEvent(event)) {
        return;
      }

      setTheme(resolvedTheme === "dark" ? "light" : "dark");
    }

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [resolvedTheme, setTheme]);

  return null;
}

export { ThemeProvider };
