import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X } from 'lucide-react';

import { useOverlay } from '../hints/OverlayContext';

const LAST_SEEN_KEY = 'podda:last-seen-version';

interface WhatsNew {
  version: string;
  date: string;
  bullets: string[];
}

export function WhatsNewSheet() {
  const { setBlocked } = useOverlay();
  const [data, setData] = useState<WhatsNew | null>(null);

  useEffect(() => {
    fetch('/whats-new.json', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then((json: WhatsNew | null) => {
        if (!json || !json.version) { setBlocked(false); return; }
        const lastSeen = localStorage.getItem(LAST_SEEN_KEY);
        if (lastSeen === json.version) { setBlocked(false); return; }
        setData(json);
      })
      .catch(() => setBlocked(false));
  }, []);

  const dismiss = () => {
    if (data) localStorage.setItem(LAST_SEEN_KEY, data.version);
    setData(null);
    setBlocked(false);
  };

  if (!data) return null;

  return createPortal(
    <div className="whatsnew-backdrop" onClick={dismiss}>
      <div className="whatsnew-sheet" onClick={e => e.stopPropagation()} role="dialog" aria-labelledby="whatsnew-title">
        <div className="whatsnew-grip" />
        <button className="whatsnew-close" onClick={dismiss} aria-label="Close">
          <X size={18} />
        </button>
        <div className="whatsnew-header">
          <Sparkles size={22} className="whatsnew-icon" />
          <div>
            <h2 id="whatsnew-title" className="whatsnew-title">What's new in v{data.version}</h2>
            <div className="whatsnew-date">{data.date}</div>
          </div>
        </div>
        <ul className="whatsnew-bullets">
          {data.bullets.map((b, i) => <li key={i}>{b}</li>)}
        </ul>
        <button className="whatsnew-got-it" onClick={dismiss}>Got it</button>
      </div>
    </div>,
    document.body
  );
}
