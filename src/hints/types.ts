export type HintTrigger = 'app-mount' | 'player-open' | 'channel-open' | 'manual';

export type HintGesture = 'swipe-right' | 'long-press' | 'tap';

export interface HintDef {
  /**
   * Stable identifier. Combined with `version` to form the localStorage key:
   * `podda:hint-<id>-v<version>`. Bump version to re-show after a feature change.
   */
  id: string;

  /** Increment to re-show this hint to users who previously dismissed it. */
  version: number;

  /** When should the hint manager consider showing this hint. */
  trigger: HintTrigger;

  /** Animation to use inside the overlay. */
  gesture: HintGesture;

  /** Instruction text. Keep short — one sentence. */
  text: string;

  /** CSS selector of the element to spotlight. The overlay cuts a hole
   *  around it and points the gesture at it; without one the gesture is
   *  centred on screen. */
  target?: string;

  /** Optional runtime predicate — e.g. only show on touch devices. */
  condition?: () => boolean;
}
