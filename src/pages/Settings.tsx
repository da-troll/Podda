import { useState, useEffect, useRef } from 'react';
import { api } from '../api';
import { useAuthContext } from '../hooks/useAuth';
import { Upload, LogOut, FileText, Megaphone, Trash2, HelpCircle } from 'lucide-react';
import { usePreferences } from '../hooks/usePreferences';
import type { Announcement, ClientDevice, Page } from '../types';

interface SettingsProps {
  onNavigate: (page: Page) => void;
}

export function Settings({ onNavigate }: SettingsProps) {
  const { user, logout } = useAuthContext();
  const [importing, setImporting] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [importError, setImportError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setImportResult(null);
      setImportError('');
    }
  };

  const handleOpmlImport = async () => {
    if (!selectedFile) return;

    setImporting(true);
    setImportResult(null);
    setImportError('');
    try {
      const text = await selectedFile.text();
      const result = await api.importOpml(text) as { total: number; success: number; failed: number };
      setImportResult(result);
      setSelectedFile(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err: any) {
      setImportError(`Import failed: ${err.message}`);
    }
    setImporting(false);
  };

  return (
    <div className="page settings">
      <div className="page-header">
        <h1>Settings</h1>
        <button
          className="btn-icon"
          title="Help"
          aria-label="Help"
          onClick={() => onNavigate({ type: 'help' })}
        >
          <HelpCircle size={20} />
        </button>
      </div>

      <ChannelPreferences />

      <section className="settings-section">
        <h2>Account</h2>
        <div className="settings-card">
          <div className="settings-row">
            <span className="settings-row-label">
              Logged in as <strong>{user?.displayName || user?.username}</strong>
            </span>
            <button className="btn-secondary-danger" onClick={logout}>
              <LogOut size={14} /> Sign out
            </button>
          </div>
        </div>
      </section>

      <section className="settings-section">
        <h2>Import Podcasts (OPML)</h2>
        <div className="settings-card">
          <p className="hint" style={{ marginBottom: 14 }}>
            Export your subscriptions from Castbox (or any podcast app) as OPML, then import here.
          </p>
          <div className="opml-dropzone">
            <input
              ref={fileRef}
              id="opml-file"
              type="file"
              accept=".opml,.xml"
              onChange={handleFileSelect}
              className="opml-file-input"
            />
            <label htmlFor="opml-file" className="opml-browse-btn">
              <Upload size={15} /> Browse Files
            </label>
            {selectedFile && (
              <div className="opml-selected">
                <span className="opml-filename">
                  <FileText size={13} /> {selectedFile.name}
                </span>
                <button
                  className="btn-primary"
                  onClick={handleOpmlImport}
                  disabled={importing}
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
              </div>
            )}
            {importing && <span className="hint">This may take a minute…</span>}
          </div>
          {importError && <div className="error-msg">{importError}</div>}
          {importResult && (
            <div className="import-result" style={{ marginTop: 12 }}>
              Imported {importResult.success} of {importResult.total} podcasts.
              {importResult.failed > 0 && ` (${importResult.failed} failed)`}
            </div>
          )}
        </div>
      </section>

      {user?.isAdmin && <AdminAnnouncements />}
      {user?.isAdmin && <AdminDevices />}
    </div>
  );
}

const CHECK_LABELS: Record<string, string> = {
  banner: 'update banner shown',
  'up-to-date': 'up to date',
  dismissed: 'update available, banner dismissed',
  'fetch-error': 'check failed',
  'http-error': 'check failed (server error)',
  'bad-json': 'check failed (bad response)',
};

// Device-local time with its zone, e.g. "11 Oct, 15:48 CEST".
const stamp = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' });

