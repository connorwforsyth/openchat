# Questions for Connor

Collected by agents working the map, so you can answer them in one sitting. Each links to its ticket. Answer inline and the loop picks the answers up.

## Waiting on you now

1. **App shell prototype ([009](tickets/009-prototype-app-shell.md)):** run `/wayfinder` on this ticket whenever you like; it doesn't need the scaffold.
2. **Agent Builder prototype ([010](tickets/010-prototype-agent-builder.md)):** same.
3. **Theme preset (002):** the scaffold uses shadcn's default preset. When you've picked one on ui.shadcn.com/create, paste the preset code here and the loop runs `shadcn apply`.

## From the loop

4. **Offline builds (002):** `next/font/google` downloads the Geist fonts at build time, so builds fail offline or in locked-down CI. Switch to the `geist` npm package (self-hosted fonts)? *Loop default if unanswered: yes, being done inside ticket 006.*
5. **Node version (002):** `engines` says Node `>=22` (this Mac has 22; CI and the containers use 24). OK? *Default: keep.*
6. **SearXNG image (002):** the compose file uses `searxng/searxng:latest`. Pin a version? *Default: pin to the current release when 021 (web search) lands.*
