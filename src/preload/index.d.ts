import type { CommandName, CommandRequest, CommandResponse, EventName, EventPayload } from '@shared/ipc'
import type { Result } from '@shared/types'

export type WorkspacesApi = {
  invoke<C extends CommandName>(channel: C, payload?: CommandRequest<C>): Promise<Result<CommandResponse<C>>>
  subscribe<E extends EventName>(channel: E, listener: (payload: EventPayload<E>) => void): () => void
  platform: string
  /** Windows build number (eg. 26200), or null off Windows. */
  windowsBuild: number | null
  zoomIn(): number
  zoomOut(): number
}

declare global {
  interface Window {
    aiWorkspaces: WorkspacesApi
  }
}

export {}
