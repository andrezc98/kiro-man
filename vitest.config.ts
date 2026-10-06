import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
      'scripts/**/*.test.ts',
      'infra/lambda/**/*.test.ts',
      'mcp/arcade-operator/src/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**'],
    environment: 'node',
    testTimeout: 20000,
  },
});
