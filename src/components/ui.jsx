import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { t } from '../lib/i18n'

/* ---------- Etiqueta colorida ---------- */
export function Badge({ tone = 'muted', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

/* ---------- Janela (modal) ---------- */
export function Modal({ title, onClose, children, footer, wide = false }) {
  const panelRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    panelRef.current?.querySelector('input, select, textarea, button')?.focus()
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={panelRef}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label={t('Fechar')}>
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-foot">{footer}</footer>}
      </div>
    </div>
  )
}

/* ---------- Campo de formulário ---------- */
export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={`field ${className}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  )
}

/* ---------- Interruptor ---------- */
export function Switch({ checked, onChange, label }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}

/* ---------- Estados vazio / a carregar / erro ---------- */
export function Empty({ icon = 'sparkles', title, children }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children && <div className="empty-text">{children}</div>}
    </div>
  )
}

export function Loading({ label }) {
  return (
    <div className="loading" role="status">
      <span className="spinner" />
      {label ?? t('Carregando…')}
    </div>
  )
}

export function ErrorBox({ children }) {
  if (!children) return null
  return (
    <div className="error-box" role="alert">
      <Icon name="alert" />
      <span>{children}</span>
    </div>
  )
}

export function Avatar({ name }) {
  const initials =
    (name || '?')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0].toUpperCase())
      .join('') || '?'
  // cor estável por nome
  const hue = [...(name || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6
  return <span className={`avatar avatar-${hue}`}>{initials}</span>
}

/* ---------- Avisos rápidos (toast) ---------- */
const ToastContext = createContext(() => {})
export const useToast = () => useContext(ToastContext)

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = useCallback((text, tone = 'ok') => {
    const id = Math.random()
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <Icon name={t.tone === 'ok' ? 'check' : 'alert'} />
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
