import type { CompileTailwind } from "@workspace/artifacts-kit/kinds/site/build";
import { compile } from "tailwindcss";

// Tailwind's own compiler, as the Site kind's build port (125). The same
// code runs in the preview page and on the server that serves published
// sites. It's given Tailwind's stylesheet as text, so it reads no files
// and fetches nothing: a site's only import is `tailwindcss`.

export const tailwindCompiler =
  (tailwindCss: string): CompileTailwind =>
  async (input, candidates) => {
    const compiler = await compile(input, {
      base: "/",
      loadStylesheet: (id, base) =>
        id === "tailwindcss"
          ? Promise.resolve({
              base,
              content: tailwindCss,
              path: "tailwindcss/index.css",
            })
          : Promise.reject(new Error(`a site's styles can't import "${id}"`)),
    });
    return compiler.build([...candidates]);
  };
