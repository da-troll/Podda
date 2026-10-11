import type { HintDef } from './types';

/**
 * Every user-facing hint in Podda. Order matters: if multiple hints match a
 * trigger, the first unseen one is shown. Aim for at most one new hint per
 * release to avoid hint fatigue.
 *
 * To re-show a hint after changing the feature, bump `version`.
 */
export const HINTS: HintDef[] = [
  {
    id: 'channel-filters', version: 2, trigger: 'channel-open', gesture: 'tap',
    target: '[data-hint="channel-filters"]',
    text: 'Tap Filters to hide completed episodes or filter by status, release date and length.',
  },
  {
    id: 'sidebar-swipe',
    version: 1,
    trigger: 'app-mount',
    gesture: 'swipe-right',
    text: 'You can now swipe right to open the navigation menu.',
    condition: () => 'ontouchstart' in window,
  },
  {
    id: 'mini-expand',
    version: 1,
    trigger: 'player-open',
    gesture: 'tap',
    text: 'Tap the player to see full controls.',
    condition: () => 'ontouchstart' in window,
  },
];

export function hintStorageKey(def: HintDef): string {
  return `podda:hint-${def.id}-v${def.version}`;
}
