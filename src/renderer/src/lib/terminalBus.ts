/**
 * One IPC listener fans out to the panes.
 *
 * Subscribing per pane would mean N listeners walking every `terminal:data`
 * event; with 10 noisy sessions that is the difference between a smooth UI and
 * the stalls NFR-03 forbids.
 */
type DataHandler = (chunk: string) => void

const handlers = new Map<string, Set<DataHandler>>()
/** Output that arrived before a pane mounted, so nothing is lost on restart. */
const backlog = new Map<string, string[]>()
const MAX_BACKLOG_CHUNKS = 200

export function onTerminalData(terminalId: string, handler: DataHandler): () => void {
  let set = handlers.get(terminalId)
  if (!set) {
    set = new Set()
    handlers.set(terminalId, set)
  }
  set.add(handler)

  const pending = backlog.get(terminalId)
  if (pending?.length) {
    backlog.delete(terminalId)
    for (const chunk of pending) handler(chunk)
  }

  return () => {
    set?.delete(handler)
    if (set && set.size === 0) handlers.delete(terminalId)
  }
}

export function dispatchTerminalData(terminalId: string, chunk: string): void {
  const set = handlers.get(terminalId)
  if (set && set.size > 0) {
    for (const handler of set) handler(chunk)
    return
  }
  const pending = backlog.get(terminalId) ?? []
  pending.push(chunk)
  if (pending.length > MAX_BACKLOG_CHUNKS) pending.shift()
  backlog.set(terminalId, pending)
}

export function clearTerminalBacklog(terminalId: string): void {
  backlog.delete(terminalId)
}
