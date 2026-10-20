# Accounts

On a server with no users, the first person to sign up becomes its
administrator. A signed-out visitor is sent to sign in, and a signed-in user
can sign out and back in from the account menu.

## Sub-features

- `accounts-redirect`: a signed-out visit to `/` lands on `/sign-in`.
- `accounts-first-admin`: the first sign-up is the instance admin.
- `accounts-sign-out`: the account menu signs out and returns to sign-in.
- `accounts-sign-in`: email and password sign back in to the chat home.

## How to get to it (user POV)

- Open `/` while signed out, which redirects to `/sign-in`.
- Open `/sign-up` and fill Name, Email and Password, then `Create account`.
- Open the `Account: <name>` button at the foot of the rail (the panel's
  foot in the Classic layout), then `Sign out`.

## Driving it with verify-web

Preconditions:

- A freshly launched instance with no users. This journey only works once
  per instance.

- **Redirect.** Open `/` signed out. Run `scripts/journey.sh` on a fresh
  instance (accounts runs first). The URL matches `/sign-in`. Proof:
  `accounts/01-signed-out-redirect`.
- **First sign-up.** On `/sign-up`, the text `The first account on a new
  server becomes its administrator` shows. Fill `Name`, `Email` and
  `Password` (by label) and choose `Create account`. The URL is `/` and the
  `Message` textbox is visible. The read-back `me.get()` reports
  `isAdmin: true`. Proof: `accounts/02-signed-up-home.{png,aria.txt,json}`.
- **Sign out.** Choose `Account: Ada Admin`, then the `Sign out` menu item.
  The URL is `/sign-in`. Proof: `accounts/03-signed-out`.
- **Sign in.** Fill `Email` and `Password` and choose `Sign in`. The auth
  POST answers 200 and the `Message` textbox is visible. Proof:
  `accounts/04-signed-in-again`.

## Gotchas

- Sign-in and sign-up are rate limited to 3 per 10 s per address. The
  `signIn` and `signUp` helpers wait out a 429. Don't hammer the form in a
  loop.
- Server-rendered forms show before React hydrates them, and a click before
  hydration does a plain GET. Use `hydrated()` or `clickHydrated()` from
  `e2e/support/hydration.ts`.
- A second sign-up on the same instance is not the first, so it won't be an
  admin, and in invite mode (`auth: { signup: invite }`) it is refused.
  Relaunch to retest `accounts-first-admin`.
- Sign-in trusts `localhost`, `127.0.0.1` and `[::1]` on the same port, and
  no other host names.
