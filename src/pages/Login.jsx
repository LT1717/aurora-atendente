import { useState } from 'react'
import { signIn } from '../lib/api'
import { friendlyError } from '../lib/format'
import { ErrorBox, Field } from '../components/ui'
import { Brand } from '../components/Layout'
import Icon from '../components/Icon'

const DEMO_EMAIL = import.meta.env.VITE_DEMO_EMAIL
const DEMO_PASSWORD = import.meta.env.VITE_DEMO_PASSWORD

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function enter(e, creds) {
    e?.preventDefault()
    setBusy(true)
    setError('')
    try {
      await signIn(creds?.email ?? email, creds?.password ?? password)
    } catch (err) {
      setError(friendlyError(err))
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-art" aria-hidden="true">
        <Brand />
        <div className="login-art-copy">
          <p className="login-quote">Atendimento no WhatsApp 24 horas, com agenda sempre em dia.</p>
          <ul className="login-points">
            <li><Icon name="chat" /> A assistente responde dúvidas sobre serviços, preços e endereço</li>
            <li><Icon name="calendar" /> Consulta horários livres e agenda sozinha</li>
            <li><Icon name="bell" /> Envia lembrete na véspera e registra a confirmação</li>
            <li><Icon name="hand" /> Passa a conversa para a recepção quando é preciso</li>
          </ul>
        </div>
        <div className="login-sun" />
      </section>

      <section className="login-form-wrap">
        <form className="login-form" onSubmit={enter}>
          <h1>Entrar no painel</h1>
          <p className="muted">Acesso da equipe da Clínica Aurora Estética.</p>

          <Field label="E-mail">
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Senha">
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <ErrorBox>{error}</ErrorBox>

          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Entrando…' : 'Entrar'}
          </button>

          {DEMO_EMAIL && DEMO_PASSWORD && (
            <div className="demo-box">
              <p>
                <strong>Demonstração aberta.</strong> Os dados são fictícios e você pode mexer à vontade.
              </p>
              <dl>
                <dt>E-mail</dt>
                <dd>{DEMO_EMAIL}</dd>
                <dt>Senha</dt>
                <dd>{DEMO_PASSWORD}</dd>
              </dl>
              <button
                type="button"
                className="btn btn-soft btn-block"
                disabled={busy}
                onClick={() => enter(null, { email: DEMO_EMAIL, password: DEMO_PASSWORD })}
              >
                Entrar com a conta de demonstração
              </button>
            </div>
          )}
        </form>
      </section>
    </div>
  )
}
