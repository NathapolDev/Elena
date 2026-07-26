import { useEffect, useMemo, useRef, useState } from 'react'

export type Command = {
  id: string
  label: string
  hint?: string
  run: () => void
}

type Props = {
  commands: Command[]
  onClose: () => void
}

export function CommandPalette({ commands, onClose }: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return commands
    return commands.filter((command) => command.label.toLowerCase().includes(needle))
  }, [commands, query])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = (command: Command | undefined): void => {
    if (!command) return
    onClose()
    command.run()
  }

  return (
    <div className="palette" role="presentation" onMouseDown={onClose}>
      <div
        className="palette__panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <input
          className="palette__input"
          autoFocus
          value={query}
          placeholder="Type a command…"
          aria-label="Search commands"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((i) => Math.min(i + 1, filtered.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              run(filtered[index])
            }
          }}
        />
        <ul className="palette__list" ref={listRef}>
          {filtered.map((command, i) => (
            <li key={command.id}>
              <button
                type="button"
                className={`palette__item ${i === index ? 'palette__item--active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                {command.hint && <span className="palette__hint">{command.hint}</span>}
              </button>
            </li>
          ))}
          {filtered.length === 0 && (
            <li style={{ padding: 'var(--space-3)', color: 'var(--text-secondary)' }}>No matching command</li>
          )}
        </ul>
      </div>
    </div>
  )
}
