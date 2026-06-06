"use client";

import { Check, ChevronDown, Maximize2, PanelRightOpen, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { PortalPopover } from "./portal-popover";

export type SurfaceWindowMode = "modal" | "fullscreen" | "sidebar";

export type SurfaceModeLabels = {
  fullscreen?: string;
  modal?: string;
  sidebar?: string;
};

interface SurfaceModeMenuProps {
  ariaLabel?: string;
  labels?: SurfaceModeLabels;
  mode: SurfaceWindowMode;
  onModeChange: (mode: SurfaceWindowMode) => void;
  popoverLabel?: string;
}

type AnchorRect = Pick<DOMRect, "top" | "right" | "bottom" | "left" | "width" | "height">;

const surfaceModeOrder: SurfaceWindowMode[] = ["modal", "fullscreen", "sidebar"];

export function surfaceModeLabel(mode: SurfaceWindowMode, labels?: SurfaceModeLabels) {
  if (mode === "fullscreen") return labels?.fullscreen ?? "Celá obrazovka";
  if (mode === "sidebar") return labels?.sidebar ?? "Postranní panel";
  return labels?.modal ?? "Okno";
}

function surfaceModeIcon(mode: SurfaceWindowMode) {
  if (mode === "fullscreen") return <Maximize2 size={17} aria-hidden="true" />;
  if (mode === "sidebar") return <PanelRightOpen size={17} aria-hidden="true" />;
  return <Square size={17} aria-hidden="true" />;
}

export function SurfaceModeMenu({
  ariaLabel = "Změnit režim okna",
  labels,
  mode,
  onModeChange,
  popoverLabel = "Režim okna"
}: SurfaceModeMenuProps) {
  const [anchorRect, setAnchorRect] = useState<AnchorRect | null>(null);
  const modeMenuLabel = surfaceModeLabel(mode, labels);

  useEffect(() => {
    setAnchorRect(null);
  }, [mode]);

  return (
    <>
      <button
        type="button"
        className="stratos-detail-mode-trigger"
        title={modeMenuLabel}
        aria-label={ariaLabel}
        aria-expanded={anchorRect ? "true" : "false"}
        onClick={(event) => setAnchorRect(anchorRect ? null : event.currentTarget.getBoundingClientRect())}
      >
        {surfaceModeIcon(mode)}
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <PortalPopover
        open={Boolean(anchorRect)}
        anchorRect={anchorRect}
        width={360}
        className="stratos-detail-mode-popover"
        onClose={() => setAnchorRect(null)}
      >
        <div className="stratos-detail-mode-menu" role="menu" aria-label={popoverLabel}>
          {surfaceModeOrder.map((option) => {
            const selected = option === mode;
            const label = surfaceModeLabel(option, labels);
            return (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                data-mode={option}
                className={selected ? "is-selected" : undefined}
                key={option}
                onClick={() => {
                  onModeChange(option);
                  setAnchorRect(null);
                }}
              >
                <span className={`stratos-detail-mode-preview is-${option}`} aria-hidden="true">
                  <span />
                </span>
                <strong>{label}</strong>
                {selected ? <Check size={18} aria-hidden="true" /> : null}
              </button>
            );
          })}
        </div>
      </PortalPopover>
    </>
  );
}
