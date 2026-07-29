"use client";

import { useI18n } from "@/components/I18nProvider";
import type { Locale } from "@/lib/i18n/locales";
import {
  easeOutCubic,
  interpolatePoints,
  NativeAnimationStage,
  useLoopingFrame,
} from "./NativeAnimationStage";

const moduleDefinitions = [
  { code: "SIGNAL", name: "RSI 反彈", accent: "#55e7ff", start: 12 },
  { code: "POSITION", name: "ATR 波動倉位", accent: "#9b7cff", start: 34 },
  { code: "RISK", name: "固定風控", accent: "#65f2bd", start: 56 },
] as const;

type StrategyModule = {
  code: string;
  name: string;
  accent: string;
  start: number;
};

type StrategyAssemblyCompositionProps = {
  frame: number;
  locale: Locale;
  eyebrow: string;
  title: string;
  liveBuild: string;
  modules: StrategyModule[];
  assemblyBus: string;
  readyLabel: string;
  readyText: string;
};

function ModuleCard({
  accent,
  code,
  frame,
  index,
  locale,
  name,
  start,
}: StrategyModule & { frame: number; index: number; locale: Locale }) {
  const localFrame = frame - start;
  const progress = localFrame < 0
    ? 0
    : interpolatePoints(localFrame, [0, 14], [0, 1], easeOutCubic);
  const glow = localFrame < 0
    ? 8
    : interpolatePoints(localFrame, [0, 16, 30], [8, 30, 18]);
  const horizontalStart = index === 1 ? 0 : index === 0 ? -70 : 70;
  const isRussian = locale === "ru";
  const isJapanese = locale === "ja";

  return (
    <div
      style={{
        position: "relative",
        minWidth: 0,
        display: "flex",
        minHeight: 142,
        flexDirection: "column",
        padding: "18px 16px 17px",
        overflow: "hidden",
        border: `1px solid ${accent}88`,
        borderRadius: 18,
        background: `linear-gradient(145deg, ${accent}22, rgba(4, 12, 28, 0.94) 56%)`,
        boxShadow: `0 0 ${glow}px ${accent}33`,
        opacity: localFrame < 0 ? 0 : interpolatePoints(localFrame, [0, 10], [0, 1], easeOutCubic),
        transform: `translate(${horizontalStart * (1 - progress)}px, ${-34 * (1 - progress)}px) scale(${0.82 + (0.18 * progress)})`,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: "auto -20% -55%",
          height: "90%",
          borderRadius: "50%",
          background: accent,
          filter: "blur(50px)",
          opacity: 0.16,
        }}
      />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <span
          style={{
            color: accent,
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: "0.12em",
          }}
        >
          {code}
        </span>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: 99,
            background: accent,
            boxShadow: `0 0 16px ${accent}`,
          }}
        />
      </div>
      <div
        style={{
          display: "flex",
          minHeight: 50,
          alignItems: "center",
          marginTop: 11,
          color: "#f5f8ff",
          fontFamily: "Arial, 'Noto Sans TC', sans-serif",
          fontSize: isRussian ? 19 : isJapanese ? 20 : 21,
          fontWeight: 800,
          letterSpacing: "-0.03em",
          lineHeight: 1.12,
          overflowWrap: "anywhere",
          wordBreak: "normal",
          textWrap: "balance",
        }}
      >
        {name}
      </div>
      <div
        style={{
          height: 4,
          marginTop: "auto",
          overflow: "hidden",
          borderRadius: 99,
          background: "rgba(255,255,255,0.08)",
        }}
      >
        <div
          style={{
            width: `${localFrame < 0
              ? 0
              : interpolatePoints(localFrame, [7, 25], [0, 100], easeOutCubic)}%`,
            height: "100%",
            borderRadius: 99,
            background: accent,
            boxShadow: `0 0 14px ${accent}`,
          }}
        />
      </div>
    </div>
  );
}

