import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    coverage: {
      provider: 'v8',
      // lcov is what SonarQube Cloud's javascript.lcov.reportPaths expects.
      reporter: ['lcov', 'text'],
    },
  },
});
