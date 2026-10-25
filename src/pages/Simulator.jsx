import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { clearCache, getCustomerByPhone, listMessages, simulateIncoming, subscribeToChanges } from '../lib/api'
import { fmtTime, friendlyError } from '../lib/format'
import { ErrorBox, useToast } from '../components/ui'
import Icon from '../components/Icon'

const KEY = 'aurora-simulador'
const SUGGESTIONS = [
  'Oi, tudo bem?',
  'Quanto custa a limpeza de pele?',
  'Onde vocês ficam?',
  'Qual o horário de funcionamento?',
  'Quero marcar uma avaliação',
  'Quero falar com uma atendente',
]

// Guarda "quem sou eu" no simulador só neste navegador
function loadIdentity() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null
  } catch {
    return null
  }
}
function saveIdentity(v) {
  try {
    v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY)
  } catch {
    /* sem armazenamento: continua só nesta visita */
  }
}
const randomPhone = () => `55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`

export default function Simulator() {
  const toast = useToast()
  const [me, setMe] = useState(loadIdentity)
  const [nameDraft, setNameDraft] = useState('')
  const [customer, setCustomer] = useState(null)
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [typing, setTyping] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef(null)

  const load = useCallback(async () => {
    if (!me) return
    try {
      clearCache()
      const c = await getCustomerByPhone(me.phone)
      setCustomer(c)
      setMessages(c ? await listMessages(c.id) : [])
      setError('')
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [me])

  useEffect(() => {
    load()
  }, [load])

  // atualiza quando a recepção responde no painel (tempo real + verificação a cada 6 s)
  useEffect(() => {
    if (!me) return
    const unsub = subscribeToChanges(load)
    const timer = setInterval(load, 6000)
    return () => {
      unsub()
      clearInterval(timer)
    }
  }, [me, load])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, typing])

  function start(e) {
    e.preventDefault()
    const id = { name: nameDraft.trim() || 'Visitante', phone: randomPhone() }
    saveIdentity(id)
    setMe(id)
    setMessages([])
  }

  function restart() {
    saveIdentity(null)
    setMe(null)
    setCustomer(null)
    setMessages([])
    setNameDraft('')
  }

  async function send(text) {
    const body = text.trim()
    if (!body || typing) return
    setDraft('')
    // mostra logo a mensagem da cliente
    setMessages((list) => [
      ...list,
      { id: `tmp-${Date.now()}`, sender: 'cliente', body, created_at: new Date().toISOString() },
    ])
    setTyping(true)
    try {
      await simulateIncoming(me.phone, me.name, body)
      await new Promise((r) => setTimeout(r, 700)) // tempo de "digitando…"
      await load()
    } catch (err) {
      toast(friendlyError(err), 'danger')
    } finally {
      setTyping(false)
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="page-date">Teste a assistente como se fosse uma cliente</p>
          <h1>Simulador</h1>
        </div>
        {me && (
          <button className="btn btn-ghost" onClick={restart}>
            <Icon name="refresh" /> Começar como outra cliente
          </button>
        )}
      </header>

      <ErrorBox>{error}</ErrorBox>

      <div className="sim">
        <div className="phone" aria-label="Simulação do WhatsApp">
          <div className="phone-head">
            <span className="phone-avatar" aria-hidden="true">
              <svg viewBox="0 0 64 64" width="22" height="22">
                <path d="M12 46a20 20 0 0 1 40 0" fill="none" stroke="currentColor" strokeWidth="6" strokeLinecap="round" />
                <circle cx="32" cy="46" r="7" fill="currentColor" />
              </svg>
            </span>
            <div>
              <strong>Clínica Aurora Estética</strong>
              <span>{typing ? 'digitando…' : 'online'}</span>
            </div>
          </div>

          {!me ? (
            <form className="phone-start" onSubmit={start}>
              <p>Digite seu nome para começar uma conversa com a clínica.</p>
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                placeholder="Ex.: Ana Paula"
                aria-label="Seu nome"
                maxLength={40}
              />
              <button className="btn btn-primary btn-block">Começar conversa</button>
            </form>
          ) : (
            <>
              <div className="phone-body">
                {messages.length === 0 && !typing && (
                  <p className="phone-hint">Envie uma mensagem ou toque em uma sugestão abaixo.</p>
                )}
                <ol className="bubbles">
                  {messages.map((m) => (
                    <li key={m.id} className={`bubble-row from-${m.sender === 'cliente' ? 'me' : 'clinic'}`}>
                      <div className="bubble">
                        {m.sender === 'humano' && <span className="bubble-author">Recepção</span>}
                        <p>{m.body}</p>
                        <time>{fmtTime(m.created_at)}</time>
                      </div>
                    </li>
                  ))}
                  {typing && (
                    <li className="bubble-row from-clinic">
                      <div className="bubble typing" aria-label="digitando">
                        <span />
                        <span />
                        <span />
                      </div>
                    </li>
                  )}
                  <li ref={endRef} />
                </ol>
              </div>

              <div className="phone-chips" role="group" aria-label="Sugestões">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="chip" onClick={() => send(s)} disabled={typing}>
                    {s}
                  </button>
                ))}
              </div>

              <form
                className="phone-input"
                onSubmit={(e) => {
                  e.preventDefault()
                  send(draft)
                }}
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Mensagem"
                  aria-label="Mensagem"
                  maxLength={500}
                />
                <button className="phone-send" disabled={!draft.trim() || typing} aria-label="Enviar">
                  <Icon name="send" />
                </button>
              </form>
            </>
          )}
        </div>

        <aside className="sim-side">
          <section className="panel">
            <h2>Como funciona</h2>
            <p className="muted small">
              Cada mensagem segue o mesmo caminho de uma mensagem real do WhatsApp: fica gravada, a assistente decide a
              resposta e a conversa aparece no painel.
            </p>
            <ul className="sim-list">
              <li><strong>Preços, endereço e horários</strong> têm resposta automática.</li>
              <li><strong>“Quero falar com uma atendente”</strong> pausa a assistente e avisa a recepção.</li>
              <li><strong>Lembretes:</strong> na Agenda, escolha amanhã e toque em “Enviar lembretes”. Depois responda <strong>1</strong> aqui para confirmar.</li>
              <li><strong>Recepção:</strong> em Conversas, assuma a conversa e responda. A resposta aparece nesta tela.</li>
            </ul>
            {customer && (
              <Link to={`/conversas?c=${customer.id}`} className="btn btn-soft btn-block">
                <Icon name="chat" /> Ver esta conversa no painel
              </Link>
            )}
          </section>
          <p className="muted small sim-note">
            Ainda sem IA: as respostas usam palavras-chave. Na próxima fase, a IA responde a qualquer pergunta e agenda
            sozinha.
          </p>
        </aside>
      </div>
    </div>
  )
}
