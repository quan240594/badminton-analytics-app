import { useState } from 'react';
import {
  triggerPoolRefresh,
  fetchPoolRefreshProgress,
  triggerGithubWorkflowPoolRefresh,
  pollGithubWorkflowRun,
  reloadBundle,
} from '../api.js';
import { percentForRunStatus, githubRunFailureMessage, LOST_CONNECTION_MESSAGE } from '../lib/poolUtils.js';

const LOCAL_POLL_MS = 1000;
const GITHUB_POLL_MS = 5000;

// Scoped alternative to "Fetch data": only pulls one pool's players/matches
// (fetch_pool.py), so picking an uncached pool doesn't pay for a full refresh.
// onRefreshed receives the reloaded bundle once the pool data has landed.
export default function usePoolFetch(drawId, onRefreshed) {
  const [poolFetchState, setPoolFetchState] = useState({ running: false, percent: 0, error: null });

  const fail = (error) => setPoolFetchState({ running: false, percent: 0, error });
  const applyRefreshedPool = async () => onRefreshed(await reloadBundle());

  const fetchLocal = async () => {
    try {
      await triggerPoolRefresh(drawId);
    } catch (e) {
      fail(e.message);
      return;
    }
    const poll = async () => {
      let progress;
      try {
        progress = await fetchPoolRefreshProgress();
      } catch {
        fail(LOST_CONNECTION_MESSAGE);
        return;
      }
      setPoolFetchState({ running: progress.running, percent: progress.percent, error: progress.error });
      if (progress.running) {
        setTimeout(() => void poll(), LOCAL_POLL_MS);
        return;
      }
      if (progress.error) return;
      await applyRefreshedPool();
    };
    void poll();
  };

  // Production (GitHub Pages): no local server, so dispatch deploy.yml with draw_id and poll its run.
  const fetchGithub = async () => {
    let dispatchedAt;
    try {
      dispatchedAt = await triggerGithubWorkflowPoolRefresh(drawId);
    } catch (e) {
      fail(e.message);
      return;
    }
    const poll = async () => {
      let run;
      try {
        run = await pollGithubWorkflowRun(dispatchedAt);
      } catch (e) {
        fail(e.message);
        return;
      }
      const running = run.status !== 'completed';
      setPoolFetchState({ running, percent: percentForRunStatus(run.status), error: null });
      if (running) {
        setTimeout(() => void poll(), GITHUB_POLL_MS);
        return;
      }
      if (run.conclusion !== 'success') {
        setPoolFetchState({ running: false, percent: 100, error: githubRunFailureMessage(run.conclusion) });
        return;
      }
      await applyRefreshedPool();
    };
    // Give GitHub a moment to register the dispatched run before the first poll.
    setTimeout(() => void poll(), GITHUB_POLL_MS);
  };

  const fetchPoolData = async () => {
    if (!drawId) return;
    setPoolFetchState({ running: true, percent: 0, error: null });
    await (import.meta.env.DEV ? fetchLocal() : fetchGithub());
  };

  return { poolFetchState, fetchPoolData };
}
