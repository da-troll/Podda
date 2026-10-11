import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from 'react';
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
  Settings,
} from 'lucide-react';
import { useScrollMemory, scrollToRow } from '../hooks/useScrollMemory';
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
  ChannelSettings,
} from '../types';

const PAGE_SIZE = 50;
const SORT_LABELS: Record<ChannelFilters['sort'], string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  shortest: 'Shortest first',
  longest: 'Longest first',
};

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
  const [showSettings, setShowSettings] = useState(false);
  const [channelSettings, setChannelSettings] = useState<ChannelSettings | null>(null);
  const [loadingAll, setLoadingAll] = useState(false);
  // Scroll restore: done once per visit, before the scroll memory may save.
  const [restoreDone, setRestoreDone] = useState(false);
  const [pendingScroll, setPendingScroll] = useState<{ index: number; offset: number } | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const [error, setError] = useState('');
  const requestVersion = useRef(0);
  const loadedCount = useRef(PAGE_SIZE);
  const defaults = useCallback(
    (): ChannelFilters => ({
      sort: channelSettings?.sort ?? preferences.channelSort,
      hideCompleted:
        channelSettings?.hideCompleted ?? preferences.channelHideCompleted,
      status: 'any',
      released_after: 'any',
    }),
    [preferences, channelSettings],
  );
  const rememberScroll =
    channelSettings?.rememberScroll ?? preferences.rememberScroll;
  useEffect(() => {
    let live = true;
    api
      .getChannelSettings(podcastId)
      .catch(() => ({ sort: null, hideCompleted: null, rememberScroll: null }))
      .then((value) => {
        if (live) setChannelSettings(value);
      });
    return () => {
      live = false;
    };
  }, [podcastId]);
  useEffect(() => {
    if (!preferencesLoading && channelSettings)
      setFilters((current) => current ?? defaults());
  }, [preferencesLoading, channelSettings, defaults]);

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
        if (version === requestVersion.current) {
          setError((err as Error).message);
          setRestoreDone(true); // a failed load must not hold the scroll memory off
        }
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
    if (!loading && podcast && filters && restoreDone)
      triggerHint('channel-open');
  }, [loading, podcast, filters, restoreDone]);

  // Restore the saved scroll anchor once, after the first page loads. The
  // server says where the saved episode (or the next visible one) now sits,
  // so we load pages up to it before scrolling.
  useEffect(() => {
    if (restoreDone || loading || !filters || !channelSettings) return;
    if (!rememberScroll) {
      setRestoreDone(true);
      return;
    }
    let live = true;
    (async () => {
      const saved = await api
        .getScroll('podcast', podcastId, filters.sort)
        .catch(() => null);
      const located =
        saved &&
        (await api
          .locateEpisode(podcastId, saved.episodeId, filters)
          .catch(() => null));
      if (!live) return;
      if (!saved || !located || total === 0) return setRestoreDone(true);
      const index = Math.min(located.index, total - 1);
      if (index >= loadedCount.current) {
        loadedCount.current = Math.min(index + PAGE_SIZE, total);
        await fetchEpisodes();
        if (!live) return;
      }
      setPendingScroll({ index, offset: located.found ? saved.offset : 0 });
    })();
    return () => {
      live = false;
    };
  }, [restoreDone, loading, filters, channelSettings, rememberScroll, podcastId, total, fetchEpisodes]);
  useLayoutEffect(() => {
    if (!pendingScroll || episodes.length <= pendingScroll.index) return;
    scrollToRow(pendingScroll.index, pendingScroll.offset);
    setPendingScroll(null);
    setRestoreDone(true);
  }, [pendingScroll, episodes]);
  useScrollMemory(
    rememberScroll && filters
      ? { scope: 'podcast', id: podcastId, sort: filters.sort }
      : null,
    restoreDone,
  );

  // Load the next page as the end of the list nears; no Load more button.
  const hasMore = episodes.length < total;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) void fetchEpisodes(true);
      },
      { root: el.closest('.main-content'), rootMargin: '0px 0px 800px 0px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadingMore, fetchEpisodes]);
  const showAll = async () => {
    setLoadingAll(true);
    loadedCount.current = total;
    await fetchEpisodes();
    setLoadingAll(false);
  };

  // Channel settings save immediately; null follows the account default.
  const saveSetting = async (partial: Partial<ChannelSettings>) => {
    try {
      setChannelSettings(await api.saveChannelSettings(podcastId, partial));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const changeSort = (sort: ChannelFilters['sort']) => {
    updateFilters({ sort });
    void saveSetting({ sort: sort === preferences.channelSort ? null : sort });
  };
  const resetChannel = async () => {
    try {
      setChannelSettings(await api.resetChannelSettings(podcastId));
      updateFilters({
        sort: preferences.channelSort,
        hideCompleted: preferences.channelHideCompleted,
      });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const closeSettings = useCallback(() => setShowSettings(false), []);

  const closeFilters = useCallback(() => setShowFilters(false), []);
  const activeFilterCount = filters
    ? [
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
          {episodes.length < total ? (
            <>
              {episodes.length} of {total} episodes ·{' '}
              <button
                className="text-link-muted"
                onClick={() => void showAll()}
                disabled={loadingAll}
              >
                {loadingAll ? 'Loading all…' : 'Show all'}
              </button>
            </>
          ) : (
            `${total} episodes`
          )}
        </span>
        <div className="episode-list-header-actions">
          <select
            className="sort-select"
            aria-label="Episode order"
            value={filters.sort}
            onChange={(e) =>
              changeSort(e.target.value as ChannelFilters['sort'])
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
          <button
            className="btn-icon channel-settings-btn"
            data-hint="channel-settings"
            aria-label="Channel settings"
            aria-haspopup="dialog"
            title="Channel settings"
            onClick={() => setShowSettings(true)}
          >
            <Settings size={20} />
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
          <label>
            <span>Episode status</span>
            <select
              value={filters.status}
              onChange={(e) =>
                updateFilters({
                  status: e.target.value as ChannelFilters['status'],
                  // Showing played episodes overrides Hide completed for this view.
                  hideCompleted:
                    e.target.value === 'played' ? false : defaults().hideCompleted,
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
            Filters apply until you leave this channel. Order and Hide
            completed are channel settings (the gear); set defaults for all
            channels in Settings →{' '}
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
      {showSettings && (
        <BottomSheet
          title="Channel settings"
          onClose={closeSettings}
          footer={
            <>
              <button className="btn-secondary" onClick={() => void resetChannel()}>
                Reset to defaults
              </button>
              <button className="btn-primary" onClick={closeSettings}>
                Done
              </button>
            </>
          }
        >
          <label>
            <span>Episode order</span>
            <select
              value={channelSettings?.sort ?? ''}
              onChange={(e) => {
                const sort = (e.target.value || null) as ChannelSettings['sort'];
                updateFilters({ sort: sort ?? preferences.channelSort });
                void saveSetting({ sort });
              }}
            >
              <option value="">
                Default ({SORT_LABELS[preferences.channelSort]})
              </option>
              {(Object.keys(SORT_LABELS) as ChannelFilters['sort'][]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>
          {([
            ['hideCompleted', 'Hide completed episodes', preferences.channelHideCompleted],
            ['rememberScroll', 'Remember scroll position', preferences.rememberScroll],
          ] as const).map(([key, label, fallback]) => (
            <label key={key}>
              <span>{label}</span>
              <select
                value={channelSettings?.[key] == null ? '' : String(channelSettings[key])}
                onChange={(e) => {
                  const value = e.target.value === '' ? null : e.target.value === 'true';
                  if (key === 'hideCompleted')
                    updateFilters({ hideCompleted: value ?? fallback, status: 'any' });
                  void saveSetting({ [key]: value });
                }}
              >
                <option value="">Default ({fallback ? 'On' : 'Off'})</option>
                <option value="true">On</option>
                <option value="false">Off</option>
              </select>
            </label>
          ))}
          <p className="hint">
            Saved for this channel on all your devices. Defaults for every
            channel are in Settings →{' '}
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
            onClick={() => setFilters({ ...defaults(), hideCompleted: false })}
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
        <div ref={sentinel} className="load-more-container" role="status">
          {loadingMore ? 'Loading more episodes…' : ''}
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
