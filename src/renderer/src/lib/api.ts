/**
 * Thin typed wrapper over the preload bridge. Every call funnels a
 * `Result<T>` into either a value or an `ApiError`, so components never branch
 * on `{ ok }` themselves.
 */
import type { CommandName, CommandRequest, CommandResponse, EventName, EventPayload } from '@shared/ipc'
import type { AppError } from '@shared/types'

export class ApiError extends Error {
  constructor(readonly appError: AppError) {
    super(appError.message)
    this.name = 'ApiError'
  }

  get code(): AppError['code'] {
    return this.appError.code
  }

  get action(): AppError['action'] {
    return this.appError.action
  }
}

export async function call<C extends CommandName>(
  channel: C,
  ...[payload]: CommandRequest<C> extends void | undefined ? [] : [CommandRequest<C>]
): Promise<CommandResponse<C>> {
  const result = await window.elena.invoke(channel, payload as CommandRequest<C>)
  if (!result.ok) throw new ApiError(result.error)
  return result.data
}

export function on<E extends EventName>(
  channel: E,
  listener: (payload: EventPayload<E>) => void
): () => void {
  return window.elena.subscribe(channel, listener)
}

export function describeError(error: unknown): { title: string; body: string; action?: AppError['action'] } {
  if (error instanceof ApiError) {
    const base = { title: titleForCode(error.code), body: error.message }
    return error.action ? { ...base, action: error.action } : base
  }
  return { title: 'Something went wrong', body: error instanceof Error ? error.message : String(error) }
}

function titleForCode(code: AppError['code']): string {
  switch (code) {
    case 'EXECUTABLE_NOT_FOUND':
      return 'Executable not found'
    case 'INVALID_CWD':
      return 'Working directory unavailable'
    case 'SPAWN_FAILED':
      return 'Could not start the process'
    case 'VALIDATION_FAILED':
      return 'Invalid request'
    case 'NOT_FOUND':
      return 'Not found'
    case 'PERSISTENCE_FAILED':
      return 'Could not save'
    case 'INTERNAL':
      return 'Unexpected error'
  }
  // Exhaustive on purpose: a new AppErrorCode without a title here is a compile
  // error rather than a silent "Unexpected error". Do not re-add a `default:`.
  const unhandled: never = code
  return unhandled
}
