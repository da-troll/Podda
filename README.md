# Podda

Self-hosted family podcast app. Subscribe to RSS feeds, discover new podcasts via iTunes search, stream episodes directly from publisher CDNs, and track listening progress across devices.

Built as a Castbox replacement for the Trollefsen household.

**Live:** https://podda.trollefsen.com

## Features

### Core
- **Podcast subscriptions** — subscribe by RSS URL or search iTunes
- **OPML import** — migrate from Castbox/Pocket Casts/any podcast app in one click
- **Multi-user** — each family member gets their own subscriptions, progress, and playlists
- **Direct CDN streaming** — no audio proxying, bypasses middleman ad-insertion
- **Hash-based routing** — hardware back button works correctly on mobile/PWA

### Player
- **Persistent audio player** — play/pause, skip ±15s, seekable progress bar
- **Playback speed** — 0.5x to 3x in 0.25x increments, persisted per session
- **Auto-play** — automatically plays the next episode in queue (toggle, persisted in localStorage)
- **Smart rewind** — if resuming after 12+ hours away, rewinds 15s for context
- **Media Session API** — lock screen controls on mobile (title, artwork, play/pause/seek)

### Progress Tracking
- **Continuous save** — saves position every 15s while playing
- **Beacon save** — saves on page unload via `sendBeacon` (catches tab closes)
- **Auto-complete** — marks episodes complete at ≤5min remaining OR ≥98% played
- **Re-listen detection** — resets completion if replaying from an early position
- **Play count** — tracks how many times each episode has been played

### Podcast Channels
- Sort the entire channel newest, oldest, shortest, or longest first
- Hide completed episodes while keeping partially listened episodes visible
- Filter by listening status, release window, and duration
- Autoplay follows channel sorting and filters beyond the loaded page
- Set account defaults in **Settings → Preferences**; preferences sync across devices
- Contextual first-visit hint and release notes explain the controls

### Playlists
- **Manual playlists** — curated episode lists with drag-to-reorder
- **Smart playlists** — auto-filtering based on configurable rules:
  - Episode status (unplayed, in progress, played)
  - Release date (last 24h, 3d, 7d, 14d, 30d)
  - Duration range (min/max presets)
  - Podcast selection (all, include specific, exclude specific)
- **Queue injection** — "Play Next" and "Play Last" to inject playlist episodes into the current queue
- **Auto-hide completed** — optionally filter out finished episodes
- **Sort orders** — manual (drag), newest, oldest, shortest, longest

### Feed Management
- **Background polling** — checks all subscriptions every 30 minutes
- **Feed resilience** — follows 301 redirects, detects `itunes:new-feed-url`, GUID fallback for broken feeds, 10s fetch timeout with error backoff
- **Force refresh** — manually re-fetch any single podcast's feed
- **Episode dedup** — keyed by GUID to prevent duplicates across feed URL changes

### UI
- **Mobile responsive** — collapsible sidebar, touch-friendly controls
- **Continue Listening** — top 5 in-progress episodes on Library homepage
- **Listening history** — full history with filters (All, In Progress, Completed)
- **Paginated episode lists** — 50 per page with "Load More"
- **Confirmation modals** — destructive actions (unsubscribe, delete) require confirmation

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Vite |
| Backend | Express 5 (CommonJS) |
| Database | PostgreSQL 16 |
| RSS | rss-parser |
| Audio | Native HTML5 `<audio>` |
| Auth | express-session + bcrypt + connect-pg-simple |
| Icons | lucide-react |
| Process | systemd user service |
| Proxy | Caddy (auto TLS) |

No ORM. No CSS framework. No router library. No state management library. ~75 KB gzipped frontend bundle.

## Project Structure

