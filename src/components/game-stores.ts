import { useSyncExternalStore } from "react";

/**
 * Two small stores for the game page, shared by components that are siblings under a server page
 * and therefore cannot pass props to one another: the live panel publishes the score it polls so
 * the phone's compact head shows the same number, and any region can offer the phone's action bar
 * the one action it owns. Plain external stores (not React state) so a component can register in
 * an effect without the compiler's set-state-in-effect rule getting in the way.
 */

export interface LiveScore {
  state: "pre" | "in" | "post";
  clock: string;
  period: number;
  home: { abbr: string; score: number };
  away: { abbr: string; score: number };
}

function createStore<T>(initial: T) {
  let value = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: T) => {
      if (Object.is(next, value)) return;
      value = next;
      listeners.forEach((l) => l());
    },
    subscribe: (l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
}

const liveScore = createStore<LiveScore | null>(null);

/** The live panel writes here on every poll; the sticky head reads it, or its server-rendered fallback. */
export const publishLiveScore = (score: LiveScore | null) => liveScore.set(score);
export function useLiveScore(): LiveScore | null {
  return useSyncExternalStore(liveScore.subscribe, liveScore.get, () => null);
}

/**
 * An action a region of the page offers the phone's bottom bar: what to say, what to do, and the
 * element that already holds the same control inline — the bar shows the action only while that
 * element is off screen, so the screen never carries the same primary button twice.
 */
export interface PageAction {
  id: string;
  label: string;
  /** Higher wins when more than one region offers an action. */
  priority: number;
  run: () => void;
  anchor: () => Element | null;
  busy?: boolean;
  testId?: string;
  /** The region does not know its action yet (a first poll in flight): the bar shows nothing rather
   *  than a lesser action that is about to be replaced. */
  pending?: boolean;
}

const actions = createStore<PageAction[]>([]);

/** Register (or replace) one region's action; pass null to withdraw it. */
export function offerAction(id: string, action: Omit<PageAction, "id"> | null) {
  const rest = actions.get().filter((a) => a.id !== id);
  actions.set(action ? [...rest, { id, ...action }].sort((a, b) => b.priority - a.priority) : rest);
}

const EMPTY: PageAction[] = [];
export function usePageActions(): PageAction[] {
  return useSyncExternalStore(actions.subscribe, actions.get, () => EMPTY);
}
