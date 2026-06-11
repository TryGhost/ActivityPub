// Install the @js-temporal/polyfill onto `globalThis.Temporal` so that bare
// references to the ambient `Temporal.*` types (which Fedify v2.2.2+ uses in
// its type declarations via `esnext.temporal`) are backed by a real runtime
// implementation on Node.js versions that do not yet ship native Temporal.
//
// This file must be imported (for side effects) before any code that uses
// `Temporal.*`. It is imported at the top of `src/app.ts` for production and
// wired into `vitest.config.ts` via `setupFiles` for tests.
import { Temporal } from '@js-temporal/polyfill';

if (typeof (globalThis as { Temporal?: unknown }).Temporal === 'undefined') {
    (globalThis as { Temporal: unknown }).Temporal = Temporal;
}
