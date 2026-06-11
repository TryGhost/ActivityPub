import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [tsconfigPaths()],
    test: {
        testTimeout: 1000 * 10,
        setupFiles: ['./src/temporal-polyfill.ts'],
    },
});
