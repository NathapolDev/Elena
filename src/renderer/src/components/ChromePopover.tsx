import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

type Props = { title: string; onClose: () => void; children: ReactNode; wide?: boolean }

/** A keyboard-accessible popup that returns focus to its opener. */
export function ChromePopover({ title, onClose, children, wide = false }: Props): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    ref.current?.querySelector<HTMLElement>('input, button:not(:disabled)')?.focus()
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [])
  return (
    <div className="chrome-overlay" onMouseDown={onClose}>
      <div
        ref={ref}
        className={`chrome-popover ${wide ? 'chrome-popover--wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
          const controls = [...(ref.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])]
          const index = controls.indexOf(document.activeElement as HTMLElement)
          if (event.key === 'Tab' || (event.target instanceof HTMLButtonElement && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key))) {
            event.preventDefault()
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
              : (index + (event.shiftKey || event.key === 'ArrowUp' ? -1 : 1) + controls.length) % controls.length
            controls[next]?.focus()
          }
        }}
      >
        <div className="chrome-popover__heading">{title}</div>
        {children}
      </div>
    </div>
  )
}
