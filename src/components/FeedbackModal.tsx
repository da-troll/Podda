import { useState, useEffect, useRef } from 'react';
import { clientHeaders } from '../api';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

interface FeedbackModalProps {
  onClose: () => void;
}

export function FeedbackModal({ onClose }: FeedbackModalProps) {
  const [topic, setTopic] = useState('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      if (modalRef.current) {
        modalRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim() || !details.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...clientHeaders() },
        body: JSON.stringify({ topic: topic.trim(), details: details.trim() }),
      });
      if (!res.ok) throw new Error('Failed');
      setDone(true);
    } catch {
      // stay open, let user retry
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-compact" ref={modalRef} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Submit Feedback</h2>
          <button className="btn-icon" onClick={onClose}><X size={20} /></button>
        </div>

        {done ? (
          <div className="feedback-done">
            <p>Thanks — feedback received.</p>
            <button className="btn-primary feedback-done-btn" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="modal-body">
              <label>
                <span>Topic</span>
                <input
                  type="text"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                  placeholder="e.g. Broken artwork, Skip button, Feature idea..."
                  autoFocus
                />
              </label>
              <label>
                <span>Details</span>
                <textarea
                  value={details}
                  onChange={e => setDetails(e.target.value)}
                  placeholder="e.g. The artwork for 'In Our Time' by BBC shows a broken image"
                  rows={5}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="submit"
                className="btn-primary"
                disabled={submitting || !topic.trim() || !details.trim()}
              >
                {submitting ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body
  );
}
