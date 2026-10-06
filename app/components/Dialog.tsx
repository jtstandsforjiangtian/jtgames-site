"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
export default function Dialog({ title, children, onClose, wide = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current; const previous = document.activeElement as HTMLElement | null; dialog?.showModal(); return () => { dialog?.close(); previous?.focus(); }; }, []);
  return <dialog ref={ref} className={`dialog ${wide ? "wide" : ""}`} onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="dialog-body"><header className="dialog-header"><h2>{title}</h2><button className="icon-button" aria-label="关闭" onClick={onClose}><X size={20} /></button></header>{children}</div>
  </dialog>;
}
