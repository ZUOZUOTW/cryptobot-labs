"use client";

import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";

const clamp = {
  extrapolateLeft: "clamp",
  extrapolateRight: "clamp",
} as const;

const codeLines = [
  { text: 'import { strategy, rsi } from "@cryptobot/lab";', color: "#8cecff", start: 12 },
  { text: 'strategy.market("BTCUSDT");', color: "#cabdff", start: 38 },
  { text: "strategy.when(rsi(14).below(30)).enter();", color: "#8cecff", start: 64 },
  { text: "strategy.risk.stopLoss(0.03);", color: "#7ff0be", start: 92 },
] as const;

function TypedLine({
  text,
  color,
  line,
}: {
  text: string;
  color: string;
  line: number;
}) {
  const frame = useCurrentFrame();
  const characters = Math.floor(interpolate(frame, [0, 22], [0, text.length], clamp));
  const visibleText = text.slice(0, characters);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "38px minmax(0, 1fr)",
        gap: 16,
        minHeight: 38,
        alignItems: "center",
        opacity: interpolate(frame, [0, 4], [0, 1], clamp),
      }}
    >
      <span
        style={{
          color: "rgba(131, 166, 203, 0.45)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15,
          textAlign: "right",
        }}
      >
        {String(line).padStart(2, "0")}
      </span>
      <span
        style={{
          minWidth: 0,
          color,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 19,
          fontWeight: 650,
          letterSpacing: "-0.025em",
          lineHeight: 1.5,
          whiteSpace: "pre",
        }}
      >
        {visibleText}
        <span
          style={{
            display: characters < text.length ? "inline-block" : "none",
            width: 8,
            height: 23,
            marginLeft: 3,
            verticalAlign: "middle",
            background: "#f3f7ff",
            opacity: interpolate(frame % 16, [0, 7, 8, 15], [1, 1, 0, 0], clamp),
          }}
        />
      </span>
    </div>
  );
}

function ValidationResult() {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 18,
        margin: "18px 30px 0 84px",
        padding: "14px 18px",
        border: "1px solid rgba(101,242,189,0.48)",
        borderRadius: 14,
        background: "linear-gradient(90deg, rgba(101,242,189,0.13), rgba(76,221,255,0.06))",
        boxShadow: "0 0 30px rgba(101,242,189,0.12)",
        opacity: interpolate(frame, [0, 13], [0, 1], {
          ...clamp,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        }),
        translate: `0 ${interpolate(frame, [0, 13], [18, 0], {
          ...clamp,
          easing: Easing.bezier(0.16, 1, 0.3, 1),
        })}px`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          style={{
            display: "grid",
            width: 32,
            height: 32,
            placeItems: "center",
            borderRadius: 10,
            background: "#65f2bd",
            color: "#04141a",
            fontSize: 20,
            fontWeight: 950,
            boxShadow: "0 0 18px rgba(101,242,189,0.6)",
          }}
        >
          ✓
        </span>
        <div>
          <div
            style={{
              color: "#65f2bd",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 13,
              fontWeight: 850,
              letterSpacing: "0.12em",
            }}
          >
            STATIC CHECK PASSED
          </div>
          <div
            style={{
              marginTop: 3,
              color: "rgba(225,239,251,0.72)",
              fontFamily: "Arial, 'Noto Sans TC', sans-serif",
              fontSize: 14,
            }}
          >
            語法、進場條件與風控設定皆可匯入
          </div>
        </div>
      </div>
      <span
        style={{
          padding: "7px 10px",
          border: "1px solid rgba(101,242,189,0.34)",
          borderRadius: 99,
          color: "#8cf5ca",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          fontWeight: 800,
          whiteSpace: "nowrap",
        }}
      >
        0 ERRORS
      </span>
    </div>
  );
}

export function StrategyCodeComposition() {
  const frame = useCurrentFrame();
  const scanTop = interpolate(frame, [110, 139], [18, 86], clamp);
  const scanOpacity = interpolate(frame, [106, 112, 136, 142], [0, 1, 1, 0], clamp);

  return (
    <AbsoluteFill
      style={{
        overflow: "hidden",
        background:
          "radial-gradient(circle at 20% 15%, rgba(139,99,255,0.17), transparent 42%), linear-gradient(145deg, #071326, #040914 72%)",
        color: "white",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.16,
          backgroundImage:
            "linear-gradient(rgba(76,221,255,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(76,221,255,0.12) 1px, transparent 1px)",
          backgroundSize: "42px 42px",
        }}
      />

      <div
        style={{
          position: "relative",
          width: "calc(100% - 54px)",
          height: "calc(100% - 48px)",
          margin: "24px 27px",
          overflow: "hidden",
          border: "1px solid rgba(90, 187, 228, 0.27)",
          borderRadius: 18,
          background: "rgba(3, 10, 22, 0.86)",
          boxShadow: "0 28px 80px rgba(0,0,0,0.4), inset 0 1px rgba(255,255,255,0.035)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: 58,
            padding: "0 20px",
            borderBottom: "1px solid rgba(90, 187, 228, 0.18)",
            background: "rgba(11, 27, 49, 0.78)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ display: "flex", gap: 7 }}>
              {["#ff6b73", "#ffc568", "#65f2bd"].map((color) => (
                <span key={color} style={{ width: 10, height: 10, borderRadius: 99, background: color }} />
              ))}
            </div>
            <span
              style={{
                color: "#d9eaff",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              imported-strategy.js
            </span>
          </div>
          <span
            style={{
              padding: "7px 11px",
              border: "1px solid rgba(76,221,255,0.3)",
              borderRadius: 99,
              color: "#75e8ff",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: "0.1em",
            }}
          >
            IMPORT PREVIEW
          </span>
        </div>

        <div style={{ position: "relative", padding: "30px 30px 0" }}>
          <div style={{ display: "grid", gap: 4 }}>
            {codeLines.map((line, index) => (
              <Sequence key={line.text} from={line.start} layout="none">
                <TypedLine text={line.text} color={line.color} line={index + 1} />
              </Sequence>
            ))}
          </div>

          <div
            style={{
              position: "absolute",
              top: `${scanTop}%`,
              left: 42,
              right: 30,
              height: 3,
              borderRadius: 99,
              background: "linear-gradient(90deg, transparent, #55e7ff 16%, #9b7cff 75%, transparent)",
              boxShadow: "0 0 22px rgba(85,231,255,0.85)",
              opacity: scanOpacity,
            }}
          />
        </div>

        <Sequence from={138} layout="none">
          <ValidationResult />
        </Sequence>
      </div>
    </AbsoluteFill>
  );
}

export function StrategyCodePlayer({ embedded = false }: { embedded?: boolean }) {
  const playerRef = useRef<PlayerRef>(null);
  const mounted = useSyncExternalStore(() => () => undefined, () => true, () => false);

  useEffect(() => {
    if (mounted) playerRef.current?.play();
  }, [mounted]);

  return (
    <div
      aria-label={embedded ? undefined : "交易策略代碼輸入、掃描並完成匯入驗證的動畫"}
      className={embedded ? "deferred-player__content" : "strategy-code-player glass-panel"}
      role={embedded ? undefined : "img"}
    >
      {mounted ? (
        <Player
          ref={playerRef}
          component={StrategyCodeComposition}
          durationInFrames={190}
          fps={30}
          compositionWidth={840}
          compositionHeight={500}
          autoPlay
          loop
          initiallyMuted
          acknowledgeRemotionLicense
          controls={false}
          clickToPlay={false}
          style={{ width: "100%", height: "100%" }}
        />
      ) : <span className="player-loading" aria-hidden="true" />}
    </div>
  );
}
