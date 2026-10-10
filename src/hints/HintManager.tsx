import { useEffect, useState, useCallback } from 'react';
import { useOverlay } from './OverlayContext';
import { HINTS, hintStorageKey } from './registry';
import { HintOverlay } from './HintOverlay';
import type { HintDef, HintTrigger } from './types';

function isSeen(def: HintDef): boolean {
  return !!localStorage.getItem(hintStorageKey(def));
}

function markSeen(def: HintDef): void {
  localStorage.setItem(hintStorageKey(def), '1');
}

/** Find the first unseen hint whose trigger + condition match. */
function pickHint(trigger: HintTrigger): HintDef | null {
  for (const def of HINTS) {
    if (def.trigger !== trigger) continue;
    if (def.condition && !def.condition()) continue;
    if (isSeen(def)) continue;
    return def;
  }
  return null;
}

/**
 * Imperatively trigger a named hint (e.g. after a feature mount).
 * `window.dispatchEvent(new CustomEvent('podda:hint', { detail: 'player-open' }))`
 */
export const HINT_EVENT = 'podda:hint';

export function triggerHint(trigger: HintTrigger) {
  window.dispatchEvent(new CustomEvent(HINT_EVENT, { detail: trigger }));
}

export function HintManager() {
  const { blocked } = useOverlay();
  const [pending, setPending] = useState<HintTrigger[]>(['app-mount']);
  const [active, setActive] = useState<HintDef | null>(null);
  const dismiss = useCallback(() => {
    if (active) markSeen(active);
    setActive(null);
  }, [active]);
  useEffect(() => {
    (window as any).__poddaDismissHint = dismiss;
    return () => { delete (window as any).__poddaDismissHint; };
  }, [dismiss]);
  useEffect(() => {
    if (localStorage.getItem('podda:swipe-hint-v1')) localStorage.setItem('podda:hint-sidebar-swipe-v1', '1');
    const onTrigger = (event: Event) => {
      const trigger = (event as CustomEvent<HintTrigger>).detail;
      if (trigger) setPending(previous => previous.includes(trigger) ? previous : [...previous, trigger]);
    };
    window.addEventListener(HINT_EVENT, onTrigger);
    return () => window.removeEventListener(HINT_EVENT, onTrigger);
  }, []);
  useEffect(() => {
    if (blocked || active || !pending.length) return;
    const trigger = pending[0];
    // A channel may have been left while another overlay was showing.
    if (trigger !== 'channel-open' || window.location.hash.startsWith('#podcast/')) {
      const next = pickHint(trigger);
      if (next) setActive(next);
    }
    setPending(previous => previous.slice(1));
  }, [blocked, active, pending]);
  if (!active || blocked) return null;
  return <HintOverlay hint={active} onDismiss={dismiss} />;
}

/** Dismiss the currently-active hint (if any) — for when the user performs
 *  the gesture the hint was teaching. */
export function dismissActiveHint() {
  const fn = (window as any).__poddaDismissHint;
  if (typeof fn === 'function') fn();
}
