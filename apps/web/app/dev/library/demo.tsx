"use client";

import { Trans } from "@lingui/react/macro";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FileId, LibraryItemId } from "@workspace/contract/schemas/common";
import type {
  LibraryItem,
  LibraryItemDetail,
  LibraryKind,
} from "@workspace/contract/schemas/library";
import { LibraryClientProvider } from "@workspace/library-ui/client";
import {
  type BuilderTarget,
  ItemBuilder,
} from "@workspace/library-ui/components/item-builder";
import {
  LibraryIndex,
  type LinkComponent,
} from "@workspace/library-ui/components/library-index";
import { EchoTestChat } from "@workspace/library-ui/testing/echo-test-chat";
import { createFakeLibraryClient } from "@workspace/library-ui/testing/fake-client";
import {
  type ChangeEvent,
  createContext,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useContext,
  useState,
} from "react";

// The library over the fake API, with navigation kept in state: links carry
// a `#` href and a click switches the view, so the demo runs without routes.

type View = { readonly type: "index" } | BuilderTarget;

const Navigate = createContext<(view: View) => void>(() => undefined);

const viewOf = (href: string): View => {
  const [, kind, value] = href.split(":");
  if (kind === "new" && value) {
    return { kind: value as LibraryKind, type: "new" };
  }
  if (kind === "item" && value) {
    return { id: value as LibraryItemId, type: "existing" };
  }
  return { type: "index" };
};

const DemoLink: LinkComponent = ({ children, className, href }) => {
  const navigate = useContext(Navigate);
  const go = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      navigate(viewOf(href));
    },
    [href, navigate]
  );
  return (
    <a className={className} href={`#${href}`} onClick={go}>
      {children}
    </a>
  );
};

const itemHref = (item: LibraryItem) => `library:item:${item.id}`;
const newHref = (kind: LibraryKind) => `library:new:${kind}`;
const INDEX_HREF = "library:index";

// Skill files in the fixtures are text the demo makes up on request.
const loadFile = (fileId: FileId) =>
  Promise.resolve(`# ${fileId}\n\necho "a bundled file"\n`);

export function LibraryDemo() {
  const [client] = useState(() => createFakeLibraryClient());
  const [queryClient] = useState(() => new QueryClient());
  const [view, setView] = useState<View>({ type: "index" });
  const [refuse, setRefuse] = useState(false);

  const toggleRefuse = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const on = event.currentTarget.checked;
      setRefuse(on);
      if (on) {
        client.failNext("library.update");
        client.failNext("grants.create");
      }
    },
    [client]
  );
  const openItem = useCallback(
    (item: LibraryItem | LibraryItemDetail) =>
      setView({ id: item.id, type: "existing" }),
    []
  );
  const backToIndex = useCallback(() => setView({ type: "index" }), []);

  let screen: ReactNode;
  if (view.type === "index") {
    screen = (
      <LibraryIndex
        itemHref={itemHref}
        link={DemoLink}
        newHref={newHref}
        onImported={openItem}
      />
    );
  } else {
    screen = (
      <ItemBuilder
        backHref={INDEX_HREF}
        key={view.type === "existing" ? view.id : view.kind}
        link={DemoLink}
        onCreated={openItem}
        onDeleted={backToIndex}
        onDuplicated={openItem}
        skill={{ loadFile }}
        target={view}
        testChat={EchoTestChat}
      />
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <LibraryClientProvider client={client}>
        <Navigate.Provider value={setView}>
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={refuse}
              className="size-4 accent-primary"
              onChange={toggleRefuse}
              type="checkbox"
            />
            <Trans>Refuse the next save and share</Trans>
          </label>
          {screen}
        </Navigate.Provider>
      </LibraryClientProvider>
    </QueryClientProvider>
  );
}
