"use client";

import { usePathname } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { BotDefinition } from "../lib/types";
import { useI18n } from "./I18nProvider";
import {
  CloudStrategyLauncher,
  type CloudAutomationTemplate,
} from "./runs/CloudStrategyLauncher";

interface StrategyLaunchButtonProps {
  bot: BotDefinition;
  className?: string;
}

const templateFor = (bot: BotDefinition): CloudAutomationTemplate => ({
  config: {
    id: bot.id,
    name: bot.name,
    exchange: bot.exchange,
    market: bot.market,
    symbol: bot.symbol,
    timeframe: bot.timeframe,
    logicMode: bot.logicMode,
    tradeDirection: bot.tradeDirection,
    leverage: bot.leverage,
    blocks: bot.blocks,
  },
  description: bot.description,
  riskNote: bot.riskNote,
  tags: bot.tags,
});

export function StrategyLaunchButton({ bot, className = "button button--primary" }: StrategyLaunchButtonProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const pathname = usePathname();
  const template = useMemo(() => templateFor(bot), [bot]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const dialog = open && typeof document !== "undefined" ? createPortal(
    <div
      className="strategy-launch-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOpen(false);
      }}
      role="presentation"
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="strategy-launch-dialog__card glass-panel"
        role="dialog"
      >
        <button
          aria-label={t(`關閉 ${bot.name} 啟動視窗`)}
          className="strategy-launch-dialog__close"
          onClick={() => setOpen(false)}
          type="button"
        >
          <span aria-hidden="true">×</span>
        </button>
        <CloudStrategyLauncher
          authReturnTo={pathname || `/bots/${bot.id}`}
          templates={[template]}
          titleId={titleId}
          variant="dialog"
        />
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={t(`啟動策略：${bot.name}`)}
        className={className}
        onClick={() => setOpen(true)}
        type="button"
      >
        啟動策略
      </button>
      {dialog}
    </>
  );
}
