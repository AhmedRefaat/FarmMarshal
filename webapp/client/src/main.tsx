/**
 * main.tsx — Vite entry point: mounts the React tree and global styles.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { asset } from './assets';
import './styles.css';

// The login backdrop is injected rather than hard-coded in CSS so it survives
// a deploy sub-path (see assets.ts).
document.documentElement.style.setProperty(
  '--login-photo',
  `url('${asset('images/01-farm-overview.jpg')}')`
);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
