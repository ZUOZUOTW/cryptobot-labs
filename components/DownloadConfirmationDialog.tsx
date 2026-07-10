"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

interface DownloadConfirmationDialogProps {
  description: string;
  eyebrow?: string;
  id: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusOnConfirm?: boolean;
  title: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function DownloadConfirmationDialog({
  description,
  eyebrow = "SIMULATION PACKAGE",
  id,
  onCancel,
  onConfirm,
  restoreFocusOnConfirm = true,
  title,
  triggerRef,
}: DownloadConfirmationDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);

  useEffect(() => {
    const trigger = triggerRef.current;
    cancelRef.current?.focus();
    return () => {
      if (!confirmedRef.current || restoreFocusOnConfirm) trigger?.focus();
    };
  }, [restoreFocusOnConfirm, triggerRef]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === cancelRef.current) {
      event.preventDefault();
      confirmRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === confirmRef.current) {
      event.preventDefault();
      cancelRef.current?.focus();
    }
  };

  return (
    <div aria-labelledby={id} aria-modal="true" className="package-confirmation" onKeyDown={handleKeyDown} role="dialog">
      <div className="package-confirmation__card glass-panel">
        <p className="eyebrow">{eyebrow}</p>
        <h3 id={id}>{title}</h3>
        <p>{description}</p>
        <div className="button-row">
          <button className="button button--ghost" onClick={onCancel} ref={cancelRef} type="button">取消</button>
          <button
            className="button button--primary"
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
            ref={confirmRef}
            type="button"
          >確認下載</button>
        </div>
      </div>
    </div>
  );
}
