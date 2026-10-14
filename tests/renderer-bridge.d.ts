import type { WorkspacesApi } from '../src/shared/ipc'

/** The Node test project exercises the renderer store with a mocked bridge. */
declare global {
  interface Window {
    elena: WorkspacesApi
  }
}
