import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// RTL's auto-cleanup only registers itself when it detects vitest's globals API;
// since this project doesn't enable test.globals, unmount explicitly instead.
afterEach(() => {
  cleanup();
});
