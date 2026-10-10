import { Play, Pause, SkipForward, Loader2 } from 'lucide-react';
import { usePlayerContext } from '../../hooks/usePlayer';
import { hapticSelection } from './haptics';

interface Props {
  onExpand: () => void;
}

export function MiniPlayer({ onExpand }: Props) {
  const player = usePlayerContext();
  if (!player.episode) return null;

  const artwork = player.episode.artwork_url || player.episode.podcast_artwork_url || player.podcast?.artwork_url;
  const upNext = player.autoPlay && player.queue.length > 0 ? player.queue[0] : null;
  const livePct = player.duration > 0 ? (player.position / player.duration) * 100 : 0;

  const handlePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    hapticSelection();
    player.togglePlay();
  };

  const handleSkip = (e: React.MouseEvent) => {
    e.stopPropagation();
    hapticSelection();
    player.skipForward();
  };

  return (
    <div className="mini-player"
      data-episode-title={player.episode.title}
      data-podcast-title={player.episode.podcast_title || player.podcast?.title || ''}
      data-artwork-url={artwork || ''}
      onClick={onExpand} role="button" tabIndex={0}>
      <div className="mini-player-progress">
        <div className="mini-player-progress-fill" style={{ width: `${livePct}%` }} />
      </div>
      <div className="mini-player-body">
        {artwork && <img src={artwork} alt="" className="mini-player-artwork" />}
        <div className="mini-player-text">
          <div className="mini-player-title">{player.episode.title}</div>
          <div className="mini-player-subtitle">
            {upNext
              ? <span className="mini-player-up-next">Up next: {upNext.title}</span>
              : <span>{player.episode.podcast_title || player.podcast?.title}</span>
            }
          </div>
        </div>
        <button className="mini-player-btn" onClick={handlePlay} aria-label={player.playing ? 'Pause' : 'Play'}>
          {player.loading ? <Loader2 size={22} className="spin" /> : player.playing ? <Pause size={22} /> : <Play size={22} />}
        </button>
        <button className="mini-player-btn" onClick={handleSkip} aria-label="Skip forward 15 seconds">
          <SkipForward size={20} />
        </button>
      </div>
    </div>
  );
}
