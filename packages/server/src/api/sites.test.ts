import { call } from "@orpc/server";
import { builtinArtifactKinds } from "@workspace/artifacts-kit/builtin";
import { instanceArtifactKinds } from "@workspace/artifacts-kit/instance";
import type { SandboxId, UserId } from "@workspace/contract/schemas/common";
import type { FileEntry } from "@workspace/contract/schemas/sandbox";
import type { Db } from "@workspace/db/client";
import { saveArtifactVersion } from "@workspace/db/queries/artifacts";
import { createConversation } from "@workspace/db/queries/conversations";
import { insertMessage } from "@workspace/db/queries/messages";
import {
  createTestDb,
  expectOk,
  seedOrg,
  seedUser,
  type TestDb,
} from "@workspace/db/testing";
import { err, ok } from "@workspace/shared/result";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantAccess } from "../context";
import { createArtifactsRouter } from "./artifacts";
import { disabledSandboxApi } from "./sandbox";
import { folderFiles, type SitesDeps, siteContentFrom } from "./sites";

// Sites (125): publishing a site to a link on the runtime's origin, what
// the link serves, and saving a workspace folder as a site.

let t: TestDb;
let db: Db;
beforeAll(async () => {
  t = await createTestDb();
  ({ db } = t);
});
afterAll(() => t.close());

const as = (userId: UserId | null) => ({
  context: {
    request: new Request("http://x"),
    session: userId ? { userId } : null,
  },
});

const RUNTIME = "https://artifacts.example";
const page = (body: string) =>
  `<!doctype html><html><head></head><body>${body}</body></html>`;
const SITE = JSON.stringify({ files: { "index.html": page("<h1>Hi</h1>") } });

/** A workspace with these files under /work, as a listing gives them. */
const workspaceWith = (
  files: Readonly<Record<string, string | Uint8Array>>
): SitesDeps["workspace"] => {
  const id = "00000000-0000-4000-8000-0000000000aa" as SandboxId;
  const entries: FileEntry[] = Object.keys(files).map((path) => ({
    modifiedAt: null,
    path: `/work/${path}`,
    size: 1,
    type: "file",
  }));
  return {
    get: () =>
      Promise.resolve(
        ok({
          conversationId: null,
          createdAt: new Date().toISOString(),
          id,
          provider: "just-bash",
          status: "running",
        } as never)
      ),
    listFiles: (_viewer, input) => {
      const prefix = `/work/${input.path === "." ? "" : `${input.path}/`}`;
      const inside = entries.filter((entry) => entry.path.startsWith(prefix));
      return Promise.resolve(
        inside.length > 0 ? ok(inside) : err({ type: "not_found" })
      );
    },
    readFile: (_viewer, input) => {
      const content = files[input.path.replace("/work/", "")];
      return Promise.resolve(
        content === undefined
          ? err({ type: "not_found" })
          : ok({
              content:
                typeof content === "string"
                  ? content
                  : Buffer.from(content).toString("base64"),
              encoding: typeof content === "string" ? "utf8" : "base64",
              path: input.path,
              size: content.length,
            })
      );
    },
  };
};

const sites = (overrides: Partial<SitesDeps> = {}): SitesDeps => ({
  kinds: builtinArtifactKinds,
  publicLinks: true,
  runtimeOrigin: RUNTIME,
  workspace: disabledSandboxApi,
  ...overrides,
});

const seed = async (content = SITE, kind: "site" | "html" = "site") => {
  const owner = await seedUser(db);
  const other = await seedUser(db);
  const personal = await seedOrg(db, owner.id, { isPersonal: true });
  const chat = await createConversation(db, {
    context: { id: personal.id, type: "personal" },
    ownerId: owner.id,
  });
  const message = expectOk(
    await insertMessage(db, {
      authorId: null,
      conversationId: chat.id,
      parentId: null,
      parts: [{ text: "Here you go", type: "text" }],
      role: "assistant",
    })
  );
  const saved = expectOk(
    await saveArtifactVersion(db, {
      content,
      conversationId: chat.id,
      kind,
      messageId: message.id,
      title: "Harbour",
    })
  );
  return { chat, message, other, owner, saved };
};