```
podda/
├── server/
│   ├── index.cjs              Express entry, middleware, static serving, feed poller
│   ├── db.cjs                 PostgreSQL pool, schema migration
│   ├── auth.cjs               Session auth, bcrypt, login/logout
│   ├── feed-utils.cjs         RSS fetch, duration parsing, GUID fallback
│   ├── poller.cjs             Background feed refresh (30min interval)
│   └── routes/
│       ├── podcasts.cjs       Subscribe, unsubscribe, list, refresh, OPML import
│       ├── episodes.cjs       Episode listing, detail, recent across subscriptions
│       ├── player.cjs         Progress upsert/load, in-progress list
│       ├── playlists.cjs      Manual + smart playlists, queue injection, reorder
│       ├── history.cjs        Listening history, mark played/unplayed
│       └── search.cjs         iTunes Search API proxy
├── src/
│   ├── App.tsx                Root component, hash router, contexts
│   ├── main.tsx               React entry
│   ├── app.css                All styles (single file, CSS custom properties)
│   ├── api.ts                 Typed fetch wrapper for all API calls
│   ├── types.ts               Shared TypeScript types
│   ├── hooks/
│   │   ├── usePlayer.ts       Audio state, progress persistence, Media Session API, auto-play
│   │   └── useAuth.ts         Auth state, login/logout
│   ├── components/
│   │   ├── Player.tsx         Persistent bottom audio player
│   │   ├── EpisodeRow.tsx     Episode list item (play button, progress, context menu)
│   │   ├── Sidebar.tsx        Navigation sidebar
│   │   ├── AddToPlaylistModal.tsx     Quick-add episode to playlist
│   │   ├── CreatePlaylistModal.tsx    Create manual or smart playlist
│   │   ├── SmartPlaylistBuilder.tsx   Rule editor for smart playlists
│   │   └── ConfirmModal.tsx   Reusable confirmation dialog
│   └── pages/
│       ├── Library.tsx        Subscribed podcasts grid + continue listening
│       ├── PodcastDetail.tsx  Paginated episode list for one podcast
│       ├── Discover.tsx       iTunes search + direct URL subscribe
│       ├── Playlists.tsx      Playlist grid (manual + smart)
│       ├── PlaylistDetail.tsx Playlist management, smart rules, drag-reorder
│       ├── History.tsx        Listening history with filters
│       ├── Settings.tsx       OPML import, account info
│       └── Login.tsx          Login form
├── public/
│   ├── icon.svg               Favicon (indigo circle + "p")
│   ├── icon-1024.png          High-res app icon (1024×1024)
│   └── podda-logo.png         Wordmark logo
├── index.html
├── package.json
├── vite.config.ts
├── tsconfig.json
├── build.sh
└── .env                       (not committed)
```

## Database Schema

Seven tables, all using `TIMESTAMPTZ` and `ON DELETE CASCADE`:

| Table | Purpose |
|-------|---------|
| **users** | Family accounts (username, bcrypt hash, admin flag) |
| **podcasts** | Shared RSS feeds (feed URL, title, artwork, polling metadata) |
| **episodes** | Shared episodes keyed by `(podcast_id, guid)` |
| **subscriptions** | Per-user podcast subscriptions |
| **listen_progress** | Per-user playback position, completion, play count |
| **playlists** | Manual + smart playlists with rules and sort config |
| **playlist_episodes** | Junction table for manual playlist ordering |
| **session** | PostgreSQL-backed session store (connect-pg-simple) |

Schema auto-migrates on server startup.

## API

All endpoints require authentication via session cookie (except login).

### Auth

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | Authenticate |
| POST | `/api/auth/logout` | End session |
| GET | `/api/auth/me` | Current user (returns `null` if unauthenticated) |

### Preferences

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/preferences` | Load account channel defaults |
| PUT | `/api/preferences` | Save `channelSort` (`newest`/`oldest`) and `channelHideCompleted` (boolean) |

### Podcasts

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/podcasts` | User's subscribed podcasts with episode/completion counts |
| POST | `/api/podcasts/subscribe` | Subscribe to RSS feed URL |
| DELETE | `/api/podcasts/:id/unsubscribe` | Remove subscription |
| POST | `/api/podcasts/:id/refresh` | Force re-fetch feed |
| POST | `/api/podcasts/import-opml` | Bulk import from OPML XML |

### Episodes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/episodes/podcast/:id` | Episodes for one podcast (paginated, limit/offset) |
| GET | `/api/episodes/recent` | Recent episodes across all subscriptions |
| GET | `/api/episodes/:id` | Single episode detail |

