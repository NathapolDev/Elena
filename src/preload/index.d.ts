/**
 * Renderer-side declaration of the bridge.
 *
 * The shape itself lives in `@shared/ipc` and is what `src/preload/index.ts`
 * is checked against, so there is no second hand-written copy to drift. This
 * file exists only to augment `Window`; `tsconfig.web.json` includes it but not
 * `src/preload/index.ts`, which imports `electron`.
 */
import type { WorkspacesApi } from '@shared/ipc'

declare global {
  interface Window {
    elena: WorkspacesApi
  }
}

export type { WorkspacesApi }
