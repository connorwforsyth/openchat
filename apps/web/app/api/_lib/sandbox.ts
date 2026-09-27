import type { Viewer } from "@workspace/db/queries/conversations";
import {
  createConversationSandbox,
  destroySandbox,
  execInSandbox,
  exposeSandboxPort,
  getConversationSandbox,
  listSandboxFiles,
  readSandboxFile,
  resetSandbox,
  type SandboxHandlerDeps,
} from "@workspace/sandbox/handlers/sandbox";
import { snapshotStoreOnStorage } from "@workspace/sandbox/just-bash/snapshot-store";
import { sandboxProvidersFromConfig } from "@workspace/sandbox/providers";
import type { SandboxBinding } from "@workspace/server/server";

// The sandbox handlers bound to this instance's providers (019). It lives
// here, in the shell, because `@workspace/sandbox` depends on
// `@workspace/server` (for its Storage and JobQueue ports), so the server
// can't import it. just-bash always runs (its workspaces persist in the
// file store); Docker joins when `sandbox.docker.runnerUrl` is configured.

export const bindSandbox: SandboxBinding = ({ config, db, storage }) => {
  const providers = sandboxProvidersFromConfig(config, {
    store: snapshotStoreOnStorage(storage),
  });
  const configured = config.sandbox.default;
  const defaultProvider =
    configured !== "none" && providers.has(configured) ? configured : null;
  const deps = (session: Viewer): SandboxHandlerDeps => ({
    db,
    defaultProvider,
    providers,
    session,
  });
  return {
    create: (viewer, input) => createConversationSandbox(deps(viewer), input),
    destroy: (viewer, input) => destroySandbox(deps(viewer), input),
    exec: (viewer, input) => execInSandbox(deps(viewer), input),
    exposePort: (viewer, input) => exposeSandboxPort(deps(viewer), input),
    get: (viewer, input) => getConversationSandbox(deps(viewer), input),
    listFiles: (viewer, input) => listSandboxFiles(deps(viewer), input),
    readFile: (viewer, input) => readSandboxFile(deps(viewer), input),
    reset: (viewer, input) => resetSandbox(deps(viewer), input),
  };
};
