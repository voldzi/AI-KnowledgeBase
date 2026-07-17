"use client";

import { useEffect, useState } from "react";

export function PwaRegistration() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    let active = true;
    let refreshing = false;
    const handleControllerChange = () => {
      if (refreshing) {
        return;
      }
      refreshing = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    void navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(
      (registration) => {
        if (!active) {
          return;
        }
        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) {
            return;
          }
          installing.addEventListener("statechange", () => {
            if (
              active
              && installing.state === "installed"
              && navigator.serviceWorker.controller
            ) {
              setWaitingWorker(registration.waiting ?? installing);
            }
          });
        });
      },
    );

    return () => {
      active = false;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  if (!waitingWorker) {
    return null;
  }

  return (
    <aside className="akb-pwa-update" role="status" aria-live="polite">
      <span>Je dostupná nová verze AKB Chatu.</span>
      <button
        type="button"
        onClick={() => waitingWorker.postMessage({ type: "SKIP_WAITING" })}
      >
        Aktualizovat
      </button>
      <button
        type="button"
        className="akb-pwa-update__dismiss"
        aria-label="Zavřít oznámení"
        onClick={() => setWaitingWorker(null)}
      >
        ×
      </button>
    </aside>
  );
}
