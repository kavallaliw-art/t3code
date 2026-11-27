import { beforeEach, expect, it, vi } from "vite-plus/test";
import type { AudioPlayer, AudioStatus } from "expo-audio";

const audio = vi.hoisted(() => ({
  token: { kind: "playback" },
  acquire: vi.fn(),
  activate: vi.fn(),
  release: vi.fn(),
  dispose: vi.fn(),
  isOwner: vi.fn(),
}));

vi.mock("../../lib/audioSession", () => ({
  acquireAudioSession: audio.acquire,
  activateAudioSession: audio.activate,
  releaseAudioSession: audio.release,
  disposeAudioPlayer: audio.dispose,
  isAudioSessionOwner: audio.isOwner,
}));

import { playRecordingLimitCue } from "./recordingLimitCue";

function createPlayer() {
  let listener: ((status: AudioStatus) => void) | null = null;
  const remove = vi.fn();
  const player = {
    play: vi.fn(),
    pause: vi.fn(),
    release: vi.fn(),
    addListener: vi.fn((_event: string, next: (status: AudioStatus) => void) => {
      listener = next;
      return { remove };
    }),
  };
  return {
    player: player as unknown as AudioPlayer,
    play: player.play,
    remove,
    emit: (status: AudioStatus) => listener?.(status),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  audio.acquire.mockReturnValue(audio.token);
  audio.isOwner.mockReturnValue(true);
  audio.activate.mockResolvedValue(true);
  audio.release.mockResolvedValue(undefined);
});

it("plays once and releases its player and audio session on completion", async () => {
  const activation = Promise.withResolvers<boolean>();
  audio.activate.mockReturnValue(activation.promise);
  const player = createPlayer();

  playRecordingLimitCue(() => player.player);
  activation.resolve(true);
  await activation.promise;
  expect(player.play).toHaveBeenCalledOnce();

  player.emit({ didJustFinish: true } as AudioStatus);
  player.emit({ didJustFinish: true } as AudioStatus);

  expect(player.play).toHaveBeenCalledOnce();
  expect(player.remove).toHaveBeenCalledOnce();
  expect(audio.release).toHaveBeenCalledOnce();
  expect(audio.release).toHaveBeenCalledWith(audio.token);
  expect(audio.dispose).toHaveBeenCalledOnce();
  expect(audio.dispose).toHaveBeenCalledWith(player.player);
});

it("does not play or retain a player while recording owns the audio session", () => {
  audio.isOwner.mockReturnValue(false);
  const player = createPlayer();

  playRecordingLimitCue(() => player.player);

  expect(player.play).not.toHaveBeenCalled();
  expect(audio.activate).not.toHaveBeenCalled();
  expect(player.remove).not.toHaveBeenCalled();
  expect(audio.release).toHaveBeenCalledOnce();
  expect(audio.dispose).toHaveBeenCalledOnce();
});

it("stops when another audio session takes over", () => {
  const player = createPlayer();
  playRecordingLimitCue(() => player.player);
  const onCancel = audio.acquire.mock.calls[0]?.[1] as () => void;

  onCancel();

  expect(audio.release).toHaveBeenCalledOnce();
  expect(audio.dispose).toHaveBeenCalledOnce();
});

it("releases the player and audio session if completion never arrives", () => {
  vi.useFakeTimers();
  try {
    const player = createPlayer();
    playRecordingLimitCue(() => player.player);

    vi.advanceTimersByTime(2_000);

    expect(audio.release).toHaveBeenCalledOnce();
    expect(audio.dispose).toHaveBeenCalledOnce();
  } finally {
    vi.useRealTimers();
  }
});
