import { useEffect, useRef } from "react";

const APP_BACK_HISTORY_MARKER = "__edgeever_app_back__";

export const isTextEntryTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  Boolean(target.closest("input, textarea, select, [contenteditable='true'], [role='textbox'], .ProseMirror"));

export type BrowserBackLayer = {
  id: string;
  onBack: () => void;
};

let browserBackLayerCounter = 0;
let browserBackLayerPopStateAttached = false;
let browserBackLayerSuppressNextPopState = false;
const browserBackLayerStack: BrowserBackLayer[] = [];

const getBrowserBackMarker = () =>
  window.history.state && typeof window.history.state === "object"
    ? (window.history.state as Record<string, unknown>)[APP_BACK_HISTORY_MARKER]
    : null;

const removeBrowserBackLayer = (id: string) => {
  for (let index = browserBackLayerStack.length - 1; index >= 0; index -= 1) {
    if (browserBackLayerStack[index]?.id === id) {
      browserBackLayerStack.splice(index, 1);
    }
  }
};

const hasBrowserBackLayer = (id: string) => browserBackLayerStack.some((layer) => layer.id === id);

const ensureBrowserBackLayerListener = () => {
  if (browserBackLayerPopStateAttached) {
    return;
  }

  window.addEventListener("popstate", () => {
    if (browserBackLayerSuppressNextPopState) {
      browserBackLayerSuppressNextPopState = false;
      return;
    }

    const layer = browserBackLayerStack.at(-1);

    if (!layer) {
      return;
    }

    removeBrowserBackLayer(layer.id);
    layer.onBack();
  });
  browserBackLayerPopStateAttached = true;
};

export const useBrowserBackLayer = (active: boolean, onBack: () => void) => {
  const idRef = useRef("");
  const onBackRef = useRef(onBack);

  if (!idRef.current) {
    browserBackLayerCounter += 1;
    idRef.current = `edgeever-back-layer-${browserBackLayerCounter}`;
  }

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!active) {
      return;
    }

    ensureBrowserBackLayerListener();

    const id = idRef.current;
    const currentState =
      window.history.state && typeof window.history.state === "object" ? window.history.state : {};
    const layer: BrowserBackLayer = {
      id,
      onBack: () => onBackRef.current(),
    };

    browserBackLayerStack.push(layer);
    window.history.pushState(
      {
        ...currentState,
        [APP_BACK_HISTORY_MARKER]: id,
      },
      "",
      window.location.href
    );

    return () => {
      removeBrowserBackLayer(id);

      window.setTimeout(() => {
        if (hasBrowserBackLayer(id) || getBrowserBackMarker() !== id) {
          return;
        }

        browserBackLayerSuppressNextPopState = true;
        window.history.back();
      }, 0);
    };
  }, [active]);
};
