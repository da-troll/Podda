import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { api } from '../api';
import { EpisodeRow } from '../components/EpisodeRow';
import { SmartPlaylistBuilder, filterSummary } from '../components/SmartPlaylistBuilder';
import { ArrowLeft, Trash2, GripVertical, SkipForward, ListEnd, Settings2, Zap } from 'lucide-react';
import { ConfirmModal } from '../components/ConfirmModal';
import { BottomSheet } from '../components/BottomSheet';
import { useListRefresh } from '../hooks/useListRefresh';
import type { Playlist, Episode, SmartPlaylistRules, Page, QueueSource } from '../types';

interface PlaylistDetailProps {
  playlistId: number;
  onNavigate: (page: Page) => void;
}

const SORT_LABELS: Record<string, string> = {
  manual: 'Manual order',
  newest: 'Newest first',
  oldest: 'Oldest first',
  shortest: 'Shortest first',
  longest: 'Longest first',
};

export function PlaylistDetail({ playlistId, onNavigate }: PlaylistDetailProps) {
  const [playlist, setPlaylist] = useState<Playlist | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editSort, setEditSort] = useState('manual');
  const [editAutoRemove, setEditAutoRemove] = useState(true);
  const [editRules, setEditRules] = useState<SmartPlaylistRules>({});
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const dragItem = useRef<number | null>(null);
  const dragOver = useRef<number | null>(null);

  const closeSettings = useCallback(() => setShowSettings(false), []);

  const queueSource = useMemo<QueueSource>(() => ({
    type: 'playlist', playlistId,
  }), [playlistId]);

  const load = useCallback(async () => {
    try {
      const data = await api.getPlaylistEpisodes(playlistId) as { playlist: Playlist; episodes: Episode[] };
      setPlaylist(data.playlist);
      setEpisodes(data.episodes);
      setEditName(data.playlist.name);
      setEditSort(data.playlist.sort_order);
      setEditAutoRemove(data.playlist.auto_remove_completed);
      if (data.playlist.rules) setEditRules(data.playlist.rules);
    } catch (err) {
      console.error('Failed to load playlist:', err);
    } finally {
      setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => { load(); }, [load]);

  // Refresh episode rows in-place (without clobbering edit-form state).
  const reloadEpisodes = useCallback(async () => {
    try {
      const data = await api.getPlaylistEpisodes(playlistId) as { playlist: Playlist; episodes: Episode[] };
      setEpisodes(data.episodes);
    } catch {}
  }, [playlistId]);
  useListRefresh(reloadEpisodes);

  const handleRemove = async (episodeId: number) => {
    await api.removeFromPlaylist(playlistId, episodeId);
    setEpisodes(prev => prev.filter(ep => ep.id !== episodeId));
  };

  const handleQueuePlaylist = async (mode: 'next' | 'last') => {
    try {
      await api.queuePlaylist(playlistId, mode);
    } catch (err) {
      console.error('Failed to queue playlist:', err);
    }
  };

  const handleDelete = async () => {
    await api.deletePlaylist(playlistId);
    onNavigate({ type: 'playlists' });
  };

  const handleSaveSettings = async () => {
    try {
      const updateData: Record<string, unknown> = {
        name: editName,
        sort_order: editSort,
        auto_remove_completed: editAutoRemove,
      };
      if (playlist?.is_smart) {
        updateData.rules = editRules;
      }
      const updated = await api.updatePlaylist(playlistId, updateData) as Playlist;
      setPlaylist(updated);
      setShowSettings(false);
      load(); // always reload to reflect changes
    } catch (err) {
      console.error('Failed to update playlist:', err);
    }
  };

  // Drag reorder (manual playlists only)
  const handleDragStart = (index: number) => { dragItem.current = index; };
  const handleDragEnter = (index: number) => { dragOver.current = index; };
  const handleDragEnd = async () => {
    if (dragItem.current === null || dragOver.current === null || dragItem.current === dragOver.current) {
      dragItem.current = null;
      dragOver.current = null;
      return;
    }
    const reordered = [...episodes];
    const [removed] = reordered.splice(dragItem.current, 1);
    reordered.splice(dragOver.current, 0, removed);
    setEpisodes(reordered);
    dragItem.current = null;
    dragOver.current = null;
    try {
      await api.reorderPlaylist(playlistId, reordered.map(ep => ep.id));
    } catch (err) {
      console.error('Failed to save reorder:', err);
      load();
    }
  };

  if (loading) return <div className="page-loading">Loading...</div>;
  if (!playlist) return <div className="empty-state">Playlist not found.</div>;

  const isManual = !playlist.is_smart && playlist.sort_order === 'manual';
  const filters = playlist.is_smart && playlist.rules ? filterSummary(playlist.rules) : [];

  return (
    <div className="page playlist-detail">
      <div className="playlist-detail-header">
        <button className="btn-icon" onClick={() => onNavigate({ type: 'playlists' })}>
          <ArrowLeft size={20} />
        </button>
        <div className="playlist-detail-info">
          <h1>
            {playlist.is_smart && <Zap size={18} className="smart-icon" />}
            {playlist.name}
          </h1>
          <div className="playlist-detail-meta">
            {episodes.length} episodes · {SORT_LABELS[playlist.sort_order]}
            {playlist.auto_remove_completed && ' · Auto-hide completed'}
          </div>
        </div>
        <button className="btn-icon" aria-label="Playlist settings" aria-haspopup="dialog" onClick={() => setShowSettings(true)}>
          <Settings2 size={18} />
        </button>
      </div>

      {/* Smart playlist filter summary */}
      {playlist.is_smart && filters.length > 0 && !showSettings && (
        <div className="filter-summary">
          <span className="filter-summary-label">Filtered by:</span>
          {filters.map((f, i) => (
            <span key={i} className="filter-chip">{f}</span>
          ))}
        </div>
      )}

      {showSettings && (
        <BottomSheet
          title="Playlist settings"
          onClose={closeSettings}
          footer={
            <>
              <button className="btn-danger" onClick={() => { setShowSettings(false); setShowDeleteConfirm(true); }}>
                <Trash2 size={16} /> Delete
              </button>
              <button className="btn-primary" onClick={handleSaveSettings}>Save</button>
            </>
          }
        >
          <label>
            <span>Name</span>
            <input type="text" value={editName} onChange={e => setEditName(e.target.value)} />
          </label>

          {playlist.is_smart && (
            <SmartPlaylistBuilder rules={editRules} onChange={setEditRules} />
          )}

          <label>
            <span>Sort order</span>
            <select value={editSort} onChange={e => setEditSort(e.target.value)}>
              {!playlist.is_smart && <option value="manual">Manual (drag to reorder)</option>}
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="shortest">Shortest first</option>
              <option value="longest">Longest first</option>
            </select>
          </label>
          <label className="sheet-toggle">
            <span>Auto-hide completed episodes</span>
            <input type="checkbox" role="switch" checked={editAutoRemove} onChange={e => setEditAutoRemove(e.target.checked)} />
          </label>
        </BottomSheet>
      )}

      {episodes.length > 0 && (
        <div className="playlist-actions">
          <button className="btn-secondary" onClick={() => handleQueuePlaylist('next')}>
            <SkipForward size={14} /> Play Next
          </button>
          <button className="btn-secondary" onClick={() => handleQueuePlaylist('last')}>
            <ListEnd size={14} /> Play Last
          </button>
        </div>
      )}

      <div className="episode-list">
        {episodes.length === 0 ? (
          <div className="empty-state">
            <p>{playlist.is_smart
              ? 'No episodes match these filters. Try adjusting the rules.'
              : 'This playlist is empty. Add episodes from any podcast or episode list.'
            }</p>
          </div>
        ) : (
          episodes.map((ep, index) => (
            <div
              key={ep.id}
              className="playlist-episode-row"
              draggable={isManual}
              onDragStart={() => handleDragStart(index)}
              onDragEnter={() => handleDragEnter(index)}
              onDragEnd={handleDragEnd}
              onDragOver={e => e.preventDefault()}
            >
              {isManual && (
                <div className="drag-handle">
                  <GripVertical size={16} />
                </div>
              )}
              <div className="playlist-episode-content">
                <EpisodeRow
                  episode={ep}
                  showPodcast
                  queue={episodes.slice(index + 1)}
                  queueSource={queueSource}
                  onMarkPlayed={!ep.listen_completed ? async () => {
                    await api.markPlayed(ep.id);
                    load();
                  } : undefined}
                  onMarkUnplayed={ep.listen_completed ? async () => {
                    await api.markUnplayed(ep.id);
                    load();
                  } : undefined}
                  onRemoveFromPlaylist={!playlist.is_smart ? () => handleRemove(ep.id) : undefined}
                  hidePlaylistAction={playlist.is_smart}
                />
              </div>
            </div>
          ))
        )}
      </div>

      {showDeleteConfirm && (
        <ConfirmModal
          title="Delete Playlist"
          message={`Delete "${playlist.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
