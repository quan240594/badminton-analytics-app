import { describe, it, expect, vi, beforeEach } from 'vitest';

const renderMock = vi.fn();
const createRootMock = vi.fn(() => ({ render: renderMock }));

vi.mock('react-dom/client', () => ({ default: { createRoot: createRootMock } }));
vi.mock('./App.jsx', () => ({ default: () => null }));
vi.mock('./hooks/useAuth.jsx', () => ({ AuthProvider: ({ children }) => children }));

describe('main.jsx entrypoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
  });

  it('mounts the app into #root', async () => {
    await import('./main.jsx');
    expect(createRootMock).toHaveBeenCalledWith(document.getElementById('root'));
    expect(renderMock).toHaveBeenCalledTimes(1);
  });
});
