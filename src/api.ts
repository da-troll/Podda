import type { ChannelFilters, ChannelSettings, ClientDevice, Episode, Preferences, ScrollPosition } from './types';

// HIVE-1180: identify this device and web build to the server (admin Devices view).
function deviceId(): string {
  try {
    let id = localStorage.getItem('podda:device-id');
    if (!id) {
      id = crypto.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
      localStorage.setItem('podda:device-id', id);
    }
    return id;
  } catch {
    return '';
  }
}

export function clientHeaders(): Record<string, string> {
  const id = deviceId();
  return { 'X-Podda-Web': __APP_VERSION__, ...(id ? { 'X-Podda-Device': id } : {}) };
}

// HIVE-1526: the web sits behind Authentik's forward_auth (Caddy). Two ways a web session dies:
// the proxy session expires (Caddy answers /api with a redirect to the login: an opaqueredirect
// under redirect: 'manual'), or the 30-day proxy cookie is gone (Caddy passes /api straight
// through and the server says 401). Both recover with ONE top-level reload, which goes through
// forward_auth; the sessionStorage stamp makes it at most once a minute, so it cannot loop. The
// Android app (native fetch, its own sign-in) never takes this path.
export const isNativeApp = () => !!(window as any).Capacitor?.isNativePlatform?.();
const RELOAD_KEY = 'podda:auth-reload-ts';
export function reloadForAuth(now = Date.now()): boolean {
  try {
    if (now - Number(sessionStorage.getItem(RELOAD_KEY) || 0) < 60_000) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch { return false; } // no storage, no guard: never reload
  window.location.reload();
  return true;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const web = !isNativeApp();
  const res = await fetch(path, {
    ...options,
    ...(web ? { redirect: 'manual' as RequestRedirect } : {}),
    headers: {
      'Content-Type': 'application/json',
      ...clientHeaders(),
      ...(options?.headers as Record<string, string> | undefined),
    },
  });
  if (web && res.type === 'opaqueredirect') {
    reloadForAuth();
    throw new Error('Session expired');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    // An Authentik user with no Podda account: a static screen, never a reload.
    if (res.status === 403 && body.error === 'not_linked') window.dispatchEvent(new Event('podda:not-linked'));
    // A wrong password on the legacy login is a 401 too; that one is an answer, not a dead session.
    else if (web && res.status === 401 && path !== '/api/auth/login') reloadForAuth();
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
}

function progressRequest<T>(path: string, options: RequestInit) {
  return request<T>(path, options).then(result => { window.dispatchEvent(new Event('podda:progressSaved')); return result; });
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  logout: () =>
    request('/api/auth/logout', { method: 'POST' }),
  me: () =>
    request('/api/auth/me'),

  getPreferences: () => request<Preferences>('/api/preferences'),
  savePreferences: (preferences: Preferences) => request<Preferences>('/api/preferences', { method: 'PUT', body: JSON.stringify(preferences) }),

  // Podcasts
  getPodcasts: () =>
    request('/api/podcasts'),
  getPodcast: (id: number) =>
    request(`/api/podcasts/${id}`),
  fetchPodcast: (feedUrl: string) =>
    request('/api/podcasts/fetch', { method: 'POST', body: JSON.stringify({ feedUrl }) }),
  subscribe: (feedUrl: string) =>
    request('/api/podcasts/subscribe', { method: 'POST', body: JSON.stringify({ feedUrl }) }),
  unsubscribe: (id: number) =>
    request(`/api/podcasts/${id}/unsubscribe`, { method: 'DELETE' }),
  refreshPodcast: (id: number) =>
    request(`/api/podcasts/${id}/refresh`, { method: 'POST' }),
  importOpml: (opml: string) =>
    request('/api/podcasts/import-opml', { method: 'POST', body: JSON.stringify({ opml }) }),

  // Episodes
  getEpisodes: (podcastId: number, limit = 50, offset = 0, filters?: ChannelFilters, after?: number) => {
    const query = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (filters) Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) query.set(key, String(value)); });
    if (after !== undefined) query.set('after', String(after));
    return request<{ episodes: Episode[]; total: number }>(`/api/episodes/podcast/${podcastId}?${query}`);
  },
  locateEpisode: (podcastId: number, episodeId: number, filters: ChannelFilters) => {
    const query = new URLSearchParams({ episode: String(episodeId) });
    Object.entries(filters).forEach(([key, value]) => { if (value !== undefined) query.set(key, String(value)); });
    return request<{ index: number; found: boolean }>(`/api/episodes/podcast/${podcastId}/locate?${query}`);
  },
  getChannelSettings: (podcastId: number) => request<ChannelSettings>(`/api/channel-settings/${podcastId}`),
  saveChannelSettings: (podcastId: number, settings: Partial<ChannelSettings>) =>
    request<ChannelSettings>(`/api/channel-settings/${podcastId}`, { method: 'PUT', body: JSON.stringify(settings) }),
  resetChannelSettings: (podcastId: number) =>
    request<ChannelSettings>(`/api/channel-settings/${podcastId}`, { method: 'DELETE' }),
  getScroll: (scope: 'podcast' | 'playlist', id: number, sort: string) =>
    request<ScrollPosition | null>(`/api/scroll/${scope}/${id}?sort=${encodeURIComponent(sort)}`),
  saveScroll: (scope: 'podcast' | 'playlist', id: number, sort: string, position: ScrollPosition) =>
    request(`/api/scroll/${scope}/${id}`, { method: 'PUT', keepalive: true, body: JSON.stringify({ sort, ...position }) }),
  getRecentEpisodes: (limit = 50) =>
    request(`/api/episodes/recent?limit=${limit}`),
  getEpisode: (id: number) =>
    request(`/api/episodes/${id}`),

  // Progress
  saveProgress: (episodeId: number, position: number, completed = false, isNewSession = false) =>
    progressRequest(`/api/progress/${episodeId}`, { method: 'PUT', body: JSON.stringify({ position, completed, isNewSession }) }),
  getInProgress: () =>
    request('/api/progress/in-progress'),

  // History
  getHistory: (limit = 50, offset = 0, filter?: string) =>
    request(`/api/history?limit=${limit}&offset=${offset}${filter ? `&filter=${filter}` : ''}`),
  markPlayed: (episodeId: number) =>
    progressRequest(`/api/history/${episodeId}/mark-played`, { method: 'POST' }),
  markUnplayed: (episodeId: number) =>
    progressRequest(`/api/history/${episodeId}/mark-unplayed`, { method: 'POST' }),

  // Playlists
  getPlaylists: () =>
    request('/api/playlists'),
  createPlaylist: (data: { name: string; is_smart?: boolean; rules?: unknown; sort_order?: string; auto_remove_completed?: boolean }) =>
    request('/api/playlists', { method: 'POST', body: JSON.stringify(data) }),
  updatePlaylist: (id: number, data: { name?: string; rules?: unknown; sort_order?: string; auto_remove_completed?: boolean; remember_scroll?: boolean | null }) =>
    request(`/api/playlists/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePlaylist: (id: number) =>
    request(`/api/playlists/${id}`, { method: 'DELETE' }),
  getPlaylistEpisodes: (id: number) =>
    request(`/api/playlists/${id}/episodes`),
  addToPlaylist: (playlistId: number, episodeIds: number[]) =>
    request(`/api/playlists/${playlistId}/episodes`, { method: 'POST', body: JSON.stringify({ episode_ids: episodeIds }) }),
  removeFromPlaylist: (playlistId: number, episodeId: number) =>
    request(`/api/playlists/${playlistId}/episodes/${episodeId}`, { method: 'DELETE' }),
  reorderPlaylist: (playlistId: number, episodeIds: number[]) =>
    request(`/api/playlists/${playlistId}/reorder`, { method: 'PUT', body: JSON.stringify({ episode_ids: episodeIds }) }),
  queuePlaylist: (playlistId: number, mode: 'next' | 'last') =>
    request(`/api/playlists/${playlistId}/queue`, { method: 'POST', body: JSON.stringify({ mode }) }),

  // Search
  search: (q: string) =>
    request(`/api/search?q=${encodeURIComponent(q)}`),

  // Announcements
  getAnnouncements: () =>
    request('/api/announcements'),
  getDevices: () => request<ClientDevice[]>('/api/admin/devices'),
  getAllAnnouncements: () =>
    request('/api/announcements/all'),
  createAnnouncement: (data: { title: string; body?: string; type?: string; expires_at?: string }) =>
    request('/api/announcements', { method: 'POST', body: JSON.stringify(data) }),
  deleteAnnouncement: (id: number) =>
    request(`/api/announcements/${id}`, { method: 'DELETE' }),
  dismissAnnouncement: (id: number) =>
    request(`/api/announcements/${id}/dismiss`, { method: 'POST' }),
};