Channel episode requests accept `sort` (`newest`, `oldest`, `shortest`, `longest`),
`hideCompleted` (`true`/`false`), `status` (`any`, `unplayed`, `in-progress`, `played`),
`released_after` (`any`, `24h`, `3d`, `7d`, `14d`, `30d`), and `duration_min`/`duration_max`
(in seconds). Filters apply before `limit`/`offset`, and `total` counts matching episodes.
The optional `after` episode ID continues playback in the selected order, including when
the anchor episode has become hidden by the current filters.

### Progress

| Method | Path | Purpose |
|--------|------|---------|
| PUT | `/api/progress/:episodeId` | Save listen position + completion |
| GET | `/api/progress/in-progress` | Episodes with partial progress (top 20) |

### History

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/history` | Full listen history (filter: all/completed/in-progress) |
| POST | `/api/history/:episodeId/mark-played` | Manually mark complete |
| POST | `/api/history/:episodeId/mark-unplayed` | Reset progress |

### Playlists

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/playlists` | All playlists with episode count + total duration |
| POST | `/api/playlists` | Create manual or smart playlist |
| PUT | `/api/playlists/:id` | Update name, rules, sort, auto-hide |
| DELETE | `/api/playlists/:id` | Delete playlist |
| GET | `/api/playlists/:id/episodes` | Playlist episodes (smart = live-queried) |
| POST | `/api/playlists/:id/episodes` | Add episodes to manual playlist |
| DELETE | `/api/playlists/:id/episodes/:episodeId` | Remove from manual playlist |
| PUT | `/api/playlists/:id/reorder` | Reorder manual playlist (transaction) |
| POST | `/api/playlists/:id/queue` | Inject into queue (mode: next/last) |

### Search

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/search?q=term` | iTunes podcast search proxy |

## Deployment

### Prerequisites

- Node.js 22+
- PostgreSQL 16 (accessible from the host)
- Caddy reverse proxy (for HTTPS)

### Setup

```bash
# 1. Clone
git clone git@github.com:da-troll/podda.git /opt/apps/podda
cd /opt/apps/podda

# 2. Install dependencies
npm install

# 3. Create database
psql -U postgres -c "CREATE ROLE podda WITH LOGIN PASSWORD 'your_password';"
psql -U postgres -c "CREATE DATABASE podda OWNER podda;"

# 4. Configure environment
cp .env.example .env
# Edit .env with your database credentials, session secret, admin user

# 5. Build frontend
npm run build

# 6. Start
node server/index.cjs
# Or use the systemd service (see below)
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PORT` | No | Server port (default: 18892) |
| `PGUSER` | Yes | PostgreSQL username |
| `PGPASSWORD` | Yes | PostgreSQL password |
| `PGHOST` | Yes | PostgreSQL host |
| `PGPORT` | No | PostgreSQL port (default: 5432) |
| `PGDATABASE` | Yes | PostgreSQL database name |
| `SESSION_SECRET` | Yes | Session encryption secret |
| `ADMIN_USERNAME` | No | Seed admin user on first run |
| `ADMIN_PASSWORD` | No | Seed admin password on first run |

### Systemd Service

```ini
# ~/.config/systemd/user/podda.service
[Unit]
Description=Podda - Family Podcast App
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/apps/podda
EnvironmentFile=/opt/apps/podda/.env
Environment=NODE_ENV=production
ExecStart=/usr/bin/node /opt/apps/podda/server/index.cjs
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now podda
```

### Caddy Configuration

```caddyfile
podda.trollefsen.com {
    encode gzip zstd

    @api path /api/*
    handle @api {
        reverse_proxy host.docker.internal:18892
    }

    handle {
        root * /opt/apps/podda/dist
        try_files {path} /index.html
        file_server
    }
}
```

### Build Script

```bash
~/bin/build-podda   # Builds frontend + restarts service
```

## Development

```bash
# Terminal 1: Backend
node server/index.cjs

# Terminal 2: Frontend (with HMR + API proxy)
npm run dev
```

Vite proxies `/api` requests to `localhost:18892` during development.

## Design

- **Color scheme:** Indigo accent (`#6366f1`) on dark navy backgrounds derived from the Trollefsen design system
- **Favicon:** Indigo circle with white "p" lettermark
- **Single CSS file** with CSS custom properties for theming (accent, backgrounds stored as `--*-backup` vars for easy swapping)
- **No component library** — all UI built from scratch

## License

MIT — see [LICENSE](LICENSE) for details.
