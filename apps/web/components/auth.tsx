
'use client';

import { useState } from 'react';
import { post } from './api';
import { ErrorBox, Modal } from './ui';

type AuthMode = 'login' | 'register' | 'forgot';

interface AuthProps {
  onClose: () => void;
  onDone: () => void;
  admin?: boolean;
  googleEnabled?: boolean;
}

export function Auth({
  onClose,
  onDone,
  admin = false,
  googleEnabled = false,
}: AuthProps) {
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');

    try {
      // Send only fields required by each endpoint
      const payload =
        mode === 'register'
          ? { email: email.trim(), password, name: name.trim() }
          : mode === 'forgot'
            ? { email: email.trim() }
            : { email: email.trim(), password };

      const r = await post('/auth/' + mode, payload);

      if (mode === 'forgot') {
        setMessage(String(r.message));
      } else {
        onDone();
      }
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError('');
    setMessage('');
  }

  return (
    <Modal
      title={
        admin
          ? 'Admin sign in'
          : mode === 'register'
            ? 'Create your account'
            : mode === 'forgot'
              ? 'Reset your password'
              : 'Welcome back'
      }
      onClose={onClose}
    >
      <p className="muted">
        {admin
          ? 'Sign in with an administrator account to manage questions.'
          : 'Make every query count. Save your progress and pick up where you left off.'}
      </p>

      <form className="form" onSubmit={submit}>
        {mode === 'register' && (
          <label>
            Name
            <input
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              minLength={2}
            />
          </label>
        )}

        <label>
          Email address
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        {mode !== 'forgot' && (
          <label>
            Password
            <input
              type="password"
              autoComplete={
                mode === 'register'
                  ? 'new-password'
                  : 'current-password'
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
            />
            <small>At least 10 characters</small>
          </label>
        )}

        <ErrorBox message={error} />

        {message && <p className="success">{message}</p>}

        <button className="primary" type="submit" disabled={busy}>
          {busy
            ? 'Please wait…'
            : mode === 'register'
              ? 'Create account'
              : mode === 'forgot'
                ? 'Send reset link'
                : 'Sign in'}
        </button>
      </form>

      {!admin && googleEnabled && (
        <a className="button full" href="/api/auth/google">
          Continue with Google
        </a>
      )}

      {!admin && (
        <div className="auth-links">
          <button
            type="button"
            onClick={() =>
              changeMode(mode === 'register' ? 'login' : 'register')
            }
          >
            {mode === 'register'
              ? 'Already have an account?'
              : 'Create an account'}
          </button>

          <button type="button" onClick={() => changeMode('forgot')}>
            Forgot password?
          </button>
        </div>
      )}

      {!admin && (
        <button
          type="button"
          className="quiet full"
          onClick={async () => {
            setError('');

            try {
              await post('/auth/guest');
              onDone();
            } catch (err) {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Guest login failed.'
              );
            }
          }}
        >
          Continue as guest
        </button>
      )}
    </Modal>
  );
}
