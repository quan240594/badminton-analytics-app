import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const api = vi.hoisted(() => ({
  triggerRefresh: vi.fn(),
  fetchRefreshProgress: vi.fn(),
  triggerPoolRefresh: vi.fn(),
  fetchPoolRefreshProgress: vi.fn(),
  reloadBundle: vi.fn(),
  triggerGithubWorkflowRefresh: vi.fn(),
  triggerGithubWorkflowPoolRefresh: vi.fn(),
  pollGithubWorkflowRun: vi.fn(),
}));

vi.mock('../api.js', () => api);

async function importHook() {
  vi.resetModules();
  return import('./useDataRefresh.js');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDataRefresh (local dev)', () => {
  it('polls until done and reloads the bundle on a plain success', async () => {
    api.triggerRefresh.mockResolvedValue();
    api.fetchRefreshProgress
      .mockResolvedValueOnce({ running: true, percent: 40, detail: 'events', error: null })
      .mockResolvedValueOnce({ running: false, percent: 100, detail: '', error: null, unchanged: false });
    api.reloadBundle.mockResolvedValue({ players: [] });
    const onRefreshed = vi.fn();

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(onRefreshed));

    await act(async () => {
      result.current.fetchData();
    });
    expect(result.current.refreshState.running).toBe(true);

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(api.triggerRefresh).toHaveBeenCalled();
    expect(onRefreshed).toHaveBeenCalledWith({ players: [] });
    expect(result.current.refreshState.running).toBe(false);
  });

  it('uses the pool-scoped endpoints when a drawId is provided', async () => {
    api.triggerPoolRefresh.mockResolvedValue();
    api.fetchPoolRefreshProgress.mockResolvedValueOnce({ running: false, percent: 100, detail: '', error: null });
    api.reloadBundle.mockResolvedValue({ players: [] });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn(), '12'));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(api.triggerPoolRefresh).toHaveBeenCalledWith('12');
    expect(api.fetchPoolRefreshProgress).toHaveBeenCalled();
  });

  it('sets an error and stops when triggering the refresh fails', async () => {
    api.triggerRefresh.mockRejectedValue(new Error('boom'));

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toBe('boom');
    expect(result.current.refreshState.running).toBe(false);
  });

  it('sets a "lost connection" error when polling progress fails', async () => {
    api.triggerRefresh.mockResolvedValue();
    api.fetchRefreshProgress.mockRejectedValue(new Error('network down'));

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toBe('Lost connection to the refresh server.');
  });

  it('shows the "already up to date" bubble and does not reload when unchanged', async () => {
    api.triggerRefresh.mockResolvedValue();
    api.fetchRefreshProgress.mockResolvedValueOnce({ running: false, percent: 100, detail: '', error: null, unchanged: true });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(result.current.showUnchanged).toBe(true);
    expect(api.reloadBundle).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current.showUnchanged).toBe(false);
  });

  it('stops polling and surfaces the progress error without reloading', async () => {
    api.triggerRefresh.mockResolvedValue();
    api.fetchRefreshProgress.mockResolvedValueOnce({ running: false, percent: 100, detail: '', error: 'scrape failed' });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toBe('scrape failed');
    expect(api.reloadBundle).not.toHaveBeenCalled();
  });
});

describe('useDataRefresh (production / GitHub Actions)', () => {
  beforeEach(() => {
    vi.stubEnv('DEV', false);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('dispatches the workflow and reloads the bundle once it completes successfully', async () => {
    api.triggerGithubWorkflowRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
    api.pollGithubWorkflowRun
      .mockResolvedValueOnce({ status: 'in_progress', conclusion: null })
      .mockResolvedValueOnce({ status: 'completed', conclusion: 'success' });
    api.reloadBundle.mockResolvedValue({ players: [] });
    const onRefreshed = vi.fn();

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(onRefreshed));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(api.triggerGithubWorkflowRefresh).toHaveBeenCalled();
    expect(onRefreshed).toHaveBeenCalledWith({ players: [] });
  });

  it('surfaces a run-failed error when the workflow concludes unsuccessfully', async () => {
    api.triggerGithubWorkflowRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
    api.pollGithubWorkflowRun.mockResolvedValueOnce({ status: 'completed', conclusion: 'failure' });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toContain('finished with "failure"');
  });

  it('retries transient poll failures before giving up', async () => {
    api.triggerGithubWorkflowRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
    api.pollGithubWorkflowRun
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValueOnce({ status: 'completed', conclusion: 'success' });
    api.reloadBundle.mockResolvedValue({ players: [] });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(api.pollGithubWorkflowRun).toHaveBeenCalledTimes(2);
    expect(result.current.refreshState.error).toBeNull();
  });

  it('gives up after too many consecutive poll failures', async () => {
    api.triggerGithubWorkflowRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
    api.pollGithubWorkflowRun.mockRejectedValue(new Error('down for good'));

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toBe('down for good');
  });

  it('sets an error when dispatching the workflow itself fails', async () => {
    api.triggerGithubWorkflowRefresh.mockRejectedValue(new Error('no token'));

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn()));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(result.current.refreshState.error).toBe('no token');
  });

  it('uses the pool-scoped github dispatch when a drawId is provided', async () => {
    api.triggerGithubWorkflowPoolRefresh.mockResolvedValue('2026-01-01T00:00:00.000Z');
    api.pollGithubWorkflowRun.mockResolvedValueOnce({ status: 'completed', conclusion: 'success' });
    api.reloadBundle.mockResolvedValue({ players: [] });

    const { default: useDataRefresh } = await importHook();
    const { result } = renderHook(() => useDataRefresh(vi.fn(), '12'));

    await act(async () => {
      result.current.fetchData();
      await vi.runAllTimersAsync();
    });

    expect(api.triggerGithubWorkflowPoolRefresh).toHaveBeenCalledWith('12');
  });
});
