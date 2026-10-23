import type { Viewer } from "@workspace/db/queries/conversations";
import { createComputers } from "@workspace/sandbox/computer/computer";
import { createDockerSandboxFactory } from "@workspace/sandbox/docker/client";
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
import { createTurnSandboxSource } from "@workspace/sandbox/handlers/turn-tools";
import {
  deleteWorkspaceFile,
  importWorkspaceFile,
  writeWorkspaceFile,
} from "@workspace/sandbox/handlers/workspace-files";
import { snapshotStoreOnStorage } from "@workspace/sandbox/just-bash/snapshot-store";
import { sandboxProvidersFromConfig } from "@workspace/sandbox/providers";
import { egressPolicyFor } from "@workspace/sandbox/runner/egress";
import type { BoundSandbox, SandboxBinding } from "@workspace/server/server";

// The sandbox handlers and the agents' sandbox tools, bound to this
// instance's providers (019, 041). It lives here, in the shell, because
// `@workspace/sandbox` depends on `@workspace/server` (for its Storage and
// JobQueue ports), so the server can't import it. Both share one set of
// providers, so the panel shows what the agent did. just-bash always runs
// (its workspaces persist in the file store); Docker joins when
// `sandbox.docker.runnerUrl` is configured. Imports read uploads from the
// same file store, capped by `limits.uploadMaxMb`.

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
  const api: BoundSandbox["api"] = {
    create: (viewer, input) => createConversationSandbox(deps(viewer), input),
    deleteFile: (viewer, input) => deleteWorkspaceFile(deps(viewer), input),
    destroy: (viewer, input) => destroySandbox(deps(viewer), input),
    exec: (viewer, input) => execInSandbox(deps(viewer), input),
    exposePort: (viewer, input) => exposeSandboxPort(deps(viewer), input),
    get: (viewer, input) => getConversationSandbox(deps(viewer), input),
    importFile: (viewer, input) =>
      importWorkspaceFile(
        {
          ...deps(viewer),
          storage,
          uploadMaxMb: config.limits.uploadMaxMb,
        },
        input
      ),
    listFiles: (viewer, input) => listSandboxFiles(deps(viewer), input),
    readFile: (viewer, input) => readSandboxFile(deps(viewer), input),
    reset: (viewer, input) => resetSandbox(deps(viewer), input),
    writeFile: (viewer, input) => writeWorkspaceFile(deps(viewer), input),
  };
  // A Dot's computer (172) is a desktop sandbox on the same runner, so it
  // exists only where Docker sandboxes are configured.
  const { docker } = config.sandbox;
  const computers =
    config.features.sandboxes && docker
      ? createComputers({
          host: createDockerSandboxFactory({
            egress: egressPolicyFor(config.sandbox.egress),
            runnerUrl: docker.runnerUrl,
            token: docker.token,
          }),
        })
      : undefined;
  return {
    api,
    computers,
    turnTools: createTurnSandboxSource({ db, defaultProvider, providers }),
  };
};
