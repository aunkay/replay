import { useEffect } from 'react';

/** Visual viewport follows Safari chrome and the software keyboard in WKWebView. */
export function useMobileViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Let browser accessibility zoom work normally; never constrain its scale.
        if (viewport && viewport.scale !== 1) return;
        root.style.setProperty(
          '--app-viewport-height',
          `${viewport?.height ?? window.innerHeight}px`,
        );
        root.style.setProperty(
          '--app-viewport-top',
          `${viewport?.offsetTop ?? 0}px`,
        );
        const editing = document.activeElement?.matches(
          'input:not([type="range"]):not([type="color"]),textarea,[contenteditable="true"]',
        );
        const occluded =
          window.innerHeight - (viewport?.height ?? window.innerHeight);
        root.dataset.keyboardOpen =
          editing && occluded > 120 ? 'true' : 'false';
      });
    };
    update();
    window.addEventListener('resize', update);
    viewport?.addEventListener('resize', update);
    viewport?.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', update);
      viewport?.removeEventListener('resize', update);
      viewport?.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      root.style.removeProperty('--app-viewport-height');
      root.style.removeProperty('--app-viewport-top');
      delete root.dataset.keyboardOpen;
    };
  }, []);
}
