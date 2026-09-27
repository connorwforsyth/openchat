import { randomBytes } from "node:crypto";

import { z } from "zod";

// A smoke test of a running Docker stack (docs/self-hosting.md): the image
// boots, migrates Postgres, signs a first user up as the admin, serves pages
// that ask the API over loopback, and writes to the database. Run it against
// a throwaway stack, since it creates that first user:
//
//   docker compose -p smoke up -d --build --wait
//   E2E_BASE_URL=http://localhost:3000 bun e2e/support/compose-smoke.ts
//   docker compose -p smoke down -v

const base = (process.env.E2E_BASE_URL ?? "http://localhost:3000").replace(
  /\/$/,
  ""
);

const meSchema = z.object({ user: z.object({ isAdmin: z.boolean() }) });
const conversationSchema = z.object({ id: z.string() });

const check = (ok: boolean, what: string, why = "") => {
  if (!ok) {
    throw new Error(why ? `${what}: ${why}` : what);
  }
  console.log(`ok  ${what}`);
};

const waitForBoot = async () => {
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    // biome-ignore lint/performance/noAwaitInLoops: polling until it's up.
    const answer = await fetch(`${base}/api/config`).catch(() => null);
    if (answer?.ok) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 2000);
    });
  }
  throw new Error(`${base}/api/config never answered 200`);
};

const main = async () => {
  await waitForBoot();
  check(true, "the API answers /api/config");

  // A throwaway account on a throwaway stack; the password isn't printed.
  const account = {
    email: `smoke-${randomBytes(4).toString("hex")}@example.test`,
    name: "Smoke Test",
    password: randomBytes(18).toString("base64url"),
  };
  const signUp = await fetch(`${base}/api/auth/sign-up/email`, {
    body: JSON.stringify(account),
    headers: { "content-type": "application/json", origin: base },
    method: "POST",
  });
  check(
    signUp.ok,
    "the first sign-up is accepted",
    `got ${signUp.status}; a stack that already has users refuses it, so use a fresh one`
  );
  const cookie = signUp.headers
    .getSetCookie()
    .map((each) => each.split(";")[0])
    .join("; ");
  check(cookie.includes("session_token"), "sign-up starts a session");

  const me = meSchema.parse(
    await (await fetch(`${base}/api/me`, { headers: { cookie } })).json()
  );
  check(me.user.isAdmin, "the first account is the admin");

  const created = await fetch(`${base}/api/conversations`, {
    body: "{}",
    headers: { "content-type": "application/json", cookie, origin: base },
    method: "POST",
  });
  check(created.status === 201, "a chat is stored in the database");
  const chat = conversationSchema.parse(await created.json());

  const page = await fetch(`${base}/c/${chat.id}`, { headers: { cookie } });
  check(
    page.status === 200,
    "a signed-in page renders (the loopback to the API works)"
  );
  const signIn = await fetch(`${base}/sign-in`);
  check(signIn.status === 200, "the sign-in page renders");
};

main().catch((cause: unknown) => {
  console.error(`FAIL ${cause instanceof Error ? cause.message : cause}`);
  process.exit(1);
});
