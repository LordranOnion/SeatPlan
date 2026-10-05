import { useSyncExternalStore } from "react";

/** Minimal external store for UI state shared across distant components. */
export function createStore<T extends object>(initial: T) {
  let state = initial;
  const listeners = new Set<() => void>();
  const store = {
    get: () => state,
    set(patch: Partial<T> | ((s: T) => Partial<T>)) {
      const p = typeof patch === "function" ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    use<S>(selector: (s: T) => S): S {
      return useSyncExternalStore(store.subscribe, () => selector(state));
    },
  };
  return store;
}
