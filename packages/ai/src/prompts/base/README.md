# Base layers

`NN-name.md` files in this folder go to every turn, in filename order, ahead of
an agent's own instructions.

All five are empty on purpose. Until ticket 079 there was no identity, safety,
tool-etiquette, workspace or formatting text in any prompt, and that ticket
moved prompts into files without changing them. An empty file composes to
nothing, so these are the places to write that text when someone decides what
it should say; they add no bytes to a prompt until then.

`40-workspace.md` is for workspace guidance that every turn should get. What a
plain chat is told about its workspace today is conditional (only when the chat
has one, and not for agents), so it lives in `../fragments/workspace.md`.

`../fragments/artifacts.md` is empty for the same reason: nothing produces
artifacts at run time yet.
