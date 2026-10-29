export interface User {
  id: number;
  username: string;
  displayName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  isAdmin: boolean;
  authMethod?: 'password' | 'authentik-web' | 'authentik-oidc';
}

export interface Podcast {
  id: number;
  feed_url: string;
  title: string;
  author: string | null;
  description: string | null;
  artwork_url: string | null;
  link: string | null;
  language: string | null;
  last_fetched: string | null;
  episode_count?: number;
  completed_count?: number;
  is_subscribed?: boolean;
}

export interface Episode {
  id: number;
  podcast_id: number;
  guid: string;
  title: string;
  description: string | null;
  audio_url: string;
  audio_type: string | null;
  audio_length: number | null;
  duration: number | null;
  pub_date: string | null;
  artwork_url: string | null;
  podcast_title?: string;
  podcast_artwork_url?: string;
  podcast_author?: string;
  listen_position?: number | null;
  listen_completed?: boolean | null;
  progress_updated_at?: string | null;
  played_at?: string | null;
  play_count?: number;
  completed_at?: string | null;
}

export interface SearchResult {
  name: string;
  artist: string;
  artworkUrl: string | null;
  feedUrl: string;
  genre: string | null;
  trackCount: number;
}

export interface Playlist {
  id: number;
  user_id: number;
  name: string;
  is_smart: boolean;
  rules: SmartPlaylistRules | null;
  sort_order: 'manual' | 'newest' | 'oldest' | 'shortest' | 'longest';
  auto_remove_completed: boolean;
  /** null = follow the account default */
  remember_scroll?: boolean | null;
  created_at: string;
  updated_at: string;
  episode_count?: number;
  total_duration?: number;
}

export interface SmartPlaylistRules {
  podcasts?: number[] | null;
  exclude_podcasts?: number[] | null;
  status?: 'unplayed' | 'in-progress' | 'played' | 'any';
  released_after?: '24h' | '3d' | '7d' | '14d' | '30d' | 'any';
  duration_min?: number | null;
  duration_max?: number | null;
}

export interface Announcement {
  id: number;
  title: string;
  body: string | null;
  type: 'info' | 'warning' | 'success';
  starts_at: string;
  expires_at: string | null;
  created_at: string;
  created_by_username?: string;
}

export type ChannelSort = 'newest' | 'oldest' | 'shortest' | 'longest';
export interface Preferences { channelSort: 'newest' | 'oldest'; channelHideCompleted: boolean; rememberScroll: boolean; }
/** Per-channel overrides; null follows the account default in Preferences. */
export interface ChannelSettings {
  sort: ChannelSort | null;
  hideCompleted: boolean | null;
  rememberScroll: boolean | null;
}
export interface ScrollPosition { episodeId: number; index: number; offset: number; }
export interface ChannelFilters {
  sort: ChannelSort;
  hideCompleted: boolean;
  status: 'any' | 'unplayed' | 'in-progress' | 'played';
  released_after: 'any' | '24h' | '3d' | '7d' | '14d' | '30d';
  duration_min?: number;
  duration_max?: number;
}

export type QueueSource =
  | { type: 'podcast'; podcastId: number; sortOrder: ChannelSort; filters?: ChannelFilters }
  | { type: 'playlist'; playlistId: number }
  | { type: 'recent' }
  | { type: 'history'; filter?: string }
  | { type: 'continue' };

export type Page =
  | { type: 'library' }
  | { type: 'podcast'; id: number }
  | { type: 'discover' }
  | { type: 'queue' }
  | { type: 'history' }
  | { type: 'playlists' }
  | { type: 'playlist'; id: number }
  | { type: 'settings' }
  | { type: 'help' };

/** HIVE-1180: GET /api/admin/devices row. */
export interface ClientDevice {
  username: string;
  displayName: string | null;
  deviceId: string;
  platform: 'android-app' | 'web';
  appVersion: string | null;
  webVersion: string | null;
  userAgent: string | null;
  updateCheckAt: string | null;
  updateCheckResult: string | null;
  updateCheckDetail: string | null;
  firstSeen: string;
  lastSeen: string;
}
