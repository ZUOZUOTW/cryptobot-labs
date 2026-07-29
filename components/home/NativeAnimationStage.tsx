"use client";

import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

const STAGE_WIDTH = 840;
const STAGE_HEIGHT = 500;
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(reducedMotionQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function reducedMotionSnapshot() {
  return typeof window !== "undefined" && window.matchMedia(reducedMotionQuery).matches;
}

export function easeOutCubic(value: number) {
  return 1 - ((1 - value) ** 3);
}

export function interpolatePoints(
  value: number,
  input: readonly number[],
  output: readonly number[],
  easing: (progress: number) => number = (progress) => progress,
) {
  if (input.length !== output.length || input.length < 2) {
    throw new Error("Animation interpolation requires matching input and output keyframes");
  }
  if (value <= input[0]) return output[0];
  if (value >= input[input.length - 1]) return output[output.length - 1];

  for (let index = 0; index < input.length - 1; index += 1) {
    if (value > input[index + 1]) continue;
    const distance = input[index + 1] - input[index];
    const progress = distance === 0 ? 1 : (value - input[index]) / distance;
    return output[index] + ((output[index + 1] - output[index]) * easing(progress));
  }

  return output[output.length - 1];
}

export function useLoopingFrame({
  durationInFrames,
  fps,
  reducedMotionFrame,
}: {
  durationInFrames: number;
  fps: number;
  reducedMotionFrame: number;
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    reducedMotionSnapshot,
    () => true,
  );
  const [frame, setFrame] = useState(reducedMotionFrame);

  useEffect(() => {
    let request = 0;
    if (reducedMotion) {
      request = window.requestAnimationFrame(() => setFrame(reducedMotionFrame));
      return () => window.cancelAnimationFrame(request);
    }

    const startedAt = window.performance.now();
    let previousFrame = -1;
    const tick = (now: number) => {
      const nextFrame = Math.floor(((now - startedAt) / 1000) * fps) % durationInFrames;
      if (nextFrame !== previousFrame) {
        previousFrame = nextFrame;
        setFrame(nextFrame);
      }
      request = window.requestAnimationFrame(tick);
    };
    request = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(request);
  }, [durationInFrames, fps, reducedMotion, reducedMotionFrame]);

  return frame;
}

export function NativeAnimationStage({
  children,
  style,
}: {
  children: ReactNode;
  style?: CSSProperties;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let request = 0;
    const updateScale = () => {
      const bounds = container.getBoundingClientRect();
      const nextScale = Math.min(bounds.width / STAGE_WIDTH, bounds.height / STAGE_HEIGHT);
      setScale((current) => current === nextScale ? current : nextScale);
    };
    const scheduleScaleUpdate = () => {
      window.cancelAnimationFrame(request);
      request = window.requestAnimationFrame(updateScale);
    };
    const observer = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleScaleUpdate)
      : null;

    observer?.observe(container);
    window.addEventListener("resize", scheduleScaleUpdate);
    scheduleScaleUpdate();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", scheduleScaleUpdate);
      window.cancelAnimationFrame(request);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden", ...style }}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: STAGE_WIDTH,
          height: STAGE_HEIGHT,
          overflow: "hidden",
          transform: `translate(-50%, -50%) scale(${scale ?? 0})`,
          transformOrigin: "center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