describe("publishing a site", () => {
  it("gives the owner a link on the runtime's origin that serves the latest version", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
      sites: sites(),
    });
    const { owner, saved } = await seed();
    const { id } = saved.artifact;
    expect(await call(artifacts.publication, { id }, as(owner.id))).toBeNull();
    const published = await call(artifacts.publish, { id }, as(owner.id));
    expect(published).toMatchObject({
      artifactId: id,
      publishedBy: owner.id,
      url: `${RUNTIME}/s/${published.token}/`,
      versionId: saved.version.id,
    });
    expect(published.token.length).toBeGreaterThanOrEqual(43);
    expect(await call(artifacts.publication, { id }, as(owner.id))).toEqual(
      published
    );
    // Anyone with the token, signed in or not.
    expect(
      await call(artifacts.published, { token: published.token }, as(null))
    ).toEqual({
      content: SITE,
      kind: "site",
      publishedAt: published.publishedAt,
      title: "Harbour",
    });
    // Publishing again keeps the link.
    const again = await call(artifacts.publish, { id }, as(owner.id));
    expect(again.token).toBe(published.token);

    await call(artifacts.unpublish, { id }, as(owner.id));
    await expect(
      call(artifacts.published, { token: published.token }, as(null))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await call(artifacts.publication, { id }, as(owner.id))).toBeNull();
  });

  it("is for the owner, for sites, and checks them again first", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
      sites: sites({
        // The instance narrowed its origins since the site was saved.
        kinds: instanceArtifactKinds({
          site: { allowedOrigins: [], enabled: true, stack: "html-tailwind" },
        }),
      }),
    });
    const { other, saved } = await seed();
    await expect(
      call(artifacts.publish, { id: saved.artifact.id }, as(other.id))
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const html = await seed("<p>hi</p>", "html");
    await expect(
      call(artifacts.publish, { id: html.saved.artifact.id }, as(html.owner.id))
    ).rejects.toMatchObject({
      code: "VALIDATION",
      data: { issues: [{ message: "Only sites can be published." }] },
    });

    const fonts = await seed(
      JSON.stringify({
        files: {
          "index.html": page(
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2">'
          ),
        },
      })
    );
    await expect(
      call(
        artifacts.publish,
        { id: fonts.saved.artifact.id },
        as(fonts.owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("is off without public links or a runtime", async () => {
    const { owner, saved } = await seed();
    for (const deps of [
      sites({ publicLinks: false }),
      sites({ runtimeOrigin: null }),
      undefined,
    ]) {
      const { artifacts } = createArtifactsRouter({
        access: grantAccess(db),
        db,
        sites: deps,
      });
      // biome-ignore lint/performance/noAwaitInLoops: one router at a time.
      await expect(
        call(artifacts.publish, { id: saved.artifact.id }, as(owner.id))
      ).rejects.toMatchObject({
        code: "FEATURE_DISABLED",
        data: { feature: "publicLinks" },
      });
    }
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
      sites: sites({ publicLinks: false }),
    });
    await expect(
      call(artifacts.published, { token: "x".repeat(43) }, as(null))
    ).rejects.toMatchObject({ code: "FEATURE_DISABLED" });
  });
});

describe("saving a workspace folder as a site", () => {
  const files = {
    "notes.md": "not part of it",
    "site/.DS_Store": "hidden",
    "site/about.html": page('<a href="index.html">Home</a>'),
    "site/css/site.css": "h1 { margin: 0; }",
    "site/index.html": page(
      '<link rel="stylesheet" href="css/site.css"><a href="about.html">About</a>'
    ),
  };

  it("makes a site the caller owns from the folder's files, if they pass the checks", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
      sites: sites({ workspace: workspaceWith(files) }),
    });
    const { chat, message, owner } = await seed();
    const saved = await call(
      artifacts.saveFromWorkspace,
      { conversationId: chat.id, kind: "site", path: "site", title: "Harbour" },
      as(owner.id)
    );
    expect(saved).toMatchObject({
      conversationId: chat.id,
      kind: "site",
      messageId: message.id,
      ownerId: owner.id,
      title: "Harbour",
    });
    const version = await call(
      artifacts.getVersion,
      { id: saved.id, versionId: saved.latestVersionId ?? ("" as never) },
      as(owner.id)
    );
    expect(JSON.parse(version.content)).toEqual({
      files: {
        "about.html": files["site/about.html"],
        "css/site.css": files["site/css/site.css"],
        "index.html": files["site/index.html"],
      },
      stack: "html-tailwind",
    });
  });

  it("says what fails the checks, and saves nothing", async () => {
    const { artifacts } = createArtifactsRouter({
      access: grantAccess(db),
      db,
      sites: sites({
        workspace: workspaceWith({
          ...files,
          "app/logo.png": new Uint8Array([1, 2, 3]),
          "app/main.tsx": "export default 1",
        }),
      }),
    });
    const { chat, other, owner } = await seed();
    await expect(
      call(
        artifacts.saveFromWorkspace,
        { conversationId: chat.id, kind: "site", path: "app", title: "App" },
        as(owner.id)
      )
    ).rejects.toMatchObject({
      code: "VALIDATION",
      data: {
        issues: [
          { message: "logo.png isn't a text file; sites hold text files only" },
        ],
      },
    });
    await expect(
      call(
        artifacts.saveFromWorkspace,
        { conversationId: chat.id, kind: "site", path: ".", title: "All" },
        as(owner.id)
      )
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      call(
        artifacts.saveFromWorkspace,
        { conversationId: chat.id, kind: "site", path: "site", title: "X" },
        as(other.id)
      )
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reads folders by the paths a listing gives", () => {
    const entry = (path: string, type: FileEntry["type"] = "file") => ({
      modifiedAt: null,
      path,
      size: null,
      type,
    });
    expect(
      folderFiles([
        entry("/work/site/css", "directory"),
        entry("/work/site/css/a.css"),
        entry("/work/site/index.html"),
        entry("/work/site/.git/HEAD"),
      ])
    ).toEqual([
      { path: "/work/site/css/a.css", relative: "css/a.css" },
      { path: "/work/site/index.html", relative: "index.html" },
    ]);
    expect(folderFiles([])).toEqual([]);
    expect(
      JSON.parse(siteContentFrom([{ relative: "index.html", text: "<p>" }]))
    ).toEqual({
      files: { "index.html": "<p>" },
      stack: "html-tailwind",
    });
  });
});
