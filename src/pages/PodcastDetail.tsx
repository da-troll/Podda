import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import { api } from '../api';
import { EpisodeRow } from '../components/EpisodeRow';
import { ConfirmModal } from '../components/ConfirmModal';
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Plus,
  Loader,
  SlidersHorizontal,
} from 'lucide-react';
import { BottomSheet } from '../components/BottomSheet';
import { useListRefresh } from '../hooks/useListRefresh';
import { usePreferences } from '../hooks/usePreferences';
import { triggerHint } from '../hints/HintManager';
import type {
  Podcast,
  Episode,
  Page,
  QueueSource,
  ChannelFilters,
} from '../types';

const PAGE_SIZE = 50;

interface PodcastDetailProps {
  podcastId: number;
  onNavigate: (page: Page) => void;
  onBack?: () => void;
}

export function PodcastDetail({
  podcastId,
  onNavigate,
  onBack,
}: PodcastDetailProps) {
  const [podcast, setPodcast] = useState<Podcast | null>(null);
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [showUnsubConfirm, setShowUnsubConfirm] = useState(false);
  const { preferences, loading: preferencesLoading } = usePreferences();
  const [filters, setFilters] = useState<ChannelFilters | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const loadedCount = useRef(PAGE_SIZE);
  const defaults = useCallback(
    (): ChannelFilters => ({
      sort: preferences.channelSort,
      hideCompleted: preferences.channelHideCompleted,
      status: 'any',
      released_after: 'any',
    }),
    [preferences],
  );
  useEffect(() => {
    if (!preferencesLoading) setFilters((current) => current ?? defaults());
  }, [preferencesLoading, defaults]);

  const fetchEpisodes = useCallback(
    async (append = false) => {
      if (!filters) return;
      const version = ++requestVersion.current;
      const offset = append ? loadedCount.current : 0;
      if (append) setLoadingMore(true);
      try {
        // Refresh every loaded page; the API caps each request at 200 rows.
        const limit = append
          ? PAGE_SIZE
          : Math.max(loadedCount.current, PAGE_SIZE);
        const rows: Episode[] = [];
        let total = 0;
        for (let fetched = 0; fetched < limit;) {
          const batchSize = Math.min(200, limit - fetched);
          const data = await api.getEpisodes(
            podcastId,
            batchSize,
            offset + fetched,
            filters,
          );
          if (version !== requestVersion.current) return;
          total = data.total;
          rows.push(...data.episodes);
          fetched += data.episodes.length;
          if (data.episodes.length < batchSize || offset + fetched >= total)
            break;
        }
        setEpisodes((previous) => (append ? [...previous, ...rows] : rows));
        loadedCount.current = offset + rows.length;
        setTotal(total);
        setError('');
      } catch (err) {
        if (version === requestVersion.current)
          setError((err as Error).message);
      } finally {
        if (version === requestVersion.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [podcastId, filters],
  );

  useEffect(() => {
    let live = true;
    api
      .getPodcast(podcastId)
      .then((value) => {
        if (live) setPodcast(value as Podcast);
      })
      .catch((err) => {
        if (live) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [podcastId]);
  useEffect(() => {
    if (!filters) return;
    loadedCount.current = PAGE_SIZE;
    setEpisodes([]);
    setTotal(0);
    setLoading(true);
    setLoadingMore(false);
    fetchEpisodes();
    return () => {
      requestVersion.current++;
    };
  }, [fetchEpisodes, filters]);
  const reloadEpisodes = useCallback(() => {
    void fetchEpisodes();
  }, [fetchEpisodes]);
  useListRefresh(reloadEpisodes);
  useEffect(() => {
    window.addEventListener('podda:progressSaved', reloadEpisodes);
    return () =>
      window.removeEventListener('podda:progressSaved', reloadEpisodes);
  }, [reloadEpisodes]);
  useEffect(() => {
    if (!loading && podcast && filters) triggerHint('channel-open');
  }, [loading, podcast, filters]);

  const closeFilters = useCallback(() => setShowFilters(false), []);
  const activeFilterCount = filters
    ? [
        filters.hideCompleted,
        filters.status !== 'any',
        filters.released_after !== 'any',
        filters.duration_min !== undefined,
        filters.duration_max !== undefined,
      ].filter(Boolean).length
    : 0;
  const updateFilters = (partial: Partial<ChannelFilters>) =>
    setFilters((current) => (current ? { ...current, ...partial } : current));
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await api.refreshPodcast(podcastId);
      await fetchEpisodes();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRefreshing(false);
    }
  };
  const markEpisode = async (id: number, played: boolean) => {
    try {
      await (played ? api.markPlayed(id) : api.markUnplayed(id));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const handleSubscribe = async () => {
    if (!podcast) return;
    setSubscribing(true);
    try {
      await api.subscribe(podcast.feed_url);
      setPodcast((prev) => (prev ? { ...prev, is_subscribed: true } : prev));
    } catch (err) {
      console.error(err);
    }
    setSubscribing(false);
  };

  const handleUnsubscribe = async () => {
    await api.unsubscribe(podcastId);
    onNavigate({ type: 'library' });
  };

  const queueSource = useMemo<QueueSource>(
    () => ({
      type: 'podcast',
      podcastId,
      sortOrder: filters?.sort ?? 'newest',
      filters: filters ?? undefined,
    }),
    [podcastId, filters],
  );

  const hasMore = episodes.length < total;

  if (preferencesLoading || (!podcast && loading) || !filters)
    return <div className="page-loading">Loading...</div>;
  if (!podcast || !filters)
    return <div className="page-loading">{error || 'Podcast not found'}</div>;

  return (
    <div className="page podcast-detail">
      <div className="page-header">
        <button
          className="btn-icon"
          onClick={() => (onBack ? onBack() : onNavigate({ type: 'library' }))}
        >
          <ArrowLeft size={20} />
        </button>
        <h1>{podcast.title}</h1>
        {podcast.is_subscribed ? (
          <button
            className="btn-danger btn-sm"
            onClick={() => setShowUnsubConfirm(true)}
          >
            <Trash2 size={14} /> Unsubscribe
          </button>
        ) : (
          <button
            className="btn-primary btn-sm"
            onClick={handleSubscribe}
            disabled={subscribing}
          >
            {subscribing ? (
              <>
                <Loader size={14} className="spinning" /> Subscribing…
              </>
            ) : (
              <>
                <Plus size={14} /> Subscribe
              </>
            )}
          </button>
        )}
      </div>

      <div className="podcast-hero">
        {podcast.artwork_url && (
          <img
            src={podcast.artwork_url}
            alt={podcast.title}
            className="podcast-hero-artwork"
          />
        )}
        <div className="podcast-hero-info">
          {podcast.author && (
            <div className="podcast-hero-author">{podcast.author}</div>
          )}
          {podcast.description && (
            <div
              className="podcast-hero-desc"
              dangerouslySetInnerHTML={{
                __html: DOMPurify.sanitize(podcast.description),
              }}
            />
          )}
        </div>
      </div>

      <div className="episode-list-header">
        <span>
          {episodes.length < total
            ? `${episodes.length} of ${total} episodes`
            : `${total} episodes`}
        </span>
        <div className="episode-list-header-actions">
          <select
            className="sort-select"
            aria-label="Episode order"
            value={filters.sort}
            onChange={(e) =>
              updateFilters({ sort: e.target.value as ChannelFilters['sort'] })
            }
          >
            <option value="newest">Newest first</option>
            <option value="oldest">Oldest first</option>
            <option value="shortest">Shortest first</option>
            <option value="longest">Longest first</option>
          </select>
          <button
            className={`filters-btn${activeFilterCount ? ' active' : ''}`}
            data-hint="channel-filters"
            aria-haspopup="dialog"
            onClick={() => setShowFilters(true)}
          >
            <SlidersHorizontal size={16} /> Filters
            {activeFilterCount > 0 && (
              <span className="filters-btn-count">{activeFilterCount}</span>
            )}
          </button>
          {podcast.is_subscribed && (
            <button
              className="btn-icon"
              onClick={handleRefresh}
              disabled={refreshing}
              title="Refresh"
            >
              <RefreshCw size={18} className={refreshing ? 'spinning' : ''} />
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-msg" role="alert">
          {error}{' '}
          <button className="btn-secondary" onClick={reloadEpisodes}>
            Retry
          </button>
        </div>
      )}
      {showFilters && (
        <BottomSheet
          title="Filter episodes"
          onClose={closeFilters}
          footer={
            <>
              <button
                className="btn-secondary"
                onClick={() => setFilters(defaults())}
              >
                Reset to defaults
              </button>
              <button className="btn-primary" onClick={closeFilters}>
                Done
              </button>
            </>
          }
        >
          <label className="sheet-toggle">
            <span>Hide completed</span>
            <input
              type="checkbox"
              role="switch"
              checked={filters.hideCompleted}
              onChange={(e) =>
                updateFilters({
                  hideCompleted: e.target.checked,
                  status:
                    e.target.checked && filters.status === 'played'
                      ? 'any'
                      : filters.status,
                })
              }
            />
          </label>
          <label>
            <span>Episode status</span>
            <select
              value={filters.status}
              onChange={(e) =>
                updateFilters({
                  status: e.target.value as ChannelFilters['status'],
                  hideCompleted:
                    e.target.value === 'played' ? false : filters.hideCompleted,
                })
              }
            >
              <option value="any">Any status</option>
              <option value="unplayed">Unplayed</option>
              <option value="in-progress">In progress</option>
              <option value="played">Played</option>
            </select>
          </label>
          <label>
            <span>Released</span>
            <select
              value={filters.released_after}
              onChange={(e) =>
                updateFilters({
                  released_after: e.target
                    .value as ChannelFilters['released_after'],
                })
              }
            >
              <option value="any">Any time</option>
              <option value="24h">Last 24 hours</option>
              <option value="3d">Last 3 days</option>
              <option value="7d">Last week</option>
              <option value="14d">Last 2 weeks</option>
              <option value="30d">Last month</option>
            </select>
          </label>
          {(['duration_min', 'duration_max'] as const).map((key) => (
            <label key={key}>
              <span>
                {key === 'duration_min'
                  ? 'Minimum duration'
                  : 'Maximum duration'}
              </span>
              <select
                value={filters[key] ?? ''}
                onChange={(e) => {
                  const value = e.target.value
                    ? Number(e.target.value)
                    : undefined;
                  const partial: Partial<ChannelFilters> = { [key]: value };
                  if (
                    key === 'duration_min' &&
                    value !== undefined &&
                    filters.duration_max !== undefined &&
                    value > filters.duration_max
                  )
                    partial.duration_max = value;
                  if (
                    key === 'duration_max' &&
                    value !== undefined &&
                    filters.duration_min !== undefined &&
                    value < filters.duration_min
                  )
                    partial.duration_min = value;
                  updateFilters(partial);
                }}
              >
                <option value="">No limit</option>
                <option value="900">15 min</option>
                <option value="1800">30 min</option>
                <option value="3600">1 hour</option>
                <option value="7200">2 hours</option>
              </select>
            </label>
          ))}
          <p className="hint">
            These filters apply to this channel view. Set your defaults in
            Settings →{' '}
            <a
              href="#settings"
              className="text-link"
              onClick={(e) => {
                e.preventDefault();
                onNavigate({ type: 'settings' });
              }}
            >
              Preferences
            </a>
            .
          </p>
        </BottomSheet>
      )}
      {loading && (
        <div className="page-loading" role="status">
          Loading episodes…
        </div>
      )}
      {!loading && !episodes.length && !error && (
        <div className="empty-state">
          No episodes match these filters.{' '}
          <button
            className="btn-secondary"
            onClick={() =>
              setFilters({
                sort: preferences.channelSort,
                hideCompleted: false,
                status: 'any',
                released_after: 'any',
              })
            }
          >
            Show all episodes
          </button>
        </div>
      )}
      <div className="episode-list">
        {episodes.map((ep, idx) => (
          <EpisodeRow
            key={ep.id}
            episode={ep}
            podcast={podcast}
            queue={episodes.slice(idx + 1)}
            queueSource={queueSource}
            onMarkPlayed={
              !ep.listen_completed
                ? () => void markEpisode(ep.id, true)
                : undefined
            }
            onMarkUnplayed={
              ep.listen_completed
                ? () => void markEpisode(ep.id, false)
                : undefined
            }
          />
        ))}
      </div>

      {hasMore && (
        <div className="load-more-container">
          <button
            className="btn-secondary"
            onClick={() => void fetchEpisodes(true)}
            disabled={loadingMore || loading}
          >
            {loadingMore
              ? 'Loading…'
              : `Load more (${total - episodes.length} remaining)`}
          </button>
        </div>
      )}

      {showUnsubConfirm && (
        <ConfirmModal
          title="Unsubscribe"
          message={`Unsubscribe from "${podcast.title}"? Your listen progress will be kept.`}
          confirmLabel="Unsubscribe"
          danger
          onConfirm={handleUnsubscribe}
          onCancel={() => setShowUnsubConfirm(false)}
        />
      )}
    </div>
  );
}
