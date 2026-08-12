"use client";

import { useEffect, useRef, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

interface DownloadConfirmationDialogProps {
  description: string;
  id: string;
  onCancel: () => void;
  onConfirm: () => void;
  restoreFocusOnConfirm?: boolean;
  title: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

export function DownloadConfirmationDialog({
  description,
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
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (!confirmedRef.current || restoreFocusOnConfirm) trigger?.focus();
    };
  }, [restoreFocusOnConfirm, triggerRef]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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

  if (typeof document === "undefined") return null;

  return createPortal(<div aria-labelledby={id} aria-modal="true" className="package-confirmation" onKeyDown={onKeyDown} role="dialog">
    <div className="package-confirmation__card glass-panel">
      <p className="eyebrow">ADVANCED MODE</p>
      <h3 id={id}>{title}</h3>
      <p>{description}</p>
      <p className="package-confirmation__warning">此套件只供研究、還原與交流，無法獨立交易，也不代表未來績效。</p>
      <div className="button-row">
        <button className="button button--ghost" onClick={onCancel} ref={cancelRef} type="button">取消</button>
        <button className="button button--primary" onClick={() => {
          confirmedRef.current = true;
          onConfirm();
        }} ref={confirmRef} type="button">確認下載</button>
      </div>
    </div>
  </div>, document.body);
}
