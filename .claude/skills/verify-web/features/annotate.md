# Annotate

One pointer for notes on any artifact (night 2, decision 5). The Annotate
button in an artifact's header (or M) turns it on; a click drops a pin and a
drag marks a box; each mark takes a note, and the note's first line says
what the layer read under it (a passage, an element, a slide, cells, a node,
part of an image). Drafts stay in the browser, so a reload and a second tab
keep them. Send notes starts the next turn; while an answer is written the
button reads Steer with notes. On the artifact's own page, Send in chat opens
the chat, where the drafts wait.

Journey: `journeys/annotate.journey.ts`. It makes one artifact of each
default kind with the mock model and pins a note on it. html, react and code
are off by default (`artifacts.kinds`), so they aren't made here; they render
through the same runtime paths as sites and SVG.
