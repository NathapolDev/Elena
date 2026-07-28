import { CircleIcon } from '@phosphor-icons/react/Circle'
import { SquareIcon } from '@phosphor-icons/react/Square'
import type { RuntimeSession } from '@shared/types'

/**
 * NFR-23: status is never colour alone — every badge carries a dot *and* a text
 * label, and the exited dot additionally differs in shape.
 */
export function StatusBadge({ session }: { session?: RuntimeSession }): React.JSX.Element {
  const status = session?.status ?? 'idle'
  const label = describe(session)
  const IndicatorIcon = status === 'exited' ? SquareIcon : CircleIcon
  return (
    <span className={`badge badge--${status}`} title={label}>
      <IndicatorIcon className="badge__icon" size={9} weight="fill" aria-hidden="true" />
      <span>{label}</span>
    </span>
  )
}

function describe(session?: RuntimeSession): string {
  if (!session) return 'Not started'
  switch (session.status) {
    case 'starting':
      return 'Starting'
    case 'running':
      return 'Running'
    case 'exited':
      return session.exitCode === undefined ? 'Exited' : `Exited (${session.exitCode})`
    case 'error':
      return 'Error'
    default:
      return 'Unknown'
  }
}
