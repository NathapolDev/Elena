import { useEffect, useRef } from 'react'

type Props = {
  title: string
  body: string
  confirmLabel: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  tone = 'default',
  onConfirm,
  onCancel
}: Props): React.JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCancel])

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onCancel}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="dialog__title" id="confirm-title">
          {title}
        </h2>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>{body}</p>
        <div className="dialog__actions">
          <button type="button" className="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={tone === 'danger' ? 'button button--danger' : 'button button--primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
