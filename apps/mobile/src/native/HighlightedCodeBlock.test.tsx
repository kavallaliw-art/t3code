import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  tryCopy: vi.fn(),
}));

vi.mock("react-native", () => ({
  Pressable: (props: {
    readonly children?: ReactNode;
    readonly accessibilityLabel?: string;
    readonly disabled?: boolean;
    readonly onPress?: () => void;
  }) => (
    <button aria-label={props.accessibilityLabel} disabled={props.disabled} onClick={props.onPress}>
      {props.children}
    </button>
  ),
  ScrollView: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
  StyleSheet: { create: (styles: unknown) => styles, hairlineWidth: 1 },
  Text: ({ children }: { readonly children?: ReactNode }) => <span>{children}</span>,
  View: ({ children }: { readonly children?: ReactNode }) => <div>{children}</div>,
}));
vi.mock("gt-react-native", () => ({
  msg: (text: string) => text,
  useGT: () => (text: string) => text,
  useMessages: () => (text: string) => text,
}));
vi.mock("../components/ui/AppSymbol", () => ({
  SymbolView: ({ name }: { readonly name: string | { ios: string; android: string } }) => (
    <span data-icon={typeof name === "string" ? name : name.android} />
  ),
}));
vi.mock("../components/ui/Dialog", () => ({ alert: mocks.alert }));
vi.mock("../components/ui/Menu", () => ({
  Menu: ({ children }: { readonly children?: ReactNode }) => children,
}));
vi.mock("../features/threads/markdownCodeHighlightState", () => ({
  useMarkdownCodeHighlight: () => null,
}));
vi.mock("../lib/copyTextWithHaptic", () => ({
  copyTextWithHaptic: (text: string) => {
    void mocks.tryCopy(text);
  },
  tryCopyTextWithHaptic: mocks.tryCopy,
}));
vi.mock("../lib/highlights", () => ({ withTokenStarts: vi.fn() }));
vi.mock("../lib/mobileTheme", () => ({ themeColorWithAlpha: (color: string) => color }));

import { HighlightedCodeBlock } from "./HighlightedCodeBlock";

function setup(copySucceeds: boolean) {
  vi.useFakeTimers();
  vi.setSystemTime(0);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  mocks.alert.mockReset();
  mocks.tryCopy.mockReset();
  mocks.tryCopy.mockResolvedValue(copySucceeds);
  const container = document.createElement("div");
  const root = createRoot(container);
  act(() =>
    root.render(
      <HighlightedCodeBlock
        code="const answer = 42;"
        fence="ts"
        language="typescript"
        complete
        scheme="dark"
        textStyle={{
          color: "#ffffff",
          strongColor: "#ffffff",
          mutedColor: "#aaaaaa",
          linkColor: "#0000ff",
          inlineCodeColor: "#ffffff",
          codeColor: "#ffffff",
          codeBackgroundColor: "#111111",
          codeBlockBackgroundColor: "#111111",
          fileTextColor: "#ffffff",
          quoteMarkerColor: "#aaaaaa",
          dividerColor: "#333333",
          fontSize: 14,
          lineHeight: 20,
          fontFamily: "sans-serif",
          headingFontFamily: "sans-serif",
          boldFontFamily: "sans-serif",
          monoFontFamily: "monospace",
        }}
        codeStyle={{
          color: "#ffffff",
          fontFamily: "monospace",
          fontSize: 14,
          lineHeight: 20,
          padding: 12,
        }}
      />,
    ),
  );

  return {
    container,
    async clickCopy() {
      const button = container.querySelector<HTMLButtonElement>('button[aria-label="Copy code"]')!;
      await act(async () => button.click());
    },
    [Symbol.dispose]() {
      act(() => root.unmount());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    },
  };
}

it("shows copy success for 1200ms after the clipboard write succeeds", async () => {
  using harness = setup(true);

  await harness.clickCopy();

  expect(mocks.tryCopy).toHaveBeenCalledExactlyOnceWith("const answer = 42;");
  expect(harness.container.querySelector('button[aria-label="Copied"]')).not.toBeNull();
  expect(harness.container.querySelector('[data-icon="check"]')).not.toBeNull();

  act(() => vi.advanceTimersByTime(1200));

  expect(harness.container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  expect(harness.container.querySelector('[data-icon="content_copy"]')).not.toBeNull();
});

it("does not show copy success when the clipboard write fails", async () => {
  using harness = setup(false);

  await harness.clickCopy();

  expect(mocks.alert).toHaveBeenCalledWith("Could not copy", "Try again.");
  expect(harness.container.querySelector('button[aria-label="Copy code"]')).not.toBeNull();
  expect(harness.container.querySelector('button[aria-label="Copied"]')).toBeNull();
  expect(harness.container.querySelector('[data-icon="check"]')).toBeNull();
});
