import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { configMissing, supabase } from './lib/supabase'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import Login from './pages/Login'
import Overview from './pages/Overview'
import Agenda from './pages/Agenda'
import Conversations from './pages/Conversations'
import Customers from './pages/Customers'
import Services from './pages/Services'
import Hours from './pages/Hours'
import Settings from './pages/Settings'
import Simulator from './pages/Simulator'

export default function App() {
  const [session, setSession] = useState(undefined) // undefined = ainda a verificar

  useEffect(() => {
    if (configMissing) return
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  if (configMissing) return <MissingConfig />
  if (session === undefined) return <Loading label="Abrindo o painel…" />
  if (!session) return <Login />

  return (
    <Routes>
      <Route element={<Layout session={session} />}>
        <Route index element={<Overview />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="conversas" element={<Conversations />} />
        <Route path="simulador" element={<Simulator />} />
        <Route path="clientes" element={<Customers />} />
        <Route path="servicos" element={<Services />} />
        <Route path="horarios" element={<Hours />} />
        <Route path="configuracoes" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

// Aparece se o ficheiro .env não existir ou estiver por preencher
function MissingConfig() {
  return (
    <div className="setup-note">
      <h1>Falta ligar o painel ao Supabase</h1>
      <p>
        Cria um ficheiro chamado <code>.env</code> na pasta do projeto (copia o <code>.env.example</code>) e
        preenche <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code>. Depois para o servidor
        (Ctrl + C) e corre <code>npm run dev</code> outra vez.
      </p>
    </div>
  )
}
