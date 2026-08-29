/**
 * Login.tsx — sign-in page.
 * Shows demo credentials for quick testing; role comes from the server.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { signInWithGoogle } from '../googleAuth';
import { LocaleSwitch, useI18n } from '../i18n';

export default function Login() {
  const { login } = useAuth();
  const { t } = useI18n();
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
    } catch {
      // Server wording is developer-facing (ADR-029); show localized copy.
      setError(t('login.failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <img className="login-mark" src="/logo.png" alt={t('app.name')} />
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
        <input
          placeholder={t('login.email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          type="email"
          required
        />
        <input
          placeholder={t('login.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          required
        />
        {error && <p className="error">{error}</p>}
        <button disabled={busy}>
          {busy ? t('login.signingIn') : t('login.signIn')}
        </button>

        {/* Google Sign-In — same session storage as password login */}
        <button
          type="button"
          onClick={async () => {
            setError('');
            try {
              const { token, user } = await signInWithGoogle();
              localStorage.setItem('farmmarshal_token', token);
              localStorage.setItem('farmmarshal_user', JSON.stringify(user));
              window.location.href = '/'; // full reload picks up the session
            } catch {
              setError(t('login.googleFailed'));
            }
          }}
        >
          🔵 {t('login.google')}
        </button>
        <LocaleSwitch className="locale-switch login-locale" />
        <small>{t('login.demoHint')}</small>
      </form>
    </div>
  );
}
