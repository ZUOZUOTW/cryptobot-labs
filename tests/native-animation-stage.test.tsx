import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interpolatePoints,
  useLoopingFrame,
} from "@/components/home/NativeAnimationStage";
import { StrategyCodePlayer } from "@/components/home/StrategyCodePlayer";

const originalMatchMedia = window.matchMedia;

function reducedMotionMedia(query: string): MediaQueryList {
  return {
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  };
}

function FrameProbe() {
  const frame = useLoopingFrame({
    durationInFrames: 30,
    fps: 30,
    reducedMotionFrame: 29,
  });
  return <output aria-label="current frame">{frame}</output>;
}

afterEach(() => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: originalMatchMedia,
  });
  vi.restoreAllMocks();
});

describe("native strategy animations", () => {
  it("interpolates and clamps multi-point animation keyframes", () => {
    expect(interpolatePoints(-1, [0, 10, 20], [0, 100, 0])).toBe(0);
    expect(interpolatePoints(5, [0, 10, 20], [0, 100, 0])).toBe(50);
    expect(interpolatePoints(15, [0, 10, 20], [0, 100, 0])).toBe(50);
    expect(interpolatePoints(25, [0, 10, 20], [0, 100, 0])).toBe(0);
  });

  it("holds the final frame instead of starting a loop for reduced motion", () => {
    const callbacks: FrameRequestCallback[] = [];
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: reducedMotionMedia,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });

    render(<FrameProbe />);
    expect(screen.getByRole("status", { name: "current frame" })).toHaveTextContent("29");
    expect(callbacks).toHaveLength(1);

    act(() => callbacks[0](1_000));
    expect(screen.getByRole("status", { name: "current frame" })).toHaveTextContent("29");
    expect(callbacks).toHaveLength(1);
  });

  it("renders the complete validation state when reduced motion is requested", () => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: reducedMotionMedia,
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 1);

    render(<StrategyCodePlayer />);

    expect(screen.getByRole("img", {
      name: "交易策略代碼輸入、掃描並完成匯入驗證的動畫",
    })).toBeInTheDocument();
    expect(screen.getByText("STATIC CHECK PASSED")).toBeInTheDocument();
    expect(screen.getByText("0 ERRORS")).toBeInTheDocument();
    expect(screen.getByText("strategy.risk.stopLoss(0.03);")).toBeInTheDocument();
  });
});
