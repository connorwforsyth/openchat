# Voice conversations

Talk to a chat, a Dot's included, the way ChatGPT's voice mode works: press
the phone button in the chat header, speak, and the answer is spoken back.
What you say and what it answers land in the conversation as ordinary
messages, so the agent keeps every tool it has (search, files, the
workspace, schedules) and the history reads like a typed chat.

Ticket 172 (proposal: ticket 104). Voice is off until it's configured; with no
`voice:` block, or no URLs, the call button doesn't render and nothing else
changes.

## Providers

`voice.provider` in `app.config.yaml`:

| | `local` (default) | `openai` |
|---|---|---|
| Speech to text | Whisper via [Speaches](https://github.com/speaches-ai/speaches) (faster-whisper) | `gpt-4o-mini-transcribe` (or `whisper-1`) |
| Text to speech | Kokoro 82M via [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) | `gpt-4o-mini-tts` (or `tts-1`) |
| Where audio goes | Your machine only | OpenAI |
| Needs | `docker compose --profile voice up -d` | `OPENAI_API_KEY` |
| Speech to speech | No | OpenAI Realtime: server mints the session (see "Realtime") |

Both use the same two ports and the same adapter: the OpenAI audio API
(`POST /audio/transcriptions`, `POST /audio/speech`), which Speaches and
Kokoro-FastAPI also serve.

### Local (Whisper + Kokoro)

```sh
docker compose --profile voice up -d whisper kokoro
# Whisper's model downloads once, on request (about 150 MB for base.en):
curl -X POST localhost:8000/v1/models/Systran/faster-whisper-base.en
```

Both images are multi-arch CPU builds (`linux/arm64` included), so they run
on Apple Silicon under Docker Desktop. Kokoro's model ships in the image.

`.env`:

```sh
VOICE_STT_URL=http://localhost:8000/v1
VOICE_TTS_URL=http://localhost:8880/v1
```

`app.config.yaml`:

```yaml
voice:
  provider: local
  stt: { url: "${VOICE_STT_URL}", model: Systran/faster-whisper-base.en }
  tts: { url: "${VOICE_TTS_URL}", model: kokoro, voice: af_heart }
```

Inside compose (`web` in a container) the URLs are `http://whisper:8000/v1`
and `http://kokoro:8880/v1`; `docker-compose.yml` sets them when the host
values are set. Voices: `curl localhost:8880/v1/audio/voices`. Models:
`curl "localhost:8000/v1/registry?task=automatic-speech-recognition"`
(`tiny.en` is fastest; `small.en` is more accurate; `distil-*` sit between).

**Parakeet.** NVIDIA's Parakeet TDT is much faster than Whisper at similar
accuracy, but Speaches 0.8.3 (the pinned image) lists no Parakeet model in
its registry, only Whisper variants. Any OpenAI-compatible server that serves
Parakeet (for example an `onnx-asr`- or NeMo-based one) drops in by changing
`voice.stt.url` and `voice.stt.model`; nothing else changes.

### OpenAI

```yaml
voice:
  provider: openai
  openai:
    apiKey: "${OPENAI_API_KEY}"   # optional: falls back to providers.openai.apiKey
    sttModel: gpt-4o-mini-transcribe
    ttsModel: gpt-4o-mini-tts
    voice: alloy
    realtimeModel: gpt-realtime
```

The browser never sees the key: every request goes through the app's
`/api/voice/*` routes. Tested with MSW mocks only (no key in CI).

## Architecture

```
 browser                                server (Hono, /api)          services
 ───────                                ───────────────────          ────────
 mic ─► AudioWorklet tap ─► energy VAD
          (pure vadStep)    │ speech-end
                            ▼
        16 kHz WAV ──────► POST /api/voice/transcribe ─► SpeechToText ─► Whisper
                            │ { text }
                            ▼
        bridge.send(text) ─► POST /api/runs (the chat's own useRunChat)
                            │ run stream (SSE) ─► the reply renders in the chat
        bridge.reply ◄──────┘
          │ advanceReply: split into sentences as it streams
          ▼
        per sentence ────► POST /api/voice/speak ─► TextToSpeech ─► Kokoro
          │ mp3, fetched ahead, played in order (Web Audio)
          ▼
        speaker ─► analyser ─► orb level
```

- **Ports** (`packages/server/src/ports/speech.ts`): `SpeechToText.transcribe`
  and `TextToSpeech.speak`, returning `Result`s; in-memory fakes in
  `speech.memory.ts`. Adapters: `packages/server/src/voice/openai-compatible.ts`.
  `voice/from-config.ts` picks the provider; `null` means voice is off.
- **Routes** (`packages/server/src/voice/routes.ts`): plain Hono routes, like
  file downloads and the run stream, because audio is raw bytes in and a
  stream out. No contract change. All need a session.

  | Route | |
  |---|---|
  | `GET /api/voice` | `{ enabled, provider, realtime, maxUploadMb }`; the client shows the button on `enabled` |
  | `POST /api/voice/transcribe` | body: audio bytes, `Content-Type: audio/*` (≤ `maxUploadMb`) → `{ text }` |
  | `POST /api/voice/speak` | `{ text, voice? }` (≤ 2000 chars) → audio |
  | `POST /api/voice/realtime/session` | OpenAI only: a 60-second client secret |

- **Turn-taking** (`packages/chat-ui/src/voice/turn.ts`): a pure reducer
  `callStep(state, event) → { state, effects }` (phases `connecting`,
  `listening`, `hearing`, `transcribing`, `thinking`, `speaking`, `ended`;
  the orb shows `idle | listening | thinking | speaking`) and a pure
  energy-based VAD `vadStep` (adaptive noise floor; 150 ms to start, 800 ms
  of silence to end; stricter while the assistant talks, so its own voice
  leaking into the mic doesn't count). We chose energy over a neural VAD
  (`@ricky0123/vad-web`) to avoid shipping ONNX and WASM assets through
  Next; the reducer doesn't care which detector feeds it.
- **Sentences** (`sentences.ts`): `speakable` strips markdown (code blocks,
  link targets, emphasis), `settledPrefix` waits for half-written markup to
  close, `takeSentences` cuts at sentence ends (not at `e.g.` or `3.5`),
  joins fragments under 24 characters and cuts run-ons at 280.
- **The engine** (`voice-engine.ts`): the imperative shell. Mic via
  `getUserMedia` (echo cancellation on), an AudioWorklet tap with 400 ms
  of pre-roll so the first syllable isn't lost, WAV encoding (`wav.ts`), the
  TTS queue and player, and barge-in.
- **The chat** (`ConnectedChat`'s `voice` prop): the call gets a
  `VoiceBridge` (`send`, `stop`, the newest reply, busy) built from the
  chat's own `useRunChat`, so a spoken turn is exactly a typed one: same
  run, same stream, same approvals, same history.
- **UI** (`voice-call.tsx`): the header button and a dialog with the orb,
  status, error, transcript toggle, mute and hang-up. The orb's size follows
  the level (yours while listening, the answer's while speaking), written to
  `transform` per frame; with `prefers-reduced-motion` it doesn't grow and
  the halo's opacity carries the level instead.

**Barge-in.** Speaking while the answer plays stops the audio, aborts the
pending TTS fetches and cancels the run on the server (`runs.cancel`, the
same as Stop), then records what you're saying as the next turn. The partial
answer stays in the chat, marked stopped.

**Typed and on-device input.** `useVoiceCall().submitText(text)` sends text
that's already transcribed (the reducer's `heard-text` event), with no
upload. It's how a desktop app with on-device speech to text would plug in.

## Checking it end to end

There's no microphone in CI, so the round trip is scripted: Kokoro says a
question into a WAV, the app transcribes it through `/api/voice/transcribe`,
the text is posted to a Dot's chat with `POST /api/runs`, the run stream is
read, and each sentence goes through `/api/voice/speak`. The browser run uses
Chromium's fake microphone fed with the same WAV
(`--use-file-for-fake-audio-capture=mic.wav%noloop`), so the real
AudioWorklet, VAD, reducer, upload, chat send and player all run.

Measured on an M-series Mac, Docker Desktop with 10 CPUs and 7.6 GB for
the VM, CPU images, `base.en`, `af_heart`, a Dot on Claude Haiku 4.5 through
the gateway. The machine was shared with other heavy work (load average 10
to 20 for these runs; 50 to 75 earlier, when every stage was several times
slower), so treat them as an upper bound for this hardware.

| Stage | Time |
|---|---|
| End of speech → transcript (upload + Whisper `base.en`, 4 s utterance, warm) | 3.0 to 5.1 s (`tiny.en`: 1.6 to 2.2 s) |
| Transcript → run created (`POST /api/runs`) | 46 to 84 ms |
| Run created → first text (model) | 3.7 to 4.4 s |
| Sentence → audio (Kokoro, one short sentence, 7 words) | 1.7 s |
| Sentence → audio (Kokoro, one 25-word sentence) | 7 to 11 s |

So the first words play about 9 to 12 seconds after you stop talking on this
setup, most of it CPU speech models in a VM. A GPU, a native (non-Docker)
build, `tiny.en`, or `provider: openai` cut it to a few seconds. Kokoro streams
(first byte in about 15 ms) but the browser decodes whole sentences, so
sentence length matters; sentences are synthesized one at a time so the first
isn't slowed by the rest.

## Realtime (speech to speech)

`provider: openai` also enables `POST /api/voice/realtime/session`, which
mints a short-lived OpenAI Realtime client secret server-side (never the
key). The session gets one function tool, `ask_assistant({ request })`: the
browser answers it by sending `request` through the same `VoiceBridge` (so
the chat's agent, with all its tools, does the work) and returning the
reply's text as the function output. The server side, the tool definition and
the adapter seam (`RealtimeSessions`) are built and tested; **the browser's
WebRTC client is not built yet**, so the overlay always uses the STT, chat,
TTS loop today.

## Gaps

- No browser WebRTC client for Realtime (above).
- An approval during a voice turn waits silently; the overlay says
  "Thinking" until you approve in the chat behind it.
- Echo cancellation is the browser's. On speakers without it, the stricter
  barge-in threshold can still be crossed by a loud answer; headphones avoid
  it. A neural VAD would help.
- Dictation into the composer (transcribe and edit before sending) isn't
  built; the transcribe route is ready for it.
- One voice per instance (`voice.tts.voice`); no picker yet. The route takes
  a `voice` override for when there is one.
- No dedicated mobile layout beyond the dialog's responsive size.

## Future work: on-device STT (FluidAudio / Parakeet)

[FluidVoice](https://github.com/altic-dev/FluidVoice) (GPLv3, macOS) uses the
[FluidAudio](https://github.com/FluidInference/FluidAudio) Swift SDK to run
NVIDIA Parakeet TDT on the Apple Neural Engine: fast, private dictation with
no server. For the desktop app (`apps/desktop`, Electron), a native helper
could do the same and hand the call text instead of audio:

- The turn loop already accepts text: `submitText(text)` /
  the `heard-text` event skips the upload and sends straight away, with
  barge-in handled the same way.
- The helper would also report speech start and end (FluidAudio has VAD),
  which map to the reducer's `speech-start` and `speech-end` events.
- On the server nothing changes; `SpeechToText` stays for browsers and the
  web app.
- FluidVoice itself is GPLv3, so we'd use the FluidAudio SDK (Apache-2.0) in
  our own helper rather than its code.
