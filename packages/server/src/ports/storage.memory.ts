import { err, ok } from "@workspace/shared/result";

import {
  type Storage,
  type StorageBody,
  type StoredObject,
  storageKeySchema,
} from "./storage";

// In-memory Storage for tests. Bytes live in a Map; signed URLs use a
// `memory:` scheme so nothing can mistake them for real ones.

const readAll = async (body: StorageBody): Promise<Uint8Array> =>
  body instanceof Uint8Array
    ? body.slice()
    : new Uint8Array(await new Response(body).arrayBuffer());

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice());
      controller.close();
    },
  });

export const createMemoryStorage = ({
  now = () => new Date(),
}: {
  readonly now?: () => Date;
} = {}): Storage => {
  const objects = new Map<
    string,
    { bytes: Uint8Array; object: StoredObject }
  >();
  let version = 0;

  const validKey = (key: string) => storageKeySchema.safeParse(key).success;

  return {
    delete: (key) => {
      if (!validKey(key)) {
        return Promise.resolve(err({ key, type: "invalid_key" as const }));
      }
      objects.delete(key);
      return Promise.resolve(ok(undefined));
    },

    get: (key) => {
      const found = objects.get(key);
      return Promise.resolve(
        found
          ? ok({ body: streamOf(found.bytes), object: found.object })
          : err({ key, type: "not_found" as const })
      );
    },

    put: async (key, body, { contentType }) => {
      if (!validKey(key)) {
        return err({ key, type: "invalid_key" as const });
      }
      const bytes = await readAll(body);
      version += 1;
      const object: StoredObject = {
        contentType,
        etag: `"${version}"`,
        key,
        size: bytes.length,
        updatedAt: now().toISOString(),
      };
      objects.set(key, { bytes, object });
      return ok(object);
    },

    signedUrl: (key, { expiresInSeconds, method }) => {
      if (!validKey(key)) {
        return Promise.resolve(err({ key, type: "invalid_key" as const }));
      }
      if (method === "GET" && !objects.has(key)) {
        return Promise.resolve(err({ key, type: "not_found" as const }));
      }
      const expiresAt = new Date(
        now().getTime() + expiresInSeconds * 1000
      ).toISOString();
      const query = new URLSearchParams({ expires: expiresAt, method });
      return Promise.resolve(
        ok({ expiresAt, url: `memory://storage/${encodeURI(key)}?${query}` })
      );
    },

    stat: (key) => {
      const found = objects.get(key);
      return Promise.resolve(
        found ? ok(found.object) : err({ key, type: "not_found" as const })
      );
    },
  };
};
