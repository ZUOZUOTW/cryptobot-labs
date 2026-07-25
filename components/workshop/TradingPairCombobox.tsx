"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { WeexTradingPair } from "../../lib/weex-market-catalog";

interface TradingPairComboboxProps {
  pairs: WeexTradingPair[];
  value: string;
  onChange: (symbol: string) => void;
}

const pairLabel = (pair: WeexTradingPair) => `${pair.baseAsset} / ${pair.quoteAsset || "USDT"}`;

export function TradingPairCombobox({ pairs, value, onChange }: TradingPairComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listboxRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const selectedPair = pairs.find((pair) => pair.symbol === value) ?? pairs[0];
  const normalizedQuery = query.trim().toUpperCase().replace(/[\s/_-]+/g, "");
  const filteredPairs = useMemo(() => (
    normalizedQuery.length === 0
      ? pairs
      : pairs.filter((pair) => (
        pair.symbol.includes(normalizedQuery)
        || pair.baseAsset.includes(normalizedQuery)
        || pair.quoteAsset.includes(normalizedQuery)
      ))
  ), [normalizedQuery, pairs]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
  }, [open]);

  const close = (restoreFocus = false) => {
    setOpen(false);
    setQuery("");
    if (restoreFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectPair = (symbol: string) => {
    onChange(symbol);
    close(true);
  };

  const optionElements = () => (
    Array.from(listboxRef.current?.querySelectorAll<HTMLElement>("[role='option']") ?? [])
  );

  const focusOption = (index: number) => {
    const options = optionElements();
    options[Math.max(0, Math.min(index, options.length - 1))]?.focus();
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "Enter" && filteredPairs.length === 1) {
      event.preventDefault();
      selectPair(filteredPairs[0].symbol);
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number, symbol: string) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) searchRef.current?.focus();
      else focusOption(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusOption(filteredPairs.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      selectPair(symbol);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    }
  };

  return (
    <div className="pair-combobox" ref={rootRef}>
      <button
        aria-controls="trading-pair-listbox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="交易對"
        className="pair-combobox__trigger"
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          } else if (event.key === "Escape" && open) {
            event.preventDefault();
            close();
          }
        }}
        ref={triggerRef}
        role="combobox"
        type="button"
      >
        <span>{selectedPair ? pairLabel(selectedPair) : value}</span>
        <small>{open ? "收起選單" : "搜尋或選擇"}</small>
      </button>

      {open && (
        <div className="pair-combobox__popover">
          <label className="pair-combobox__search">
            <span>快速搜尋交易對</span>
            <input
              aria-label="快速搜尋交易對"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="例如 BTC、ETH、SOL"
              ref={searchRef}
              role="searchbox"
              type="search"
              value={query}
            />
          </label>
          <div className="pair-combobox__summary" aria-live="polite">
            {normalizedQuery ? `找到 ${filteredPairs.length} 個交易對` : `共 ${pairs.length} 個交易對`}
          </div>
          <div
            aria-label="交易對搜尋結果"
            className="pair-combobox__listbox"
            id="trading-pair-listbox"
            ref={listboxRef}
            role="listbox"
          >
            {filteredPairs.map((pair, index) => (
              <button
                aria-selected={pair.symbol === value}
                className="pair-combobox__option"
                key={pair.symbol}
                onClick={() => selectPair(pair.symbol)}
                onKeyDown={(event) => onOptionKeyDown(event, index, pair.symbol)}
                role="option"
                tabIndex={-1}
                type="button"
              >
                <span>{pairLabel(pair)}</span>
                <small>{pair.symbol}{pair.maxLeverage > 1 ? ` · 最高 ${pair.maxLeverage}×` : ""}</small>
              </button>
            ))}
            {filteredPairs.length === 0 && (
              <p className="pair-combobox__empty">找不到符合「{query.trim()}」的交易對</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
