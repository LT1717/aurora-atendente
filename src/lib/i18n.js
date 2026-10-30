// Idiomas do painel: português (pt) e inglês (en).
// Os textos são escritos em português no código; t('texto') devolve a tradução
// do ficheiro en.js quando o idioma é inglês.
import { createContext, createElement, Fragment, useContext, useState } from 'react'
import EN from './en'

const KEY = 'aurora-lang'

function detect() {
  // 1) ?lang=en no link (bom para enviar a clientes estrangeiros)
  try {
    const q = new URLSearchParams(window.location.search).get('lang')
    if (q === 'pt' || q === 'en') return q
  } catch {
    /* sem URL */
  }
  // 2) escolha guardada neste navegador
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'pt' || saved === 'en') return saved
  } catch {
    /* sem armazenamento */
  }
  // 3) idioma do navegador: português -> pt, qualquer outro -> en
  return (navigator.language || '').toLowerCase().startsWith('pt') ? 'pt' : 'en'
}

let current = detect()
applyToDocument(current)

function applyToDocument(lang) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-BR'
  document.title = lang === 'en' ? 'Aurora Clinic · AI Assistant' : 'Clínica Aurora · Atendente IA'
}

export const getLang = () => current
export const locale = () => (current === 'en' ? 'en-US' : 'pt-BR')

/** Traduz um texto. Aceita variáveis: t('Olá, {nome}', { nome: 'Ana' }) */
export function t(pt, vars) {
  let s = current === 'en' ? (EN[pt] ?? pt) : pt
  if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] ?? '').toString())
  return s
}

const LangContext = createContext({ lang: current, setLang: () => {} })
export const useLang = () => useContext(LangContext)

/** Envolve a app. Ao mudar de idioma, redesenha tudo já na nova língua. */
export function LangProvider({ children }) {
  const [lang, setState] = useState(current)
  function setLang(next) {
    if (next === current) return
    current = next
    applyToDocument(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* continua só nesta visita */
    }
    // tira o ?lang= do endereço para não voltar ao idioma antigo ao recarregar
    try {
      const url = new URL(window.location.href)
      if (url.searchParams.has('lang')) {
        url.searchParams.delete('lang')
        window.history.replaceState(null, '', url)
      }
    } catch {
      /* ignora */
    }
    setState(next)
  }
  return createElement(
    LangContext.Provider,
    { value: { lang, setLang } },
    createElement(Fragment, { key: lang }, children),
  )
}
