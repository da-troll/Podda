import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { AuthContext, useAuthState } from './hooks/useAuth';
import { PlayerContext, usePlayerState } from './hooks/usePlayer';
import { useSwipeGesture } from './hooks/useSwipeGesture';
import { HintManager, dismissActiveHint } from './hints/HintManager';
import { WhatsNewSheet } from './components/WhatsNewSheet';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { Sidebar } from './components/Sidebar';
import { Player } from './components/player/Player';
import { Login } from './pages/Login';
import { Library } from './pages/Library';
import { PodcastDetail } from './pages/PodcastDetail';
import { Discover } from './pages/Discover';
import { Settings } from './pages/Settings';
import { Help } from './pages/Help';
import { History } from './pages/History';
import { Playlists } from './pages/Playlists';
import { PlaylistDetail } from './pages/PlaylistDetail';
import { useDiscoverStore } from './store/discoverStore';
import { Menu, X } from 'lucide-react';
import { OverlayProvider } from './hints/OverlayContext';
import { PreferencesProvider } from './hooks/usePreferences';
import type { Page } from './types';

function parseHash(): Page {
  const hash = window.location.hash.slice(1) || 'library';
  if (hash.startsWith('podcast/')) {
    const id = parseInt(hash.split('/')[1]);
    if (!isNaN(id)) return { type: 'podcast', id };
  }
  if (hash === 'discover') return { type: 'discover' };
  if (hash === 'history') return { type: 'history' };
  if (hash === 'playlists') return { type: 'playlists' };
  if (hash.startsWith('playlist/')) {
    const id = parseInt(hash.split('/')[1]);
    if (!isNaN(id)) return { type: 'playlist', id };
  }
  if (hash === 'settings') return { type: 'settings' };
  if (hash === 'help') return { type: 'help' };
  if (hash === 'queue') return { type: 'queue' };
  return { type: 'library' };
}

function pageToHash(page: Page): string {
  switch (page.type) {
    case 'library': return '#library';
    case 'podcast': return `#podcast/${page.id}`;
    case 'discover': return '#discover';
    case 'history': return '#history';
    case 'playlists': return '#playlists';
    case 'playlist': return `#playlist/${page.id}`;
    case 'settings': return '#settings';
    case 'help': return '#help';
    case 'queue': return '#queue';
  }
}

function AppContent() {
  const [page, setPage] = useState<Page>(parseHash);
  const [pageStack, setPageStack] = useState<Page[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const mainContentRef = useRef<HTMLElement>(null);
  const pendingScrollRef = useRef<number>(0);
  // Flag to distinguish our own hash changes from browser back/forward
  const programmaticNavRef = useRef(false);
  const player = usePlayerState();
  const setDiscoverScrollY = useDiscoverStore(s => s.setScrollY);
  const discoverScrollY = useDiscoverStore(s => s.scrollY);

  useSwipeGesture({
    onSwipeRight: useCallback(() => { setSidebarOpen(true); dismissActiveHint(); }, []),
    onSwipeLeft: useCallback(() => setSidebarOpen(false), []),
    edgeZone: 0.5,
  });

  // Apply pending scroll after React commits the new page to DOM
  useLayoutEffect(() => {
    if (mainContentRef.current) {
      mainContentRef.current.scrollTop = pendingScrollRef.current;
    }
  }, [page]);

  const navigate = useCallback((p: Page) => {
    // Save discover scroll before leaving it
    if (page.type === 'discover' && mainContentRef.current) {
      setDiscoverScrollY(mainContentRef.current.scrollTop);
    }

    // Push current page onto the back stack
    setPageStack(prev => {
      const last = prev[prev.length - 1];
      if (last?.type === page.type) return prev;
      return [...prev, page];
    });

    // Mark as programmatic so hashchange listener ignores it
    programmaticNavRef.current = true;
    window.location.hash = pageToHash(p);
    pendingScrollRef.current = 0;
    setPage(p);
  }, [page, setDiscoverScrollY]);

  const goBack = useCallback(() => {
    const stack = [...pageStack];
    const target = stack.pop() ?? { type: 'library' as const };
    pendingScrollRef.current = target.type === 'discover' ? discoverScrollY : 0;
    programmaticNavRef.current = true;
    window.location.hash = pageToHash(target);
    setPage(target);
    setPageStack(stack);
  }, [pageStack, discoverScrollY]);

  useEffect(() => {
    const onHashChange = () => {
      // Ignore hash changes we triggered ourselves
      if (programmaticNavRef.current) {
        programmaticNavRef.current = false;
        return;
      }
      // Genuine browser navigation (back/forward) — reset stack and scroll
      setPageStack([]);
      pendingScrollRef.current = 0;
      setPage(parseHash());
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const renderPage = () => {
    switch (page.type) {
      case 'library': return <Library onNavigate={navigate} />;
      case 'podcast': return <PodcastDetail key={page.id} podcastId={page.id} onNavigate={navigate} onBack={pageStack.length > 0 ? goBack : undefined} />;
      case 'discover': return <Discover onNavigate={navigate} />;
      case 'history': return <History />;
      case 'playlists': return <Playlists onNavigate={navigate} />;
      case 'playlist': return <PlaylistDetail playlistId={page.id} onNavigate={navigate} />;
      case 'settings': return <Settings onNavigate={navigate} />;
      case 'help': return <Help />;
      default: return <Library onNavigate={navigate} />;
    }
  };

  return (
    <PlayerContext.Provider value={player}>
      <div className={`app-layout ${player.episode ? 'has-player' : ''}`}>
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        <div className={`sidebar-container ${sidebarOpen ? 'open' : ''}`}>
          <Sidebar currentPage={page} onNavigate={navigate} onClose={() => setSidebarOpen(false)} />
        </div>

        <div className="main-area">
          <header className="app-header">
            <button className="btn-icon mobile-menu" onClick={() => setSidebarOpen(o => !o)}>
              {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
            <button
              className="brand-logo-btn"
              onClick={() => navigate({ type: 'library' })}
              aria-label="Go to library"
            >
              <img src="/podda-logo.png" alt="podda" className="brand-logo brand-logo--header" />
            </button>
          </header>
          <AnnouncementBanner />
          <main className="main-content" ref={mainContentRef}>
            {renderPage()}
          </main>
        </div>

        <Player onNavigate={navigate} />
        <HintManager />
        <WhatsNewSheet />
      </div>
    </PlayerContext.Provider>
  );
}

export default function App() {
  const auth = useAuthState();

  if (auth.loading) {
    return <div className="app-loading">Loading...</div>;
  }

  return (
    <AuthContext.Provider value={auth}>
      {auth.user ? <PreferencesProvider key={auth.user.id}><OverlayProvider><AppContent /></OverlayProvider></PreferencesProvider> : <Login />}
    </AuthContext.Provider>
  );
}
