import { useState } from 'react';
import {
  triggerRefresh,
  fetchRefreshProgress,
  reloadBundle,
  triggerGithubWorkflowRefresh,
  pollGithubWorkflowRun,
} from '../api.js';

// Extracted from MatchSimulator so any page can share the same "Fetch data"
// mechanics: local-dev polling vs. GitHub Actions polling in production.
export default function useDataRefresh(onRefreshed) {
  const [refreshState, setRefreshState] = useState({ running: false, percent: 0, detail: '', error: null });
  const [showUnchanged, setShowUnchanged] = useState(false);

  const applyRefreshedBundle = async () => {
    const bundle = await reloadBundle();
    onRefreshed(bundle);
  };

  // Local dev: polls server/index.js's own refresh_progress.json (see api.js).
  const fetchDataLocal = async () => {
    try {
      await triggerRefresh();
    } catch (e) {
      setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
      return;
    }
    const poll = async () => {
      let progress;
      try {
        progress = await fetchRefreshProgress();
      } catch {
        setRefreshState({ running: false, percent: 0, detail: '', error: 'Lost connection to the refresh server.' });
        return;
      }
      setRefreshState({ running: progress.running, percent: progress.percent, detail: progress.detail, error: progress.error });
      if (progress.running) {
        setTimeout(poll, 1000);
        return;
      }
      if (progress.error) return;
      if (progress.unchanged) {
        setShowUnchanged(true);
        setTimeout(() => setShowUnchanged(false), 3000);
        return;
      }
      await applyRefreshedBundle();
    };
    poll();
  };

  // Production (GitHub Pages): no backend to hit, so trigger the deploy.yml
  // workflow directly via the GitHub API and poll its run status instead.
  const fetchDataGithub = async () => {
    let dispatchedAt;
    try {
      dispatchedAt = await triggerGithubWorkflowRefresh();
    } catch (e) {
      setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
      return;
    }
    const poll = async () => {
      let run;
      try {
        run = await pollGithubWorkflowRun(dispatchedAt);
      } catch (e) {
        setRefreshState({ running: false, percent: 0, detail: '', error: e.message });
        return;
      }
      const running = run.status !== 'completed';
      const percent = run.status === 'completed' ? 100 : run.status === 'in_progress' ? 60 : 15;
      setRefreshState({ running, percent, detail: run.status, error: null });
      if (running) {
        setTimeout(poll, 5000);
        return;
      }
      if (run.conclusion !== 'success') {
        setRefreshState({
          running: false,
          percent: 100,
          detail: run.status,
          error: `GitHub Actions run finished with "${run.conclusion}" — check the Actions tab for details.`,
        });
        return;
      }
      await applyRefreshedBundle();
    };
    // Give GitHub a moment to register the dispatched run before the first poll.
    setTimeout(poll, 5000);
  };

  const fetchData = () => {
    setShowUnchanged(false);
    setRefreshState({ running: true, percent: 0, detail: 'starting…', error: null });
    if (import.meta.env.DEV) fetchDataLocal();
    else fetchDataGithub();
  };

  return { refreshState, showUnchanged, fetchData };
}
