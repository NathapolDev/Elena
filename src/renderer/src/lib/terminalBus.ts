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
const backlog = new Map<string, { chunks: string[]; chars: number }>()
/**
 * P6: capped by size, not by count. 200 chunks bounds nothing — a chunk is
 * whatever one PTY flush produced, so a noisy session could park megabytes here
 * for a pane that never mounts.
 */
const MAX_BACKLOG_CHARS = 512 * 1024

export function onTerminalData(terminalId: string, handler: DataHandler): () => void {
  let set = handlers.get(terminalId)
  if (!set) {
    set = new Set()
    handlers.set(terminalId, set)
  }
  set.add(handler)

  const pending = backlog.get(terminalId)
  if (pending && pending.chunks.length > 0) {
    backlog.delete(terminalId)
    for (const chunk of pending.chunks) handler(chunk)
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
  const pending = backlog.get(terminalId) ?? { chunks: [], chars: 0 }
  pending.chunks.push(chunk)
  pending.chars += chunk.length
  while (pending.chars > MAX_BACKLOG_CHARS && pending.chunks.length > 1) {
    pending.chars -= pending.chunks.shift()?.length ?? 0
  }
  backlog.set(terminalId, pending)
}

export function clearTerminalBacklog(terminalId: string): void {
  backlog.delete(terminalId)
}
