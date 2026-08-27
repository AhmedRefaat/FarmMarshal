/**
 * Login.tsx — sign-in page.
 * Shows demo credentials for quick testing; role comes from the server.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { signInWithGoogle } from '../googleAuth';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('owner@agri.com'); // prefilled for demos
  const [password, setPassword] = useState('pass123');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  /** Submit credentials; on success the App shell re-renders by itself. */
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>🌾 AgriTasks</h1>
        <p>Land Owner Portal</p>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
        <input
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        {/* Google Sign-In — same session storage as password login */}
        <button
          type="button"
          onClick={async () => {
            setError('');
            try {
              const { token, user } = await signInWithGoogle();
              localStorage.setItem('agritasks_token', token);
              localStorage.setItem('agritasks_user', JSON.stringify(user));
              window.location.href = '/'; // full reload picks up the session
            } catch (e: any) {
              setError(e?.message ?? 'Google sign-in failed');
            }
          }}
        >
          🔵 Continue with Google
        </button>
        <small>Demo: owner@ / moderator@ / worker@agri.com — pass123</small>
      </form>
    </div>
  );
}