/** HIVE-1180: which app or web version each family member last used, per device. */
function AdminDevices() {
  const [devices, setDevices] = useState<ClientDevice[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.getDevices().then(setDevices).catch(err => setError((err as Error).message));
  }, []);
  return (
    <section className="settings-section">
      <h2>Devices</h2>
      <div className="settings-card">
        <p className="hint">Which Podda each person last used. App builds before 1.2.3 cannot report their version or update check.</p>
        {error && <div className="error-msg">{error}</div>}
        {devices && !devices.length && <p className="hint">No devices seen yet.</p>}
        <div className="announcement-list">
          {devices?.map(d => (
            <div key={`${d.username}-${d.deviceId}`} className="announcement-list-item">
              <div className="announcement-list-info">
                <strong>
                  {d.displayName || d.username} · {d.platform === 'android-app'
                    ? `Android app ${d.appVersion ?? '(version unknown, before 1.2.3)'}`
                    : `Web ${d.webVersion ?? '(old tab)'}`}
                </strong>
                {d.userAgent && <span className="announcement-list-body">{/\(([^)]*)\)/.exec(d.userAgent)?.[1] ?? d.userAgent}</span>}
                <span className="announcement-list-meta">
                  Last seen {stamp(d.lastSeen)}
                  {d.platform === 'android-app' && (d.updateCheckAt
                    ? ` · Update check ${stamp(d.updateCheckAt)}: ${CHECK_LABELS[d.updateCheckResult ?? ''] ?? d.updateCheckResult}${d.updateCheckDetail ? ` (${d.updateCheckDetail})` : ''}`
                    : ' · Update check: not reported')}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function AdminAnnouncements() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<'info' | 'warning' | 'success'>('info');
  const [expiresIn, setExpiresIn] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const load = () => {
    (api.getAllAnnouncements() as Promise<Announcement[]>)
      .then(setAnnouncements)
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async () => {
    if (!title.trim()) return;
    setCreating(true);
    setError('');
    try {
      let expires_at: string | undefined;
      if (expiresIn) {
        const hours = parseInt(expiresIn);
        if (!isNaN(hours) && hours > 0) {
          expires_at = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
        }
      }
      await api.createAnnouncement({ title: title.trim(), body: body.trim() || undefined, type, expires_at });
      setTitle('');
      setBody('');
      setType('info');
      setExpiresIn('');
      load();
    } catch (err: any) {
      setError(err.message);
    }
    setCreating(false);
  };

  const handleDelete = async (id: number) => {
    await api.deleteAnnouncement(id).catch(() => {});
    setAnnouncements(prev => prev.filter(a => a.id !== id));
  };

  return (
    <section className="settings-section">
      <h2>Announcements</h2>
      <div className="settings-card">
        <div className="announcement-form">
          <input
            type="text"
            placeholder="Announcement title"
            value={title}
            onChange={e => setTitle(e.target.value)}
            maxLength={200}
            className="input"
          />
          <textarea
            placeholder="Details (optional)"
            value={body}
            onChange={e => setBody(e.target.value)}
            maxLength={1000}
            rows={2}
            className="input"
          />
          <div className="announcement-form-row">
            <select value={type} onChange={e => setType(e.target.value as any)} className="input announcement-select">
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="success">Success</option>
            </select>
            <input
              type="number"
              placeholder="Expires in hours (optional)"
              value={expiresIn}
              onChange={e => setExpiresIn(e.target.value)}
              min={1}
              className="input announcement-expires"
            />
            <button className="btn-primary" onClick={handleCreate} disabled={creating || !title.trim()}>
              <Megaphone size={14} /> {creating ? 'Sending...' : 'Send'}
            </button>
          </div>
          {error && <div className="error-msg">{error}</div>}
        </div>

        {announcements.length > 0 && (
          <div className="announcement-list">
            {announcements.map(a => (
              <div key={a.id} className={`announcement-list-item announcement-${a.type}`}>
                <div className="announcement-list-info">
                  <strong>{a.title}</strong>
                  {a.body && <span className="announcement-list-body">{a.body}</span>}
                  <span className="announcement-list-meta">
                    {new Date(a.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {a.expires_at && ` · expires ${new Date(a.expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </div>
                <button className="btn-icon" onClick={() => handleDelete(a.id)} title="Delete">
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function ChannelPreferences() {
  const { preferences, loading, error: loadError, save } = usePreferences();
  const [sort, setSort] = useState(preferences.channelSort);
  const [hideCompleted, setHideCompleted] = useState(preferences.channelHideCompleted);
  const [rememberScroll, setRememberScroll] = useState(preferences.rememberScroll);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  useEffect(() => { setSort(preferences.channelSort); setHideCompleted(preferences.channelHideCompleted); setRememberScroll(preferences.rememberScroll); }, [preferences]);
  const submit = async () => {
    setSaving(true); setError(''); setSaved(false);
    try { await save({ channelSort: sort, channelHideCompleted: hideCompleted, rememberScroll }); setSaved(true); }
    catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  };
  return <section className="settings-section"><h2>Preferences</h2><div className="settings-card">
    <p className="hint">Defaults for every channel, saved to your account across devices. A channel can override them in its own settings (the gear on the channel page).</p>
    <label className="settings-row"><span>Default channel order</span><select className="sort-select" value={sort} disabled={loading || saving} onChange={e => { setSort(e.target.value as typeof sort); setSaved(false); }}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
    <label className="settings-row checkbox-label"><input type="checkbox" checked={hideCompleted} disabled={loading || saving} onChange={e => { setHideCompleted(e.target.checked); setSaved(false); }} /><span>Hide completed episodes by default</span></label>
    <label className="settings-row checkbox-label"><input type="checkbox" checked={rememberScroll} disabled={loading || saving} onChange={e => { setRememberScroll(e.target.checked); setSaved(false); }} /><span>Remember scroll position in channels and playlists</span></label>
    <p className="hint">Partially listened episodes remain visible when completed ones are hidden. With scroll position off, lists open at the top.</p>
    <button className="btn-primary" disabled={loading || saving} onClick={submit}>{saving ? 'Saving…' : 'Save preferences'}</button>
    {saved && <p role="status">Preferences saved.</p>}{(error || loadError) && <p className="error-msg" role="alert">{error || loadError}</p>}
  </div></section>;
}
