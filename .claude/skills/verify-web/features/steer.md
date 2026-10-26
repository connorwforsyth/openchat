# Steer

The composer while an answer streams (Connor, night 2): Enter queues the next
turn, Mod+Enter (or the Steer button) steers the answer being written at its
next step. Queued turns show over the composer with Steer now, Edit and
Remove. The queue is the server's (D25), so a second tab shows the same.

Journey: `journeys/steer.journey.ts`. The mock model answers in one step, so
here a steer runs as the next turn; the server tests cover a real take.
