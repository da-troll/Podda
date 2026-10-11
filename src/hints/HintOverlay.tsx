import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HintDef } from './types';
import { SwipeRightGesture } from './gestures/SwipeRight';
import { LongPressGesture } from './gestures/LongPress';
import { TapGesture } from './gestures/Tap';

interface HintOverlayProps {
  hint: HintDef;
  onDismiss: () => void;
}

const SPOT_PAD = 8;

/** Viewport rect of the hint's target, tracked across scroll and resize. */
function useTargetRect(selector?: string): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(null);
  useLayoutEffect(() => {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (!el) return;
    el.scrollIntoView({ block: 'center' });
    const measure = () => setRect(el.getBoundingClientRect());
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [selector]);
  return rect;
}

export function HintOverlay({ hint, onDismiss }: HintOverlayProps) {
  const Gesture =
    hint.gesture === 'swipe-right' ? SwipeRightGesture :
    hint.gesture === 'long-press' ? LongPressGesture :
    TapGesture;
  const rect = useTargetRect(hint.target);
  // Text goes on whichever side of the target has more room.
  const textBelow = rect ? rect.top + rect.height / 2 < window.innerHeight / 2 : false;

  return createPortal(
    <div className={`hint-overlay${rect ? ' hint-overlay--spotlight' : ''}`} onClick={onDismiss}>
      {rect ? (
        <>
          <div
            className="hint-spotlight"
            style={{
              left: rect.left - SPOT_PAD,
              top: rect.top - SPOT_PAD,
              width: rect.width + SPOT_PAD * 2,
              height: rect.height + SPOT_PAD * 2,
            }}
          />
          <div
            className="hint-anchor"
            /* On the bottom edge, so the dot does not cover the target's label. */
            style={{ left: rect.left + rect.width / 2, top: rect.bottom }}
          >
            <Gesture />
          </div>
          <p
            className="hint-text hint-text--anchored"
            style={
              textBelow
                ? { top: rect.bottom + SPOT_PAD + 48 }
                : { bottom: window.innerHeight - rect.top + SPOT_PAD + 28 }
            }
          >
            {hint.text}
          </p>
        </>
      ) : (
        <>
          <Gesture />
          <p className="hint-text">{hint.text}</p>
        </>
      )}
      <p className="hint-dismiss">Tap anywhere to dismiss</p>
    </div>,
    document.body
  );
}
