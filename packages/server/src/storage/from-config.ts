import { randomBytes } from "node:crypto";

import type { AppConfig } from "@workspace/config/schema";
import { err } from "@workspace/shared/result";

import type { Storage, StorageError } from "../ports/storage";
import { createLocalStorage } from "./local";
import { createS3Storage, type FetchFunction } from "./s3";

// The Storage app.config.yaml `storage` asks for (D18, D24). A local volume
// always works; S3 needs credentials, from the YAML (usually `${ENV}`) or
// the standard AWS variables. Without them the store answers every call
// with `unavailable`, so uploads fail with a clear reason and the rest of
// the app boots and runs.

export type Env = Readonly<Record<string, string | undefined>>;

export interface ConfiguredStorage {
  /** What to record on `file.storage_driver`. */
  readonly driver: "local" | "s3";
  /** Why it can't work, when it can't; `null` when it's ready. */
  readonly problem: string | null;
  /** The local driver's URL signing secret, for the serving route; `null` for S3. */
  readonly signingSecret: string | null;
  readonly storage: Storage;
}

export interface CreateStorageOptions {
  /** Where local signed URLs point (the route that serves objects), absolute. */
  readonly baseUrl: string;
  readonly env?: Env;
  readonly fetch?: FetchFunction;
  readonly now?: () => Date;
  /**
   * A stable secret for local signed URLs, so links survive a restart.
   * Without one, a random per-process secret is used: links then die with
   * the process, which only shortens their already short life.
   */
  readonly signingSecret?: string;
}

const fromEnv = (env: Env, ...names: string[]): string | undefined => {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
};

/** A store that can't store anything, and says why. */
export const createUnavailableStorage = (message: string): Storage => {
  const no = () =>
    Promise.resolve(err<StorageError>({ message, type: "unavailable" }));
  return { delete: no, get: no, put: no, signedUrl: no, stat: no };
};

export const createStorage = (
  config: Pick<AppConfig, "storage">,
  {
    baseUrl,
    env = process.env,
    fetch,
    now,
    signingSecret,
  }: CreateStorageOptions
): ConfiguredStorage => {
  const { storage } = config;
  switch (storage.driver) {
    case "local": {
      const secret = signingSecret ?? randomBytes(32).toString("base64url");
      return {
        driver: "local",
        problem: null,
        signingSecret: secret,
        storage: createLocalStorage({
          baseUrl,
          now,
          root: storage.path,
          signingSecret: secret,
        }),
      };
    }
    case "s3": {
      const accessKeyId =
        storage.accessKeyId ??
        fromEnv(env, "S3_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
      const secretAccessKey =
        storage.secretAccessKey ??
        fromEnv(env, "S3_SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
      const problem = (message: string): ConfiguredStorage => ({
        driver: "s3",
        problem: message,
        signingSecret: null,
        storage: createUnavailableStorage(message),
      });
      if (!(accessKeyId && secretAccessKey)) {
        return problem(
          "S3 storage has no credentials (storage.accessKeyId/secretAccessKey or S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY)"
        );
      }
      if (!storage.endpoint && storage.region === "auto") {
        return problem(
          "S3 storage with `region: auto` (R2) needs an `endpoint`"
        );
      }
      return {
        driver: "s3",
        problem: null,
        signingSecret: null,
        storage: createS3Storage({
          accessKeyId,
          bucket: storage.bucket,
          endpoint: storage.endpoint ?? null,
          fetch,
          forcePathStyle: storage.forcePathStyle,
          now,
          region: storage.region,
          secretAccessKey,
        }),
      };
    }
    default:
      return storage satisfies never;
  }
};
