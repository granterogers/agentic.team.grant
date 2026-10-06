import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // No --passWithNoTests. An empty suite that reports success is a harness
    // that cannot fail, which is worse than no harness at all.
    passWithNoTests: false,
    environment: 'node',
    // Tests that start a child process time out at the default 5 s on a loaded machine, which reads as a failure of the
    // thing under test; the ceiling is generous so a red result means something.
    testTimeout: 30_000,
    // Every test file starts with no production credential in its environment (tests/setup/hermetic.ts).
    setupFiles: ['tests/setup/hermetic.ts'],
    restoreMocks: true,
    coverage: { provider: 'v8', reporter: ['text', 'lcov'], include: ['src/**/*.ts'] },
  },
})
