import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  triggerPoolRefresh: vi.fn(),
  fetchPoolRefreshProgress: vi.fn(),
  triggerGithubWorkflowPoolRefresh: vi.fn(),
  pollGithubWorkflowRun: vi.fn(),
  reloadBundle: vi.fn(),
}));
vi.mock('../api.js', () => api);

const BUNDLE = { players: [], meta: {} };

async function runFetch(drawId = '12') {
  const { default: usePoolFetch } = await import('./usePoolFetch.js');
  const onRefreshed = vi.fn();
  const { result } = renderHook(() => usePoolFetch(drawId, onRefreshed));
  await act(async () => {
    await result.current.fetchPoolData();
    await vi.runAllTimersAsync();
  });
  return { result, onRefreshed };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  api.reloadBundle.mockResolvedValue(BUNDLE);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe('usePoolFetch', () => {
  it('does nothing without a drawId', async () => {
    const { result } = await runFetch('');

    expect(api.triggerPoolRefresh).not.toHaveBeenCalled();
    expect(result.current.poolFetchState).toEqual({ running: false, percent: 0, error: null });
  });
});

describe('usePoolFetch (local dev)', () => {
  it('polls the refresh progress until done, then hands the reloaded bundle to onRefreshed', async () => {
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress
      .mockResolvedValueOnce({ running: true, percent: 40, error: null })
      .mockResolvedValueOnce({ running: false, percent: 100, error: null });

    const { result, onRefreshed } = await runFetch();

    expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12');
    expect(api.fetchPoolRefreshProgress).toHaveBeenCalledTimes(2);
    expect(onRefreshed).toHaveBeenCalledWith(BUNDLE);
    expect(result.current.poolFetchState).toEqual({ running: false, percent: 100, error: null });
  });

  it('reports the progress while the refresh is still running', async () => {
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValueOnce({ running: true, percent: 40, error: null });
    const { default: usePoolFetch } = await import('./usePoolFetch.js');
    const { result } = renderHook(() => usePoolFetch('12', vi.fn()));

    await act(async () => {
      await result.current.fetchPoolData();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.poolFetchState).toEqual({ running: true, percent: 40, error: null });
  });

  it.each([
    ['the refresh cannot be started', () => api.triggerPoolRefresh.mockRejectedValue(new Error('boom')), 'boom'],
    [
      'polling the progress fails',
      () => {
        api.triggerPoolRefresh.mockResolvedValue();
        api.fetchPoolRefreshProgress.mockRejectedValue(new Error('offline'));
      },
      'Lost connection to the refresh server.',
    ],
    [
      'the scraper reports an error',
      () => {
        api.triggerPoolRefresh.mockResolvedValue();
        api.fetchPoolRefreshProgress.mockResolvedValue({ running: false, percent: 100, error: 'scrape failed' });
      },
      'scrape failed',
    ],
  ])('surfaces an error without reloading when %s', async (_case, arrange, message) => {
    arrange();

    const { result, onRefreshed } = await runFetch();

    expect(result.current.poolFetchState.error).toBe(message);
    expect(result.current.poolFetchState.running).toBe(false);
    expect(api.reloadBundle).not.toHaveBeenCalled();
    expect(onRefreshed).not.toHaveBeenCalled();
  });
});

describe('usePoolFetch (production / GitHub Actions)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
    api.triggerGithubWorkflowPoolRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
  });

  it('dispatches the workflow, polls its run and reloads the bundle once it succeeds', async () => {
    api.pollGithubWorkflowRun
      .mockResolvedValueOnce({ status: 'queued', conclusion: null })
      .mockResolvedValueOnce({ status: 'in_progress', conclusion: null })
      .mockResolvedValueOnce({ status: 'completed', conclusion: 'success' });

    const { result, onRefreshed } = await runFetch();

    expect(api.triggerGithubWorkflowPoolRefresh).toHaveBeenCalledWith('12');
    expect(api.pollGithubWorkflowRun).toHaveBeenCalledWith('2026-01-01T00:00:00.000Z');
    expect(api.pollGithubWorkflowRun).toHaveBeenCalledTimes(3);
    expect(onRefreshed).toHaveBeenCalledWith(BUNDLE);
    expect(result.current.poolFetchState).toEqual({ running: false, percent: 100, error: null });
  });

  it('reports a percentage derived from the run status while it is running', async () => {
    api.pollGithubWorkflowRun.mockResolvedValueOnce({ status: 'in_progress', conclusion: null });
    const { default: usePoolFetch } = await import('./usePoolFetch.js');
    const { result } = renderHook(() => usePoolFetch('12', vi.fn()));

    await act(async () => {
      await result.current.fetchPoolData();
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(result.current.poolFetchState).toEqual({ running: true, percent: 60, error: null });
  });

  it('surfaces a failed run without reloading', async () => {
    api.pollGithubWorkflowRun.mockResolvedValueOnce({ status: 'completed', conclusion: 'failure' });

    const { result, onRefreshed } = await runFetch();

    expect(result.current.poolFetchState).toEqual({
      running: false,
      percent: 100,
      error: 'GitHub Actions run finished with "failure" — check the Actions tab for details.',
    });
    expect(onRefreshed).not.toHaveBeenCalled();
  });

  it.each([
    ['dispatching the workflow fails', () => api.triggerGithubWorkflowPoolRefresh.mockRejectedValue(new Error('no token')), 'no token'],
    ['polling the run fails', () => api.pollGithubWorkflowRun.mockRejectedValue(new Error('rate limited')), 'rate limited'],
  ])('surfaces an error when %s', async (_case, arrange, message) => {
    arrange();

    const { result } = await runFetch();

    expect(result.current.poolFetchState).toEqual({ running: false, percent: 0, error: message });
    expect(api.reloadBundle).not.toHaveBeenCalled();
  });
});