function AssemblyBus({
  frame,
  label,
  modules,
}: {
  frame: number;
  label: string;
  modules: StrategyModule[];
}) {
  const localFrame = frame - 72;
  const beam = localFrame < 0
    ? 0
    : interpolatePoints(localFrame, [0, 34], [0, 100], easeOutCubic);

  return (
    <div
      style={{
        position: "relative",
        height: 60,
        margin: "2px 8% 0",
        opacity: localFrame < 0 ? 0 : 1,
      }}
    >
      <div
        style={{
          position: "absolute",
          top: 15,
          left: 0,
          width: `${beam}%`,
          height: 3,
          borderRadius: 99,
          background: "linear-gradient(90deg, #55e7ff, #9b7cff 52%, #65f2bd)",
          boxShadow: "0 0 18px rgba(85,231,255,0.7)",
        }}
      />
      {[0, 50, 100].map((position, index) => (
        <div
          key={position}
          style={{
            position: "absolute",
            top: 8,
            left: `${position}%`,
            width: 16,
            height: 16,
            border: `2px solid ${modules[index].accent}`,
            borderRadius: 99,
            background: "#071122",
            boxShadow: beam >= position ? `0 0 20px ${modules[index].accent}` : "none",
            transform: "translateX(-50%)",
          }}
        />
      ))}
      <div
        style={{
          position: "absolute",
          top: 38,
          left: "50%",
          color: "rgba(194, 219, 242, 0.72)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: "0.16em",
          opacity: localFrame < 0 ? 0 : interpolatePoints(localFrame, [15, 28], [0, 1]),
          transform: "translateX(-50%)",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function ReadyState({
  frame,
  label,
  locale,
  text,
}: {
  frame: number;
  label: string;
  locale: Locale;
  text: string;
}) {
  const localFrame = frame - 112;
  const entrance = localFrame < 0
    ? 0
    : interpolatePoints(localFrame, [0, 14], [0, 1], easeOutCubic);
  const pulseFrame = Math.max(0, localFrame) % 32;
  const pulse = interpolatePoints(pulseFrame, [0, 16, 31], [0.9, 1.06, 0.9]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 18,
        width: "82%",
        margin: "0 auto",
        padding: "14px 22px",
        border: "1px solid rgba(101,242,189,0.56)",
        borderRadius: 18,
        background: "linear-gradient(90deg, rgba(85,231,255,0.1), rgba(101,242,189,0.14))",
        boxShadow: "0 0 38px rgba(101,242,189,0.18)",
        opacity: localFrame < 0 ? 0 : entrance,
        transform: `scale(${0.88 + (0.12 * entrance)})`,
      }}
    >
      <div
        style={{
          display: "grid",
          width: 40,
          height: 40,
          flex: "0 0 auto",
          placeItems: "center",
          borderRadius: 14,
          background: "#65f2bd",
          color: "#04141a",
          fontSize: 25,
          fontWeight: 900,
          boxShadow: "0 0 24px rgba(101,242,189,0.7)",
          transform: `scale(${pulse})`,
        }}
      >
        ✓
      </div>
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: "#65f2bd",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.14em",
          }}
        >
          {label}
        </div>
        <div
          style={{
            marginTop: 4,
            color: "#f7fbff",
            fontFamily: "Arial, 'Noto Sans TC', sans-serif",
            fontSize: locale === "ru" ? 19 : locale === "ja" ? 21 : 22,
            fontWeight: 850,
            letterSpacing: "-0.03em",
            lineHeight: 1.15,
            overflowWrap: "anywhere",
            textWrap: "balance",
          }}
        >
          {text}
        </div>
      </div>
    </div>
  );
}

