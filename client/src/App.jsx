import { useEffect, useState } from 'react';
import MatchSimulator from './pages/MatchSimulator.jsx';
import LeagueDaySimulator from './pages/LeagueDaySimulator.jsx';

// Lightweight hash-based routing (no react-router) since this is just two
// static pages - keeps it deep-linkable/bookmarkable without extra dependencies
// or server-side rewrite support, which GitHub Pages doesn't provide anyway.
const PAGES = [
  { hash: '#/', label: 'Match Simulator', Component: MatchSimulator },
  { hash: '#/league-day', label: 'League Day Simulator', Component: LeagueDaySimulator },
];

function resolvePage(hash) {
  return PAGES.find((p) => p.hash === hash) ?? PAGES[0];
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const { Component } = resolvePage(hash);

  return (
    <>
      <nav className="top-nav">
        {PAGES.map((p) => (
          <a key={p.hash} href={p.hash} className={resolvePage(hash).hash === p.hash ? 'active' : ''}>
            {p.label}
          </a>
        ))}
      </nav>
      <Component />
    </>
  );
}
