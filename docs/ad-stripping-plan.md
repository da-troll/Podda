# Ad Stripping — Feasibility Study & Implementation Plan

**Status:** proposal / not started
**Written:** 2026-09-10
**Context:** Podda already solved the *in-app* ad problem (we don't serve any). This document
covers the remaining problem: ads baked into the audio by the publisher's host via
Dynamic Ad Insertion (DAI).

---

## 1. The constraint that drives the whole design

Podcast audio is assembled **per request**. When a player asks for an enclosure URL, the
host stitches ad creatives into the program at insertion points, chosen from your IP,
time of day and device. Two listeners requesting the "same" episode get different bytes
with ads at different offsets.

**Consequence:** we cannot detect ads once, store timestamps, and have the client skip
them. Each family member's player would fetch a differently-stitched file and the
timestamps would be wrong.

There is exactly one correct architecture:

> The **server** downloads the episode once, cuts it once, stores the result, and serves
> **its own file** to every family member.

This directly trades away a current headline feature — *"Direct CDN streaming — no audio
proxying"* — and that trade is unavoidable, not a design choice.

## 2. What's actually out there (verified, Sept 2026)

| Project | Real? | Notes |
|---|---|---|
| [MinusPod](https://github.com/ttlequals0/MinusPod) | Yes | Most complete. Docker, REST API, multi-pass detection, Chromaprint learning, review queue, verification pass |
| [Podly](https://github.com/podly-pure-podcasts/podly_pure_podcasts) | Yes | MIT, simpler, Whisper + LLM + ffmpeg, local or Railway |
| [hemant6488/podcast-server](https://github.com/hemant6488/podcast-server) | Yes | Lightweight alternative |
| "Podurama AI ad-skip" | Unverified | No reputable confirmation — do not plan around it |
| `jdcb4/podcast-ad-remover` | Not found | Likely doesn't exist |
| PodcastAdBlock / "Adblock Podcast App" | Yes — **avoid** | Commercial reseller of stripped shows; [Podnews](https://podnews.net/article/podcastadblock-strips-ads-and-sells-shows) estimates ~$944k of diverted publisher revenue in <6 months. Instructive as the *bad* case |

**Correction to a common claim:** acoustic fingerprinting is *not* a faster detector. It
cannot detect an ad it has never heard. What it actually is — and how MinusPod uses it —
is a **cache**: once a creative is identified, Chromaprint recognises that same creative
in every future episode of every show for ~free. It's a cost-reduction layer on top of
the LLM. Silence detection (librosa) is likewise not a detector; it's only good for
snapping cut points to a clean boundary.

## 3. Recommended approach: integrate, don't rebuild

**Run MinusPod as a sidecar on the same host and point Podda's poller at its cleaned
feeds.** We keep our app, player, progress tracking and UX, and inherit multi-pass
detection, fingerprint learning, the review queue and the verification pass instead of
writing all four.

Reconsider absorbing the pipeline into Podda only after a month of real use.

Requirements: Docker, **8 GB RAM minimum / 16 GB recommended**, ffmpeg. Do **not** run
Whisper locally on this box — MinusPod's own docs state CPU `faster-whisper` is slow on
amd64 and slower on arm64, and recommend a remote endpoint.

### Do this first (cheapest win, zero code)

For the 2–3 shows the family actually listens to most, check whether the creator sells an
**ad-free private RSS feed** (Patreon / Apple Podcasts Subscriptions / Wondery+). Zero
compute, zero legal ambiguity, better audio, and it pays the people making the thing.
Podda already supports subscribing by URL, so this needs no work at all — and it may
cover the majority of household listening.

## 4. Best-practice pipeline (layered, cheapest first)

1. **Feed transcript, if present.** `<podcast:transcript>` is now the most-adopted
   Podcasting 2.0 tag (100% of Podcast Standards Project members; 427k+ feeds; rendered
   by Apple since 2024 and Spotify since late 2025). Caveat: the published transcript
   describes the **base** episode, not our ad-stitched copy — so use it as a reference and
   force-align it against the downloaded audio. The spans in our file that **don't** align
   to it *are* the inserted ads. Near-exact and near-free where available.
2. **Chromaprint fingerprint cache** of previously-confirmed ad creatives — catches most
   recurring sponsors with no API call.
3. **ASR + LLM** for the remainder. Remote transcription with word timestamps:
   - Groq `whisper-large-v3-turbo` — ~$0.04 / audio-hour
   - OpenAI `gpt-transcribe` — $0.0045/min ≈ $0.27 / audio-hour
   Classify sliding transcript windows with a cheap model (Claude Haiku 4.5 fits well).
4. **Snap cuts to silence/VAD boundaries**, apply ~200 ms crossfade. Re-encode to a
   normalised format rather than `-c copy` — MP3 frame boundaries will otherwise produce
   audible clicks and broken seeking.
5. **Verification pass** — re-check the output for abrupt loudness transitions or a
   surviving ad. This is the difference between "good" and "trustworthy".
6. **Human correction UI** feeding back into the fingerprint DB, so it gets cheaper over
   time.

### Cost estimate

10 shows × ~5 h/week ≈ **50 audio-hours/month** → **~$2/mo** transcription on Groq,
plus a negligible LLM bill. Compute cost is not the constraint; bandwidth and storage are.

## 5. Concrete changes to Podda

### 5.1 Schema

Add to `episodes` (shared across users, so one download and one cut serves the whole
household — a real advantage of the current design):

```sql
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_audio_url TEXT;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_duration INTEGER;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_status VARCHAR(20);  -- null|queued|processing|ready|failed|evicted
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_rev INTEGER DEFAULT 0;
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_cuts JSONB;          -- [[start,end], ...] in ORIGINAL seconds
ALTER TABLE episodes ADD COLUMN IF NOT EXISTS clean_processed_at TIMESTAMPTZ;
```

Columns on `episodes` rather than a separate `episode_variants` table specifically because
the existing routes use `SELECT e.*` throughout — the new fields flow to the client with
no query changes. A join table would be cleaner in the abstract and require touching every
episode query; not worth it here.

Job queue: add `pg-boss`, or a minimal `jobs` table plus one worker. Postgres is already
there; don't add Redis for this.

### 5.2 Progress: keep the original timeline canonical

A cleaned file is typically 8–12 minutes shorter, and reprocessing shifts offsets again.
`listen_progress.position` must not silently change meaning.

**Rule: `listen_progress.position` always stores seconds on the ORIGINAL timeline.**
Convert at the API boundary.

```
clean_t  = orig_t  - (total duration of cuts that end before orig_t)
orig_t   = clean_t + (cuts re-added walking forward)
```

- `PUT /api/progress/:episodeId` gains `timeline: 'original' | 'clean'` in the body
  (default `'original'`). When `'clean'`, map to original before the upsert.
- `GET /api/progress/in-progress` and episode payloads return both `listen_position`
  (original) and `listen_position_clean`.
- Existing rows need no migration, and `isCompleted()` in `server/routes/player.cjs` keeps
  working against `episodes.duration` unchanged.
- `clean_rev` bumps on reprocessing so a client holding a stale clean-timeline position
  can be detected and re-mapped.

### 5.3 Serving the audio

Keep Express **out of the byte path** — Range requests and seeking need to be fast.

```caddyfile
podda.trollefsen.com {
    encode gzip zstd

    @api path /api/*
    handle @api { reverse_proxy host.docker.internal:18892 }

    @media path /media/*
    handle @media {
        root * /var/lib/podda/media
        file_server
    }

    handle {
        root * /opt/apps/podda/dist
        try_files {path} /index.html
        file_server
    }
}
```

`clean_audio_url` stores a `/media/<podcast_id>/<episode_id>-<clean_rev>.mp3` path. The
`clean_rev` in the filename makes reprocessing cache-safe.

### 5.4 Frontend

One change, in `src/hooks/usePlayer.ts`: prefer `episode.clean_audio_url ?? episode.audio_url`
and use `clean_duration ?? duration`. Because episode rows come from `SELECT e.*`, the new
columns arrive with no other API work.

Show a small badge on rows where `clean_status === 'ready'` (and how much was cut) — it
builds trust, and mirrors what MinusPod's own audio marker does.

### 5.5 Prefetch, never process on play

The 30-minute poller in `server/poller.cjs` is already the right trigger: after
`upsertPodcastFromFeed`, enqueue newly-inserted episodes for subscribed podcasts.

**Always fall back.** If `clean_status !== 'ready'`, serve the origin `audio_url`. Nobody
waits on a spinner. Transcription + LLM is minutes per episode; a 30-min episode is
reported at under a minute with tuned threads on a fast desktop CPU, far longer on a small
VPS — which is another argument for remote ASR.

### 5.6 Retention

Cleaned audio is ~50–60 MB per hour-episode. Retention is mandatory, not optional:

- Keep last 30 days, or last N episodes per feed, whichever is smaller.
- On eviction set `clean_status = 'evicted'`, null `clean_audio_url`, **keep `clean_cuts`**
  (so a re-request is a re-cut, not a re-detect).
- Falling back to the origin URL after eviction is correct and cheap.

### 5.7 Be a good citizen to the hosts

- One download per episode for the whole household — the shared `episodes` table already
  gives us this. Never per-user.
- Honest `User-Agent`, existing 1s stagger between feeds, respect caching headers.
- Note that IAB Tech Lab's Measurement Guidelines v2.3 (July 2026) tightened how downloads
  and prefix redirects are counted. Our prefetch registers as a download either way; keep
  it to exactly one.

## 6. Legal / ethical position

*Not legal advice.* The distinction the industry actually draws is **redistribution and
commerce**, not modification. PodcastAdBlock was called out for selling stripped copies of
other people's shows to strangers with no publisher opt-in. A private, authenticated,
household-only server that strips ads for the same people who would otherwise have heard
them is much closer to time-shifting / private copying, and Norway's private-copying
exception (åndsverkloven § 26) is written around exactly that "personal use within the
family or close circle" framing.

Keep it that way — these are hard constraints, not preferences:

- Auth stays on. The cleaned feed and `/media` paths are **never** public.
- No payment, ever. No sharing outside the household.
- No public listing, no invite links, no "try my ad-free feed".
- Prefer paying for a creator's ad-free tier where one exists (§ 3).

## 7. Phased plan

| Phase | Work | Effort |
|---|---|---|
| 0 | Audit the family's top shows for official ad-free feeds; subscribe to those | 1 hour, no code |
| 1 | MinusPod sidecar on the host, remote ASR (Groq), 2–3 feeds manually | 1 evening |
| 2 | Schema migration + `clean_*` fields + poller enqueue + Caddy `/media` + `usePlayer` fallback | 1–2 evenings |
| 3 | Progress timeline mapping + "ads cut" badge + retention job | 1 evening |
| 4 | Live for the household for a month; review false positives | — |
| 5 | *Only if warranted:* absorb detection into Podda, or add transcript-alignment (§ 4.1) | open |

**Estimate: 2–4 evenings integrating MinusPod. Considerably more building the pipeline
in-house, for no near-term gain.**

## 8. Sources

- [MinusPod](https://github.com/ttlequals0/MinusPod) · [installation docs](https://github.com/ttlequals0/MinusPod/blob/main/docs/installation.md)
- [Podly Pure Podcasts](https://github.com/podly-pure-podcasts/podly_pure_podcasts)
- [XDA — MinusPod pipeline walkthrough](https://www.xda-developers.com/i-built-a-podcast-server-that-strips-ads-before-play/)
- [Podnews — PodcastAdBlock strips ads and sells shows](https://podnews.net/article/podcastadblock-strips-ads-and-sells-shows)
- [Podcast Standards Project — adoption](https://podstandards.org/2025/03/24/podcast-standards-project-what-weve-achieved-and-what-comes-next/) · [podcast:transcript spec](https://podcastnamespace.org/tag/transcript)
- [Northflank — open-source STT benchmarks 2026](https://northflank.com/blog/best-open-source-speech-to-text-stt-model-in-2026-benchmarks) · [Deepgram — STT API comparison 2026](https://deepgram.com/learn/best-speech-to-text-apis-2026)
- [IAB Tech Lab — Podcast Technical Measurement Guidelines v2.3](https://iabtechlab.com/press-releases/iab-tech-lab-releases-podcast-technical-measurement-guidelines-v2-3/)
- [Adblock Radio — designing an audio adblocker](https://www.adblockradio.com/blog/2018/11/15/designing-audio-ad-block-radio-podcast/index.html)
