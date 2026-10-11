import type { ReactNode } from 'react';
import {
  Moon, Shuffle, ListEnd, ListPlus, EyeOff, Play, Pause, SkipBack, SkipForward,
  Heart, Trash2, Download, Check, Plus,
} from 'lucide-react';

interface HelpItem {
  icon: ReactNode;
  label: string;
  description: string;
}

export interface HelpSection {
  title: string;
  items: HelpItem[];
}

const SIZE = 20;

export const HELP_SECTIONS: HelpSection[] = [
  {
    title: 'Player',
    items: [
      { icon: <Play size={SIZE} />, label: 'Play', description: 'Start playback of the current episode.' },
      { icon: <Pause size={SIZE} />, label: 'Pause', description: 'Pause without losing your place.' },
      { icon: <SkipBack size={SIZE} />, label: 'Skip back 15s', description: 'Jump 15 seconds backwards in the current episode.' },
      { icon: <SkipForward size={SIZE} />, label: 'Skip forward 15s', description: 'Jump 15 seconds forwards in the current episode.' },
      { icon: <span className="help-text-icon">1x</span>, label: 'Playback speed', description: 'Tap to cycle through 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x, 3x.' },
      { icon: <Moon size={SIZE} />, label: 'Sleep timer', description: 'Auto-pause after 5, 15, 30, 45, or 60 minutes, or at end of episode.' },
      { icon: <Shuffle size={SIZE} />, label: 'Shuffle', description: 'Randomise the order of the current queue.' },
      { icon: <ListEnd size={SIZE} />, label: 'Auto-play next', description: 'When on, the next episode in the queue starts automatically.' },
    ],
  },
  {
    title: 'Episodes',
    items: [
      { icon: <ListPlus size={SIZE} />, label: 'Add to playlist', description: 'Save this episode to one of your playlists.' },
      { icon: <Heart size={SIZE} />, label: 'Favorite', description: 'Mark the episode as a favorite for quick access.' },
      { icon: <Download size={SIZE} />, label: 'Download', description: 'Cache the episode for offline listening.' },
      { icon: <Check size={SIZE} />, label: 'Mark played', description: 'Mark the episode as finished. Removes it from "up next" queues.' },
      { icon: <EyeOff size={SIZE} />, label: 'Dismiss', description: 'Hide "Continue Listening" for the rest of today.' },
      { icon: <Trash2 size={SIZE} />, label: 'Remove', description: 'Remove the item from a playlist or queue.' },
    ],
  },
  {
    title: 'Library',
    items: [
      { icon: <Plus size={SIZE} />, label: 'Subscribe', description: 'Follow a podcast so new episodes appear in your library.' },
      { icon: <span className="help-text-icon">OPML</span>, label: 'Import subscriptions', description: 'Bring your subscriptions from another podcast app. Find it in Settings.' },
    ],
  },
  {
    title: 'Podcast channels',
    items: [
      { icon: <EyeOff size={SIZE} />, label: 'Hide completed', description: 'In channel settings (the gear): hide finished episodes while keeping partially listened episodes visible.' },
      { icon: <span className="help-text-icon">↕</span>, label: 'Episode order', description: 'Sort the entire channel newest, oldest, shortest, or longest first. The channel remembers your choice, and playback follows it.' },
      { icon: <span className="help-text-icon">≡</span>, label: 'Filters', description: 'Tap Filters to narrow the list by status, release date, and duration until you leave the channel. The button shows how many are active. Filters also apply to autoplay.' },
      { icon: <Check size={SIZE} />, label: 'Channel settings', description: 'The gear on a channel sets its order, Hide completed and Remember scroll position. Defaults for every channel (and scroll memory for playlists) are in Settings → Preferences. Saved across devices.' },
    ],
  },
  {
    title: 'Gestures',
    items: [
      { icon: <span className="help-text-icon">→</span>, label: 'Swipe right', description: 'Opens the navigation menu from anywhere.' },
      { icon: <span className="help-text-icon">↓</span>, label: 'Pull down', description: 'On a list, pull down to refresh.' },
      { icon: <span className="help-text-icon">⎯</span>, label: 'Long-press progress', description: 'Long-press the player progress bar to scrub precisely.' },
    ],
  },
];
