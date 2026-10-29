import { useState } from 'react';
import { useAuthContext } from '../hooks/useAuth';

// HIVE-1526: the screen for an Authentik user with no Podda account (403 not_linked). Static: it
// never reloads or retries, so it cannot loop.
export function NotLinked() {
  const signOut = () => {
    const native = (window as any).__poddaAuth;
    if (native?.signOut) native.signOut();
    else window.location.href = '/outpost.goauthentik.io/sign_out';
  };
  return (
    <div className="login-page">
      <div className="login-form">
        <div className="login-brand">
          <img src="/podda-logo.png" alt="podda" className="brand-logo brand-logo--login" />
        </div>
        <p className="login-note">Your account is not set up in Podda.</p>
        <button type="button" className="btn-primary" onClick={signOut}>Sign out</button>
      </div>
    </div>
  );
}

export function Login() {
  const { login } = useAuthContext();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(username, password);
    } catch (err: any) {
      setError(err.message || 'Login failed');
    }
    setLoading(false);
  };

  return (
    <div className="login-page">
      <form className="login-form" onSubmit={handleSubmit}>
        <div className="login-brand">
          <img src="/podda-logo.png" alt="podda" className="brand-logo brand-logo--login" />
        </div>

        {error && <div className="error-msg">{error}</div>}

        {/* the Android app's Authentik sign-in (HIVE-1528) when that build provides it */}
        {(window as any).__poddaAuth?.signIn && (
          <button type="button" className="btn-primary" onClick={() => (window as any).__poddaAuth.signIn()}>
            Sign in with Authentik
          </button>
        )}

        <label>
          <span>Username</span>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            autoFocus
            required
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
        </label>

        <button type="submit" className="btn-primary" disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
