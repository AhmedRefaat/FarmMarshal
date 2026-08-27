/**
 * googleAuth.ts — "Sign in with Google" for the web client.
 * ---------------------------------------------------------------------------
 * 1. Firebase JS SDK opens the Google popup and returns an id_token.
 * 2. The token is exchanged at POST /auth/google for our app session
 *    {token, user} — stored exactly like a password login.
 *
 * SETUP (one time): replace firebaseConfig placeholders in this file AND
 * enable Google as a sign-in provider in Firebase Console → Authentication.
 */

import { initializeApp, getApps } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
} from 'firebase/auth';

// Same Firebase project as the mobile app — paste your real web config here.
const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
};

const fbApp = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
const fbAuth = getAuth(fbApp);

/**
 * Runs the Google popup flow and exchanges the resulting id_token with our
 * API. @returns the same session shape as /auth/login.
 */
export async function signInWithGoogle(): Promise<{ token: string; user: any }> {
  const cred = await signInWithPopup(fbAuth, new GoogleAuthProvider());
  // Force-refresh so the token is guaranteed valid right now.
  const idToken = await cred.user.getIdToken(true);
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) throw new Error('Google sign-in exchange failed');
  return res.json();
}
