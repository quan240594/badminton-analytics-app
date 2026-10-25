import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// jsdom doesn't implement scrollIntoView; ClubSelect/PlayerSelect call it on their active option.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// RTL's auto-cleanup only registers itself when it detects vitest's globals API;
// since this project doesn't enable test.globals, unmount explicitly instead.
afterEach(() => {
  cleanup();
});
