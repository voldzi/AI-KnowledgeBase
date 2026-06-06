"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

type AnchorRect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;

interface PortalPopoverProps {
  anchorRect: AnchorRect | null;
  children: ReactNode;
  className?: string;
  onClose: () => void;
  open: boolean;
  width?: number;
}

export function PortalPopover({ anchorRect, children, className, onClose, open, width = 320 }: PortalPopoverProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    const closeOnPointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!target?.closest(".stratos-portal-popover")) {
        onClose();
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("pointerdown", closeOnPointerDown);
    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("pointerdown", closeOnPointerDown);
    };
  }, [onClose, open]);

  if (!open || !anchorRect) {
    return null;
  }

  const style = {
    left: Math.max(12, anchorRect.right - width),
    top: anchorRect.bottom + 8,
    width
  };

  return createPortal(
    <div className={["stratos-portal-popover", className].filter(Boolean).join(" ")} style={style}>
      {children}
    </div>,
    document.body
  );
}
