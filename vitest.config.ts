import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Use node environment for API route testing
    environment: 'node',

    // Test file patterns
    include: ['**/*.test.ts', '**/*.test.tsx'],

    // Global test timeout (10 seconds)
    testTimeout: 10000,

    // Setup files to run before each test file
    setupFiles: ['./vitest.setup.ts'],

    // Enable coverage
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/**/*.ts',
        'pages/api/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        'lib/test-utils/**',
        'node_modules/**',
      ],
    },

    // Globals (so we don't need to import describe, it, expect in every file)
    globals: true,
  },

  // Path resolution to match tsconfig.json
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
    },
  },
});
