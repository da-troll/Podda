import { useState, useEffect, useRef, memo, type RefObject } from 'react';
import { Play, Pause, Check, MoreVertical, CheckCircle, RotateCcw, ListPlus, X as XIcon, Loader2 } from 'lucide-react';
import { usePlayerContext } from '../hooks/usePlayer';
import { AddToPlaylistModal } from './AddToPlaylistModal';
import type { Episode, Podcast, QueueSource } from '../types';

function formatDuration(secs: number | null): string {
  if (!secs) return '';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m} min`;
}

function formatTimeRemaining(position: number, duration: number): string {
  const remaining = Math.max(0, duration - position);
  return formatDuration(remaining) + ' left';
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface EpisodeRowProps {
  episode: Episode;
  podcast?: Podcast | null;
  showPodcast?: boolean;
  showTimeRemaining?: boolean;
  onMarkPlayed?: () => void;
  onMarkUnplayed?: () => void;
  onRemoveFromPlaylist?: () => void;
  hidePlaylistAction?: boolean;
  hideActions?: boolean;
  queue?: Episode[];
  queueSource?: QueueSource;
  onPlay?: () => void;
}

type PlayerActions = Pick<ReturnType<typeof usePlayerContext>, 'play' | 'togglePlay' | 'setQueue'>;

/** Reads the player context (which changes on every playback tick) and passes
 *  the row only what it shows, so a long list does not re-render each tick. */
export function EpisodeRow(props: EpisodeRowProps) {
  const player = usePlayerContext();
  const actions = useRef<PlayerActions>(player);
  actions.current = player;
  const isPlaying = player.episode?.id === props.episode.id;
  const rowState = !isPlaying ? 'idle' : player.loading ? 'loading' : player.playing ? 'playing' : 'paused';
  return <EpisodeRowView {...props} isPlaying={isPlaying} rowState={rowState} player={actions} />;
}

const EpisodeRowView = memo(function EpisodeRowView({ episode, podcast, showPodcast, showTimeRemaining, onMarkPlayed, onMarkUnplayed, onRemoveFromPlaylist, hidePlaylistAction, hideActions, queue, queueSource, onPlay, isPlaying, rowState, player: playerRef }: EpisodeRowProps & { isPlaying: boolean; rowState: 'idle' | 'loading' | 'playing' | 'paused'; player: RefObject<PlayerActions> }) {
  const player = playerRef.current!;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const completed = episode.listen_completed;
  const progress = episode.listen_position && episode.duration
    ? Math.floor((episode.listen_position / episode.duration) * 100)
    : 0;

  // Close menu on outside click (works even inside backdrop-filter stacking contexts)
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
    };
  }, [menuOpen]);

  // Always show the menu button (playlist add is universally available)
  const hasAnyAction = onMarkPlayed || onMarkUnplayed || onRemoveFromPlaylist || !hidePlaylistAction;

  return (
    <div className={`episode-row ${completed ? 'completed' : ''}`} data-episode-id={episode.id}>
      <button
        className="episode-play-btn"
        onClick={() => {
          if (isPlaying) {
            player.togglePlay();
          } else {
            if (queue) player.setQueue(queue, queueSource);
            player.play(episode, podcast);
            onPlay?.();
          }
        }}
      >
        {rowState === 'loading' ? <Loader2 size={18} className="spin" /> : rowState === 'playing' ? <Pause size={18} /> : <Play size={18} />}
      </button>

      <div className="episode-info">
        <div className="episode-title">{episode.title}</div>
        <div className="episode-meta">
          {showPodcast && episode.podcast_title && (
            <span className="episode-podcast-name">{episode.podcast_title}</span>
          )}
          <span>{formatDate(episode.pub_date)}</span>
          {showTimeRemaining && episode.listen_position && episode.duration ? (
            <span className="episode-time-remaining">{formatTimeRemaining(episode.listen_position, episode.duration)}</span>
          ) : (
            episode.duration && <span>{formatDuration(episode.duration)}</span>
          )}
          {completed && <Check size={14} className="episode-check" />}
        </div>
        {progress > 0 && !completed && (
          <div className="episode-progress-bar">
            <div className="episode-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {hasAnyAction && !hideActions && (
        <div className="episode-actions" ref={menuRef}>
          <button className="btn-icon episode-menu-btn" onClick={() => setMenuOpen(!menuOpen)}>
            <MoreVertical size={16} />
          </button>
          {menuOpen && (
              <div className="episode-menu">
                {!hidePlaylistAction && (
                  <button onClick={() => { setMenuOpen(false); setShowAddToPlaylist(true); }}>
                    <ListPlus size={15} /> Add to playlist
                  </button>
                )}
                {onRemoveFromPlaylist && (
                  <button onClick={() => { onRemoveFromPlaylist(); setMenuOpen(false); }}>
                    <XIcon size={15} /> Remove from playlist
                  </button>
                )}
                {onMarkPlayed && (
                  <button onClick={() => { onMarkPlayed(); setMenuOpen(false); }}>
                    <CheckCircle size={15} /> Mark as played
                  </button>
                )}
                {onMarkUnplayed && (
                  <button onClick={() => { onMarkUnplayed(); setMenuOpen(false); }}>
                    <RotateCcw size={15} /> Mark as unplayed
                  </button>
                )}
              </div>
          )}
        </div>
      )}

      {showAddToPlaylist && (
        <AddToPlaylistModal
          episodeId={episode.id}
          onClose={() => setShowAddToPlaylist(false)}
        />
      )}
    </div>
  );
});
