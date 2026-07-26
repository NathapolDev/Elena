import { useStore } from '../state/store'

/** Non-blocking notifications: a failed write must never freeze a terminal. */
export function Toasts(): React.JSX.Element {
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)

  return (
    <div className="toasts" role="region" aria-label="Notifications" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.tone === 'error' ? 'toast--error' : ''}`}>
          <div className="toast__text">
            <div className="toast__title">{toast.title}</div>
            <div className="toast__body">{toast.body}</div>
          </div>
          <button type="button" className="button button--ghost" onClick={() => dismissToast(toast.id)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
