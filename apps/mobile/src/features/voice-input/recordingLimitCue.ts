import type { AudioPlayer } from "expo-audio";

import {
  acquireAudioSession,
  activateAudioSession,
  disposeAudioPlayer,
  isAudioSessionOwner,
  releaseAudioSession,
} from "../../lib/audioSession";

const CUE_CLEANUP_TIMEOUT_MS = 2_000;

export function playRecordingLimitCue(createPlayer: () => AudioPlayer): void {
  let player: AudioPlayer;
  try {
    player = createPlayer();
  } catch {
    return;
  }

  let disposed = false;
  let token: ReturnType<typeof acquireAudioSession> | null = null;
  let subscription: { remove(): void } | null = null;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    clearTimeout(timeout);
    subscription?.remove();
    if (token) void releaseAudioSession(token).catch(() => {});
    disposeAudioPlayer(player);
  };
  const timeout = setTimeout(cleanup, CUE_CLEANUP_TIMEOUT_MS);

  try {
    token = acquireAudioSession("playback", cleanup);
    if (!isAudioSessionOwner(token)) {
      cleanup();
      return;
    }
    subscription = player.addListener("playbackStatusUpdate", (status) => {
      if (status.didJustFinish || status.error) cleanup();
    });
    void activateAudioSession(token)
      .then((active) => {
        if (disposed) return;
        if (!active) {
          cleanup();
          return;
        }
        player.play();
      })
      .catch(cleanup);
  } catch {
    cleanup();
  }
}
