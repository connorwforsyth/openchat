import { createHook } from "node:async_hooks";

// An async hook shaped like the one React's development server renderer
// installs under `next dev` (076): for every promise and timer it reads
// `performance.now()`, holds a `WeakRef` and captures a stack through
// `Error.prepareStackTrace`. React's version lets a throw escape, which is
// fatal to Node; this one records it, so a test can see what would have
// killed the dev server.

export interface HostAsyncHook extends Disposable {
  /** The names of the errors the hook's callbacks hit. */
  readonly thrown: readonly string[];
}

export const installHostAsyncHook = (): HostAsyncHook => {
  const thrown: string[] = [];
  const refs: WeakRef<object>[] = [];
  const touch = (resource: object) => {
    try {
      performance.now();
      refs.push(new WeakRef(resource));
      const previous = Error.prepareStackTrace;
      Error.prepareStackTrace = (_error, frames) => frames;
      try {
        // biome-ignore lint/complexity/noVoid: reading `stack` runs prepareStackTrace, as React's does.
        void new Error("probe").stack;
      } finally {
        Error.prepareStackTrace = previous;
      }
    } catch (cause) {
      thrown.push(cause instanceof Error ? cause.name : String(cause));
    }
  };
  const hook = createHook({
    init: (_asyncId, _type, _triggerAsyncId, resource) => touch(resource),
  }).enable();
  return {
    [Symbol.dispose]: () => {
      hook.disable();
      refs.length = 0;
    },
    thrown,
  };
};
