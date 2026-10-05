import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

export function Dialog(props: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") props.onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [props]);
  return (
    <div className="backdrop" onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}>
      <div ref={ref} className={`dialog ${props.wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={props.title}>
        <header>
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onClose} aria-label={t("common.close")}>
            ×
          </button>
        </header>
        <div className="dialog-body">{props.children}</div>
      </div>
    </div>
  );
}

/** A toolbar button that opens a small dropdown of actions. */
export function Menu(props: { label: ReactNode; title?: string; testId?: string; disabled?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={props.title}
        data-testid={props.testId}
        disabled={props.disabled}
      >
        {props.label} ▾
      </button>
      {open && (
        <div className="menu-items" role="menu" onClick={() => setOpen(false)}>
          {props.children}
        </div>
      )}
    </div>
  );
}
