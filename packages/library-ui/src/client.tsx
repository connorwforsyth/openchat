"use client";

import type {
  InferContractRouterInputs,
  InferContractRouterOutputs,
} from "@orpc/contract";
import type { Contract } from "@workspace/contract/contract";
import { createContext, type ReactNode, useContext } from "react";

// The slice of the API the library screens call, as plain functions. The
// real `ApiClient` from `@workspace/client/api` satisfies it, and so does the
// in-memory fake the demo and tests use (`fake-client`), which keeps every
// screen on one code path whichever is behind it.

type Inputs = InferContractRouterInputs<Contract>;
type Outputs = InferContractRouterOutputs<Contract>;

type Call<G extends keyof Contract, P extends keyof Contract[G]> = (
  input: Inputs[G][P & keyof Inputs[G]]
) => Promise<Outputs[G][P & keyof Outputs[G]]>;

type Group<G extends keyof Contract, P extends keyof Contract[G]> = {
  readonly [K in P]: Call<G, K>;
};

export interface LibraryClient {
  readonly grants: Group<"grants", "create" | "list" | "revoke" | "update">;
  readonly library: Group<
    "library",
    | "create"
    | "delete"
    | "duplicate"
    | "export"
    | "get"
    | "getVersion"
    | "import"
    | "list"
    | "listVersions"
    | "publishToLibrary"
    | "publishVersion"
    | "restoreVersion"
    | "update"
  >;
  readonly mcp: Group<"mcp", "disconnect" | "startOAuth" | "status">;
  readonly me: { readonly get: () => Promise<Outputs["me"]["get"]> };
  readonly meta: {
    readonly config: () => Promise<Outputs["meta"]["config"]>;
    readonly models: Call<"meta", "models">;
  };
  readonly orgs: Group<"orgs", "members">;
  readonly shareLinks: Group<"shareLinks", "create" | "list" | "revoke">;
}

const LibraryClientContext = createContext<LibraryClient | null>(null);

export function LibraryClientProvider({
  children,
  client,
}: {
  readonly children: ReactNode;
  readonly client: LibraryClient;
}) {
  return (
    <LibraryClientContext.Provider value={client}>
      {children}
    </LibraryClientContext.Provider>
  );
}

export const useLibraryClient = (): LibraryClient => {
  const client = useContext(LibraryClientContext);
  if (!client) {
    throw new Error("useLibraryClient needs a <LibraryClientProvider>");
  }
  return client;
};
