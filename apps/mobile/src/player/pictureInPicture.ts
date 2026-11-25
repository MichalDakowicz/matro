const transitionGrace = 900;

export function createPictureInPictureLifecycle(save: () => void, pause: () => void) {
  let foreground = true, entering = false, floating = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const clear = () => { clearTimeout(timer); timer = undefined; };
  const settle = () => {
    clear();
    timer = setTimeout(() => {
      timer = undefined;
      entering = false;
      if (!foreground && !floating) pause();
    }, transitionGrace);
  };

  return {
    isFloating: () => floating,
    appState(active: boolean, autoEnter: boolean) {
      foreground = active;
      if (active) { if (!entering) clear(); return; }
      save();
      if (floating) return;
      // AppState can arrive before the Android PiP callback, including on Home.
      if (entering || autoEnter) settle();
      else pause();
    },
    request() { entering = true; settle(); },
    failed() { entering = false; clear(); if (!foreground && !floating) pause(); },
    started() { floating = true; entering = false; clear(); save(); },
    stopped() {
      floating = false;
      entering = false;
      save();
      // A close stays in the background; expanding the window can foreground us next.
      if (!foreground) settle();
    },
    dispose: clear,
  };
}
