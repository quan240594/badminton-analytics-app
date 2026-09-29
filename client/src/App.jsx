import { useEffect, useState } from 'react';
import MatchSimulator from './pages/MatchSimulator.jsx';
import LeagueDaySimulator from './pages/LeagueDaySimulator.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import VerifyEmail from './pages/VerifyEmail.jsx';
import Account from './pages/Account.jsx';
import { useAuth } from './hooks/useAuth.jsx';

// Lightweight hash-based routing (no react-router) since this is just a
// handful of pages - keeps it deep-linkable/bookmarkable without extra
// dependencies or server-side rewrite support, which GitHub Pages doesn't
// provide anyway.
const PAGES = [
  { hash: '#/', label: 'Match Simulator', Component: MatchSimulator },
  { hash: '#/league-day', label: 'League Day Simulator', Component: LeagueDaySimulator },
];

// Unauthenticated-only routes; matched by hash prefix so query strings
// (e.g. #/verify-email?email=...) still resolve.
const AUTH_PAGES = [
  { prefix: '#/login', Component: Login },
  { prefix: '#/register', Component: Register },
  { prefix: '#/verify-email', Component: VerifyEmail },
];

// Authenticated-only routes that sit outside the main nav tabs.
const EXTRA_PAGES = [{ prefix: '#/account', Component: Account }];

function resolvePage(hash) {
  return PAGES.find((p) => p.hash === hash) ?? PAGES[0];
}

function resolveAuthPage(hash) {
  return AUTH_PAGES.find((p) => hash.startsWith(p.prefix));
}

function resolveExtraPage(hash) {
  return EXTRA_PAGES.find((p) => hash.startsWith(p.prefix));
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);
  const { session, loading, signOut } = useAuth();

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // Bounces signed-out users to the login page and signed-in users away from
  // the auth pages, without pulling in a full router just for this.
  useEffect(() => {
    if (loading) return;
    const onAuthPage = Boolean(resolveAuthPage(hash));
    if (!session && !onAuthPage) {
      window.location.hash = '#/login';
    } else if (session && onAuthPage) {
      window.location.hash = '#/';
    }
  }, [session, loading, hash]);

  if (loading) return null;

  const authPage = resolveAuthPage(hash);
  if (authPage) return <authPage.Component />;
  if (!session) return null; // redirect effect above is about to fire

  const extraPage = resolveExtraPage(hash);
  const { Component } = extraPage ?? resolvePage(hash);

  return (
    <>
      <nav className="top-nav">
        {PAGES.map((p) => (
          <a key={p.hash} href={p.hash} className={!extraPage && resolvePage(hash).hash === p.hash ? 'active' : ''}>
            {p.label}
          </a>
        ))}
        <span className="nav-spacer" />
        <a href="#/account" className={extraPage ? 'active' : ''}>
          Account
        </a>
        <span className="nav-user">{session.user.email}</span>
        <button type="button" className="link-btn" onClick={() => signOut()}>
          Log out
        </button>
      </nav>
      <Component />
    </>
  );
}
