"use client";

import { Trans, useLingui } from "@lingui/react/macro";
import { useQuery } from "@tanstack/react-query";
import {
  CaptionsIcon,
  MicIcon,
  MicOffIcon,
  PhoneIcon,
  PhoneOffIcon,
} from "@workspace/icons";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type CallError,
  type CallState,
  type OrbState,
  orbStateOf,
} from "./turn";
import {
  useVoiceCall,
  type VoiceBridge,
  type VoiceCall,
} from "./use-voice-call";

// The call button and the voice overlay (172). The button shows only when
// the server has voice (`GET /api/voice`); the overlay is the orb, its
// state, mute, the transcript toggle and hang-up. What's said lands in the
// chat behind it as ordinary messages.

interface VoiceInfo {
  readonly enabled: boolean;
}

const fetchInfo = async (baseUrl: string): Promise<VoiceInfo> => {
  const response = await fetch(`${baseUrl}/api/voice`, {
    credentials: "same-origin",
  });
  if (!response.ok) {
    return { enabled: false };
  }
  const body = (await response.json()) as { enabled?: unknown };
  return { enabled: body.enabled === true };
};

export interface VoiceCallButtonProps {
  readonly baseUrl?: string;
  readonly bridge: VoiceBridge;
  /**
   * Who's on the call: the overlay's title (a Dot's name) and, when set, the
   * face in the orb (a Dot's avatar) with the halo's colour class.
   */
  readonly name?: string | null;
  readonly orb?: VoiceOrbLook;
}

/** A face for the orb: drawn inside the core, which the level scales. */
export interface VoiceOrbLook {
  readonly face: ReactNode;
  readonly haloClassName: string;
}

export function VoiceCallButton({
  baseUrl = "",
  bridge,
  name,
  orb,
}: VoiceCallButtonProps) {
  const { t } = useLingui();
  const info = useQuery({
    queryFn: () => fetchInfo(baseUrl),
    queryKey: ["voice", "info", baseUrl],
    staleTime: Number.POSITIVE_INFINITY,
  });
  const [open, setOpen] = useState(false);
  const onEnded = useCallback(() => setOpen(false), []);
  const call = useVoiceCall({ baseUrl, bridge, onEnded });
  const { start } = call;
  const begin = useCallback(() => {
    setOpen(true);
    start().catch(() => undefined);
  }, [start]);

  if (!info.data?.enabled) {
    return null;
  }
  const label = t`Start voice chat`;
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              data-testid="voice-call"
              onClick={begin}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <PhoneIcon />
        </TooltipTrigger>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
      {open ? (
        <VoiceOverlay call={call} look={orb} name={name ?? null} />
      ) : null}
    </>
  );
}

function useStatusText(state: CallState): string {
  const { t } = useLingui();
  if (state.muted && orbStateOf(state.phase) === "listening") {
    return t`Muted`;
  }
  switch (state.phase) {
    case "connecting":
      return t`Connecting…`;
    case "listening":
      return t`Listening`;
    case "hearing":
      return t`Hearing you`;
    case "transcribing":
    case "thinking":
    case "paused":
      return t`Thinking`;
    case "speaking":
      return t`Speaking`;
    case "ended":
      return t`Call ended`;
    default: {
      const unreachable: never = state.phase;
      return unreachable;
    }
  }
}

