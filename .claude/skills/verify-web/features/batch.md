# Sending while the agent works

Connor's model (after ChatGPT): a message sent while an answer is being
written goes into the thread at once, and quick messages get one answer.
The server picks how: an answer that has only thought or written so far
restarts with every message; one that has started tool work takes them at
its next step boundary; a message after the last boundary runs next, with
any sent alongside it. Stop is still the hard interrupt.

Journey: `journeys/batch.journey.ts` (video on). The mock echoes every user
message since anything else spoke, so one answer visibly covers the batch.
