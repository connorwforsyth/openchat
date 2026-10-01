---
id: "104"
title: "Voice: dictation and a voice conversation mode (proposal first)"
labels: [wayfinder:grilling]
status: open
assignee: 
blockedBy: []
---

## Question

Connor (2026-10-01): "we definitely need some kind of voice mode". Earlier he pointed at FluidVoice (on-device dictation, Parakeet and Whisper). There are two features here: dictation into the composer, and a spoken back-and-forth conversation.

## Done when

- A proposal in `docs/proposals/` covering:
  - dictation (on-device in the browser, a self-hosted STT server, or the provider's STT);
  - voice conversation (a speech-to-text, model, text-to-speech pipeline vs provider realtime APIs; WebRTC/LiveKit; interruptions);
  - what works without a Vercel account and without paid services;
  - cost and privacy, mobile and desktop;
  - how it fits the composer (+ menu, mic button) and runs (durable runs, approvals while talking).
- Questions for Connor at the end. Nothing is built until he answers.

## Owns

`docs/proposals/**`.
