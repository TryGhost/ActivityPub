import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        testTimeout: 1000 * 30,
        hookTimeout: 1000 * 60,
        minWorkers: 1,
        maxWorkers: 4,
    },
});
