import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { beforeEach, expect, it, vi } from "vite-plus/test";

const cue = vi.hoisted(() => ({ play: vi.fn(), alert: vi.fn() }));

vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock("react-native-reanimated", () => ({ makeMutable: () => ({ set() {} }) }));
vi.mock("../showcase/nativeShowcaseScene", () => ({ getNativeShowcaseScene: () => null }));
vi.mock("expo-file-system", () => ({
  File: class {
    delete() {}
  },
}));
vi.mock("expo-keep-awake", () => ({
  activateKeepAwakeAsync: async () => {},
  deactivateKeepAwake: async () => {},
}));
vi.mock("expo-audio", () => ({
  AudioModule: {},
  RecordingPresets: { HIGH_QUALITY: { ios: {}, android: {} } },
  requestRecordingPermissionsAsync: async () => ({ granted: true }),
  setAudioModeAsync: vi.fn(async () => {}),
  setIsAudioActiveAsync: async () => {},
}));
vi.mock("../../native/voiceRecorder", () => ({ createVoiceRecorder: vi.fn() }));
vi.mock("../../native/voiceTranscription", () => ({ getLocalVoiceTranscriber: async () => null }));
vi.mock("../../state/preferences", async () => {
  const { AsyncResult, Atom } = await import("effect/reactivity");
  return { mobilePreferencesAtom: Atom.make(AsyncResult.initial()) };
});
vi.mock("./voiceDestination", async () => {
  const { Atom } = await import("effect/reactivity");
  return { voiceRouteAtom: Atom.make(null) };
});
vi.mock("./recordingLimitCue", () => ({ playRecordingLimitCue: cue.play }));
vi.mock("../../components/ui/Dialog", () => ({ alert: cue.alert }));

import { setAudioModeAsync, type RecordingStatus } from "expo-audio";
import type { MicrophoneEntry } from "../../lib/microphonePriority";
import { createVoiceRecorder } from "../../native/voiceRecorder";
import { mobilePreferencesAtom } from "../../state/preferences";
import { localVoiceTranscriberAtom, voiceInputAtom } from "./VoiceInputProvider";
import { createVoiceInputTarget } from "./voiceInputSession";

beforeEach(() => {
  cue.play.mockReset();
  cue.alert.mockReset();
});

it("uses the loaded microphone order when recording starts before preferences hydrate", async () => {
  const registry = AtomRegistry.make();
  const preferences = mobilePreferencesAtom as Atom.Writable<
    AsyncResult.AsyncResult<{ microphones: ReadonlyArray<MicrophoneEntry> }>,
    AsyncResult.AsyncResult<{ microphones: ReadonlyArray<MicrophoneEntry> }>
  >;
  // Startup either subscribes to pending preferences or activates audio before they load.
  const startup = Promise.withResolvers<void>();
  vi.mocked(setAudioModeAsync).mockImplementation(async () => startup.resolve());
  const setInput = vi.fn();
  vi.mocked(createVoiceRecorder, { partial: true }).mockReturnValue({
    uri: "file:///voice.m4a",
    prepareToRecordAsync: async () => {},
    record() {},
    stop: async () => {},
    getStatus: () => ({
      canRecord: true,
      isRecording: false,
      durationMillis: 0,
      fileSize: 0,
      mediaServicesDidReset: false,
      url: null,
    }),
    addListener: () => ({ remove() {} }),
    getAvailableInputs: () => [{ uid: "iphone", name: "iPhone", type: "MicrophoneBuiltIn" }],
    setInput,
    release() {},
  });
  registry.set(localVoiceTranscriberAtom, {
    prepare: async () => ({ locale: "en-US", transcribe: async () => "" }),
  });
  const { session } = registry.get(voiceInputAtom);
  const subscribe = registry.subscribe.bind(registry);
  using _subscribe = vi
    .spyOn(registry, "subscribe")
    .mockImplementation((atom, listener, options) => {
      if (atom === preferences) startup.resolve();
      return subscribe(atom, listener, options);
    });
  try {
    const start = session.start(
      createVoiceInputTarget("draft", () => "", vi.fn(), { start: 0, end: 0 }),
    );
    await startup.promise;
    registry.set(
      preferences,
      AsyncResult.success({
        microphones: [
          { kind: "builtIn" },
          { kind: "wired" },
          { kind: "bluetooth" },
          { kind: "carPlay" },
        ],
      }),
    );
    await start;
    expect(setAudioModeAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsRecording: true, allowBluetoothRecording: false }),
    );
    expect(setInput).toHaveBeenCalledWith("iphone");
  } finally {
    await session.controller.cancel();
    registry.dispose();
  }
});

it("plays one cue after releasing the recording at the limit, not on duplicates or manual stops", async () => {
  const registry = AtomRegistry.make();
  const preferences = mobilePreferencesAtom as Atom.Writable<
    AsyncResult.AsyncResult<{ microphones: ReadonlyArray<MicrophoneEntry> }>,
    AsyncResult.AsyncResult<{ microphones: ReadonlyArray<MicrophoneEntry> }>
  >;
  registry.set(preferences, AsyncResult.success({ microphones: [] }));
  const statusListeners = new Set<(status: RecordingStatus) => void>();
  const emitStatus = (status: RecordingStatus) => {
    for (const listener of statusListeners) listener(status);
  };
  vi.mocked(createVoiceRecorder, { partial: true }).mockReturnValue({
    uri: "file:///voice.m4a",
    prepareToRecordAsync: async () => {},
    record() {},
    stop: async () => {},
    getStatus: () => ({
      canRecord: true,
      isRecording: false,
      durationMillis: 0,
      fileSize: 0,
      mediaServicesDidReset: false,
      url: null,
    }),
    addListener: (_event, listener) => {
      statusListeners.add(listener);
      return { remove: () => statusListeners.delete(listener) };
    },
    getAvailableInputs: () => [],
    release() {},
  });
  registry.set(localVoiceTranscriberAtom, {
    prepare: async () => ({ locale: "en-US", transcribe: async () => "spoken text" }),
  });
  const { session } = registry.get(voiceInputAtom);
  const cueStarted = Promise.withResolvers<void>();
  cue.play.mockImplementation(() => cueStarted.resolve());
  try {
    await session.start(createVoiceInputTarget("draft", () => "", vi.fn(), { start: 0, end: 0 }));
    const finished = Promise.withResolvers<void>();
    if (session.controller.currentState.phase === "idle") finished.resolve();
    const unsubscribe = session.subscribe(() => {
      if (session.controller.currentState.phase === "idle") finished.resolve();
    });
    emitStatus({
      id: "recording",
      isFinished: true,
      hasError: false,
      error: null,
      url: "file:///voice.m4a",
      durationMillis: 300_000,
    });
    await cueStarted.promise;
    await finished.promise;
    unsubscribe();
    emitStatus({
      id: "recording",
      isFinished: true,
      hasError: false,
      error: null,
      url: "file:///voice.m4a",
      durationMillis: 300_000,
    });
    expect(cue.play).toHaveBeenCalledOnce();
    expect(cue.alert).toHaveBeenCalledOnce();

    await session.start(
      createVoiceInputTarget("draft", () => "spoken text", vi.fn(), { start: 0, end: 0 }),
    );
    await session.controller.stop();
    expect(cue.play).toHaveBeenCalledOnce();
    expect(cue.alert).toHaveBeenCalledOnce();
  } finally {
    await session.controller.cancel();
    registry.dispose();
  }
});
