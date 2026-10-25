import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import Icon from './Icon'
import { countWaitingHuman, prefetchAll, signOut, subscribeToChanges } from '../lib/api'

const NAV = [
  { to: '/', label: 'Visão geral', icon: 'home', end: true },
  { to: '/agenda', label: 'Agenda', icon: 'calendar' },
  { to: '/conversas', label: 'Conversas', icon: 'chat', badge: true },
  { to: '/simulador', label: 'Simulador', icon: 'phone' },
  { to: '/clientes', label: 'Clientes', icon: 'users' },
  { to: '/servicos', label: 'Serviços', icon: 'sparkles' },
  { to: '/horarios', label: 'Horários', icon: 'clock' },
  { to: '/configuracoes', label: 'Configurações', icon: 'settings' },
]

export default function Layout({ session }) {
  const [waiting, setWaiting] = useState(0)
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()

  useEffect(() => setMenuOpen(false), [location.pathname])

  // logo depois de entrar, carrega os dados de todas as páginas em paralelo
  useEffect(() => {
    prefetchAll()
  }, [])

  useEffect(() => {
    const refresh = () => countWaitingHuman().then(setWaiting).catch(() => {})
    refresh()
    return subscribeToChanges(refresh)
  }, [])

  return (
    <div className={`shell ${menuOpen ? 'menu-open' : ''}`}>
      <header className="topbar">
        <button className="icon-btn" onClick={() => setMenuOpen((v) => !v)} aria-label="Abrir menu">
          <Icon name="menu" />
        </button>
        <Brand />
        {waiting > 0 && (
          <NavLink to="/conversas" className="topbar-alert" aria-label={`${waiting} conversas aguardando`}>
            <Icon name="bell" />
            <span>{waiting}</span>
          </NavLink>
        )}
      </header>

      <aside className="sidebar">
        <Brand />
        <nav className="nav">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="nav-link">
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.badge && waiting > 0 && <span className="nav-badge" title="Aguardando atendente">{waiting}</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="who">
            <span className="who-label">Conectado como</span>
            <span className="who-email">{session?.user?.email}</span>
          </div>
          <button className="nav-link nav-logout" onClick={signOut}>
            <Icon name="logout" />
            <span>Sair</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setMenuOpen(false)} />

      <main className="main">
        <Outlet />
      </main>
    </div>
  )
}

export function Brand() {
  return (
    <div className="brand">
      <svg className="brand-mark" viewBox="0 0 64 64" aria-hidden="true">
        <path d="M12 46a20 20 0 0 1 40 0" fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" />
        <circle cx="32" cy="46" r="6.5" fill="currentColor" />
      </svg>
      <div className="brand-text">
        <span className="brand-name">Aurora</span>
        <span className="brand-sub">Clínica de estética</span>
      </div>
    </div>
  )
}