export function StrategyAssemblyComposition({
  assemblyBus,
  eyebrow,
  frame,
  liveBuild,
  locale,
  modules,
  readyLabel,
  readyText,
  title,
}: StrategyAssemblyCompositionProps) {
  const scanX = interpolatePoints(frame % 90, [0, 89], [-15, 115]);

  return (
    <div
      data-i18n-ignore
      style={{
        position: "absolute",
        inset: 0,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 48%, rgba(139,99,255,0.2), transparent 48%), linear-gradient(145deg, #071529, #040a16 68%)",
        color: "white",
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: 0.22,
          backgroundImage:
            "linear-gradient(rgba(85,231,255,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(85,231,255,0.14) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${scanX}%`,
          width: 90,
          background: "linear-gradient(90deg, transparent, rgba(85,231,255,0.12), transparent)",
          filter: "blur(10px)",
          clipPath: "polygon(22% 0, 100% 0, 78% 100%, 0 100%)",
        }}
      />

      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          height: "100%",
          padding: "32px 40px 28px",
        }}
      >
        <div
          style={{
            display: "flex",
            minHeight: 75,
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 18,
          }}
        >
          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                color: "#55e7ff",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: locale === "ru" ? 12 : 13,
                fontWeight: 800,
                letterSpacing: "0.17em",
              }}
            >
              {eyebrow}
            </div>
            <div
              style={{
                marginTop: 7,
                color: "#f6f8ff",
                fontFamily: "Arial, 'Noto Sans TC', sans-serif",
                maxWidth: locale === "ru" ? 550 : 610,
                fontSize: locale === "ru" ? 23 : locale === "ja" ? 24 : 25,
                fontWeight: 850,
                letterSpacing: "-0.035em",
                lineHeight: 1.18,
                overflowWrap: "anywhere",
                textWrap: "balance",
              }}
            >
              {title}
            </div>
          </div>
          <div
            style={{
              flex: "0 0 auto",
              maxWidth: 150,
              padding: "8px 12px",
              border: "1px solid rgba(85,231,255,0.34)",
              borderRadius: 99,
              background: "rgba(85,231,255,0.07)",
              color: "#8bebff",
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
              fontSize: locale === "ru" ? 11 : 12,
              fontWeight: 750,
              letterSpacing: "0.1em",
              lineHeight: 1.2,
              textAlign: "center",
              overflowWrap: "anywhere",
            }}
          >
            {liveBuild}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 16,
            marginTop: 17,
          }}
        >
          {modules.map((module, index) => (
            <ModuleCard key={module.code} {...module} frame={frame} index={index} locale={locale} />
          ))}
        </div>

        <AssemblyBus frame={frame} label={assemblyBus} modules={modules} />
        <ReadyState frame={frame} label={readyLabel} text={readyText} locale={locale} />
      </div>
    </div>
  );
}

export function StrategyAssemblyPlayer({ embedded = false }: { embedded?: boolean }) {
  const frame = useLoopingFrame({
    durationInFrames: 180,
    fps: 30,
    reducedMotionFrame: 179,
  });
  const { locale, t } = useI18n();
  const translatedModules = moduleDefinitions.map((module) => ({
    ...module,
    code: t(module.code),
    name: t(module.name),
  }));

  return (
    <div
      aria-label={embedded ? undefined : t("策略模組依序加入並完成組裝的動畫")}
      className={embedded ? "deferred-player__content" : "strategy-assembly-player glass-panel"}
      role={embedded ? undefined : "img"}
    >
      <NativeAnimationStage>
        <StrategyAssemblyComposition
          assemblyBus={t("ASSEMBLY BUS / 03 MODULES")}
          eyebrow={t("VISUAL STRATEGY ASSEMBLY")}
          frame={frame}
          liveBuild={t("LIVE BUILD")}
          locale={locale}
          modules={translatedModules}
          readyLabel={t("STRATEGY READY")}
          readyText={t("自動化策略組裝完成")}
          title={t("選擇模組，建立你的交易流程")}
        />
      </NativeAnimationStage>
    </div>
  );
}
