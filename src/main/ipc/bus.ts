/**
 * Typed IPC bus.
 *
 * Two guarantees live here:
 *  - NFR-18: every privileged call verifies its sender against the windows we
 *    created, so a stray frame cannot drive the main process.
 *  - Contract rule: handlers return a typed Result. A thrown error is caught and
 *    converted, never propagated across the boundary.
 */
import { ipcMain, webContents } from 'electron'
import type { IpcMainInvokeEvent, WebContents } from 'electron'
import type { z } from 'zod'
import type { CommandName, CommandRequest, CommandResponse, EventName, EventPayload } from '@shared/ipc'
import type { AppError, Result } from '@shared/types'
import { logger } from '../logger'

const trustedContents = new Set<number>()

export function trustWebContents(contents: WebContents): void {
  trustedContents.add(contents.id)
  contents.once('destroyed', () => trustedContents.delete(contents.id))
}

function isTrusted(event: IpcMainInvokeEvent): boolean {
  return trustedContents.has(event.sender.id)
}

export function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

export function fail<T = never>(
  code: AppError['code'],
  message: string,
  action?: AppError['action']
): Result<T> {
  return { ok: false, error: action ? { code, message, action } : { code, message } }
}

export function registerCommand<C extends CommandName>(
  channel: C,
  schema: z.ZodType<unknown>,
  handler: (payload: CommandRequest<C>) => Promise<Result<CommandResponse<C>>> | Result<CommandResponse<C>>
): void {
  ipcMain.handle(channel, async (event, raw): Promise<Result<CommandResponse<C>>> => {
    if (!isTrusted(event)) {
      logger.warn('ipc.untrusted-sender', { channel, senderId: event.sender.id })
      return fail('VALIDATION_FAILED', 'Request rejected: untrusted sender.')
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      logger.warn('ipc.invalid-payload', {
        channel,
        path: issue?.path.join('.'),
        message: issue?.message
      })
      return fail('VALIDATION_FAILED', `Invalid request for ${channel}.`)
    }

    try {
      return await handler(parsed.data as CommandRequest<C>)
    } catch (error) {
      logger.error('ipc.handler-failed', { channel, error })
      return fail('INTERNAL', `${channel} failed.`, 'retry')
    }
  })
}

/**
 * Sends to one window instead of all of them.
 *
 * P2: `broadcast` reaches every trusted window, so `terminal:data` used to cost
 * a structured clone per window per 16 ms flush and the renderers dropped what
 * they did not draw. Main already knows which window owns a terminal, so the
 * filtering belongs here. Same trust check as `broadcast` — a window that is
 * not ours never receives an event.
 */
export function sendTo<E extends EventName>(
  target: WebContents | null,
  channel: E,
  payload: EventPayload<E>
): void {
  if (!target || target.isDestroyed() || !trustedContents.has(target.id)) return
  target.send(channel, payload)
}

export function broadcast<E extends EventName>(channel: E, payload: EventPayload<E>): void {
  for (const contents of webContents.getAllWebContents()) {
    if (!trustedContents.has(contents.id) || contents.isDestroyed()) continue
    contents.send(channel, payload)
  }
}