function useErrorText(error: CallError | null): string | null {
  const { t } = useLingui();
  switch (error) {
    case null:
      return null;
    case "microphone":
      return t`Couldn't use the microphone. Check the browser's permission.`;
    case "transcription":
      return t`Couldn't hear that. Try again.`;
    case "unavailable":
      return t`Voice isn't answering right now. Try again in a moment.`;
    case "speech":
      return t`Couldn't play the answer. It's in the chat.`;
    case "reply":
      return t`The answer stopped. It's in the chat.`;
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function VoiceOverlay({
  call,
  look,
  name,
}: {
  readonly call: VoiceCall;
  readonly look?: VoiceOrbLook;
  readonly name: string | null;
}) {
  const { t } = useLingui();
  const [showTranscript, setShowTranscript] = useState(false);
  const { end, level, setMuted, state, transcript } = call;
  const status = useStatusText(state);
  const error = useErrorText(state.error);
  const orb = orbStateOf(state.phase);
  const toggleMute = useCallback(
    () => setMuted(!state.muted),
    [setMuted, state.muted]
  );
  const toggleTranscript = useCallback(
    () => setShowTranscript((shown) => !shown),
    []
  );
  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        end();
      }
    },
    [end]
  );
  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="flex h-[min(40rem,calc(100dvh-2rem))] flex-col items-center gap-6 p-6 sm:max-w-md"
        data-testid="voice-overlay"
        showCloseButton={false}
      >
        <div className="flex flex-col items-center gap-1 text-center">
          <DialogTitle>
            {name ? (
              <Trans>Talking with {name}</Trans>
            ) : (
              <Trans>Voice chat</Trans>
            )}
          </DialogTitle>
          <DialogDescription aria-live="polite">{status}</DialogDescription>
        </div>
        <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
          <VoiceOrb level={level} look={look} state={orb} />
        </div>
        {error ? (
          <p className="text-center text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {showTranscript ? (
          <section
            aria-label={t`Transcript`}
            className="max-h-40 w-full overflow-y-auto rounded-lg border border-border p-3 text-sm"
          >
            {transcript.user ? (
              <p>
                <span className="font-medium">
                  <Trans>You</Trans>
                </span>{" "}
                {transcript.user}
              </p>
            ) : (
              <p className="text-muted-foreground">
                <Trans>Say something to start.</Trans>
              </p>
            )}
            {transcript.reply ? (
              <p className="mt-2 whitespace-pre-wrap text-muted-foreground">
                {transcript.reply}
              </p>
            ) : null}
          </section>
        ) : null}
        <div className="flex items-center gap-3">
          <Button
            aria-label={state.muted ? t`Unmute microphone` : t`Mute microphone`}
            aria-pressed={state.muted}
            className="size-12 rounded-full aria-pressed:bg-muted"
            onClick={toggleMute}
            variant="outline"
          >
            {state.muted ? (
              <MicOffIcon className="size-5" />
            ) : (
              <MicIcon className="size-5" />
            )}
          </Button>
          <Button
            aria-label={
              showTranscript ? t`Hide transcript` : t`Show transcript`
            }
            aria-pressed={showTranscript}
            className="size-12 rounded-full aria-pressed:bg-muted"
            onClick={toggleTranscript}
            variant="outline"
          >
            <CaptionsIcon className="size-5" />
          </Button>
          <Button
            aria-label={t`End voice chat`}
            className="size-12 rounded-full"
            onClick={end}
            variant="destructive"
          >
            <PhoneOffIcon className="size-5" />
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const nodeOf = (ref: { readonly current: HTMLDivElement | null }) =>
  ref.current;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The orb. Its size follows the audio level (the user's while listening,
 * the answer's while speaking), written straight to `transform` each frame
 * so React doesn't re-render at 60 Hz. With reduced motion it doesn't
 * grow; the halo's opacity carries the level instead.
 */
export function VoiceOrb({
  level,
  look,
  state,
}: {
  readonly level: () => number;
  readonly look?: VoiceOrbLook;
  readonly state: OrbState;
}) {
  const core = useRef<HTMLDivElement>(null);
  const halo = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const still = reducedMotion();
    let smooth = 0;
    let frame = 0;
    const tick = () => {
      // Speech levels are small; lift them so normal talking moves the orb.
      const target = Math.min(1, level() * 6);
      smooth += (target - smooth) * 0.25;
      const coreNode = nodeOf(core);
      const haloNode = nodeOf(halo);
      if (coreNode && haloNode) {
        if (still) {
          haloNode.style.opacity = String(0.2 + smooth * 0.6);
        } else {
          coreNode.style.transform = `scale(${1 + smooth * 0.12})`;
          haloNode.style.transform = `scale(${1 + smooth * 0.5})`;
          haloNode.style.opacity = String(0.25 + smooth * 0.5);
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);
  return (
    <div
      aria-hidden
      className="relative grid size-24 place-items-center"
      data-state={state}
      data-testid="voice-orb"
    >
      <div
        className={cn(
          "absolute inset-0 rounded-full",
          look ? look.haloClassName : "bg-primary/20",
          state === "thinking" && "animate-pulse"
        )}
        ref={halo}
      />
      <div
        className={cn(
          "grid size-16 place-items-center rounded-full transition-opacity duration-(--motion-base) ease-motion-out",
          !look && "bg-primary",
          state === "idle" && "opacity-40",
          state === "listening" && "opacity-80",
          state === "thinking" && "opacity-60",
          state === "speaking" && "opacity-100"
        )}
        ref={core}
      >
        {look?.face}
      </div>
    </div>
  );
}
