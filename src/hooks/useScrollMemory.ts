import { useEffect, useRef } from 'react';
import { api } from '../api';
import type { ScrollPosition } from '../types';

export interface ScrollKey { scope: 'podcast' | 'playlist'; id: number; sort: string; }

const container = () => document.querySelector<HTMLElement>('.main-content');

/** The first episode row not scrolled past, and how far its top sits below the
 *  container top. Rows carry data-episode-id (EpisodeRow). */
export function readAnchor(): ScrollPosition | null {
  const c = container();
  if (!c) return null;
  const top = c.getBoundingClientRect().top;
  const rows = c.querySelectorAll<HTMLElement>('[data-episode-id]');
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].getBoundingClientRect();
    if (r.bottom > top + 1)
      return { episodeId: Number(rows[i].dataset.episodeId), index: i, offset: Math.round(r.top - top) };
  }
  return null;
}

/** Scroll so row `index` sits `offset` px below the container top. */
export function scrollToRow(index: number, offset: number): boolean {
  const c = container();
  const row = c?.querySelectorAll<HTMLElement>('[data-episode-id]')[index];
  if (!c || !row) return false;
  c.scrollTop += row.getBoundingClientRect().top - c.getBoundingClientRect().top - offset;
  return true;
}

/**
 * Saves the scroll anchor for `key` when the user leaves the list (page change,
 * sort change, app hidden). `armed` stays false until the page has restored,
 * so the initial top-of-page position never overwrites a saved one.
 * Pass key = null when the setting is off.
 */
export function useScrollMemory(key: ScrollKey | null, armed: boolean) {
  const last = useRef<ScrollPosition | null>(null);
  const sent = useRef('');
  useEffect(() => {
    if (!key || !armed) return;
    const c = container();
    if (!c) return;
    let timer = 0;
    const track = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { last.current = readAnchor(); }, 150);
    };
    // live: read the DOM now. On cleanup the DOM may already show the next
    // page (or nothing), so use the last anchor tracked while scrolling.
    const flush = (live: boolean) => {
      window.clearTimeout(timer);
      const anchor = live ? readAnchor() : last.current;
      if (!anchor) return;
      const sig = JSON.stringify(anchor);
      if (sig === sent.current) return;
      sent.current = sig;
      api.saveScroll(key.scope, key.id, key.sort, anchor).catch(() => { sent.current = ''; });
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flush(true); };
    const onPageHide = () => flush(true);
    // Only a scroll under this key records a position: right after a sort
    // change the screen still shows the old order's rows.
    last.current = null;
    sent.current = ''; // dedupe is per key
    c.addEventListener('scroll', track, { passive: true });
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      flush(false);
      c.removeEventListener('scroll', track);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [key?.scope, key?.id, key?.sort, armed]);
}
