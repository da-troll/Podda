# Changelog

All user-facing changes to Podda. The most recent entry is shown to users
in the "What's New" sheet on first launch after an update.

Format: one `## v<major>.<minor>.<patch> — <YYYY-MM-DD>` header per release,
followed by bullet points. `publish-update.sh` requires an entry matching
the version being published — releases without an entry fail.

## v1.2.0 — 2026-10-10

- Android lock-screen controls now keep the player and listening progress in sync, with correct episode metadata.
- Podcast channels now have status, release-date, and duration filters, plus a Hide completed toggle.
- Choose your default channel order and whether to hide completed episodes in Settings → Preferences. Your choices sync across devices.
- Oldest first now starts at the beginning of the channel; autoplay follows your selected order and filters.

## v1.1.0 — 2026-05-04

- Fixed the home-screen and splash icon — no more wordmark squeezed into a circle
- Episode list now refreshes automatically when episodes complete or you switch back to the app — no more stale "halfway" markers
- "Update available" banner now opens Google Play instead of a sideload APK
- Support for in-app messages from the Podda team for things like maintenance windows or new-feature tips
- Smaller download size and improved crash diagnostics under the hood

## v1.0.49 — 2026-05-04

- Support for one-off in-app messages from the Podda team — for things like maintenance windows or new-feature tips, without needing a full app update

## v1.0.48 — 2026-05-01

- Episode list now refreshes automatically when episodes complete or you switch back to the app — no more stale "halfway" markers after listening through several episodes

## v1.0.47 — 2026-05-01

- Smaller download size (≈45% smaller AAB) and improved crash diagnostics under the hood

## v1.0.46 — 2026-04-22

- The "update available" banner now opens Google Play instead of a sideload APK
- Sideload install option moved to a secondary link on the download page (still works for de-Googled devices)

## v1.0.45 — 2026-04-22

- First release published to the Google Play Store

## v1.0.44 — 2026-04-19

- Tapping the Podda logo in the nav header now navigates to the Library tab

## v1.0.43 — 2026-04-18

- Up Next panel: tap the queue icon in the expanded player to see the rest of the episodes in the current queue, with the source shown ("From *podcast*" / "From *playlist*")
- Tap any episode in the panel to jump straight to it
- New preview strip at the bottom of the expanded player shows the next episode at a glance
- Skip buttons: "15" label no longer overlaps the arrow icons — now sits cleanly inside the skip arcs, matching Apple Podcasts / Spotify

## v1.0.42 — 2026-04-17

- Player redesign: compact mini bar + full-screen expanded view — tap the mini bar to open
- Scrub bar: much larger touch target with end-snap, so reaching 0:00 and the end of an episode actually works on mobile
- Variable-speed scrubbing: drag the scrubber vertically for half / quarter / fine precision, like Apple Podcasts
- Swipe down on the expanded player to collapse it
- New overflow menu (⋮) on the expanded player: Mark played, Go to podcast, Share
- Haptic feedback on scrub, speed change, sleep timer, and transport buttons (Android)
- Android hardware back button now collapses the expanded player before leaving the page

## v1.0.41 — 2026-04-17

- Sleep timer: auto-pause after 5, 15, 30, 45, or 60 minutes, or at end of episode
- Player state now persists across cold starts — reopen the app and the last episode is ready to resume
- "Continue Listening" dismiss now resets at the start of each day instead of being permanent
- Help page added — find icon and gesture reference in Settings
- "What's New" now appears once per release

## v1.0.40 — 2026-04-16

- Fix autoplay crash on episode transition (native Android)
