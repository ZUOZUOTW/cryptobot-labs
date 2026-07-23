"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

declare global {
  interface Navigator {
    standalone?: boolean;
  }
}

export function PwaInstallButton() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHelp, setShowIOSHelp] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isIOS = useSyncExternalStore(
    () => () => undefined,
    () => {
      const standalone = (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches)
        || navigator.standalone === true;
      return /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
    },
    () => false,
  );

  useEffect(() => {
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", capturePrompt);
    return () => window.removeEventListener("beforeinstallprompt", capturePrompt);
  }, []);

  useEffect(() => {
    if (!showIOSHelp) return;
    closeButtonRef.current?.focus();
    const dismiss = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowIOSHelp(false);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [showIOSHelp]);

  if (!installPrompt && !isIOS) return null;

  const install = async () => {
    if (!installPrompt) {
      setShowIOSHelp(true);
      return;
    }
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") setInstallPrompt(null);
  };

  return (
    <>
      <button className="site-nav__install" onClick={() => { void install(); }} type="button">
        安裝到手機
      </button>
      {showIOSHelp && (
        <div className="pwa-install-dialog" role="dialog" aria-describedby="pwa-install-steps" aria-labelledby="pwa-install-title" aria-modal="true">
          <div className="glass-panel pwa-install-dialog__card">
            <p className="eyebrow">ADD TO HOME SCREEN</p>
            <h2 id="pwa-install-title">加入 iPhone 主畫面</h2>
            <ol id="pwa-install-steps">
              <li>點選瀏覽器的「分享」按鈕。</li>
              <li>選擇「加入主畫面」。</li>
              <li>確認名稱後點選「加入」。</li>
            </ol>
            <button ref={closeButtonRef} className="button button--primary" onClick={() => setShowIOSHelp(false)} type="button">知道了</button>
          </div>
        </div>
      )}
    </>
  );
}
