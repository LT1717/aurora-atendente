import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

// Se faltar o ficheiro .env, o painel mostra um aviso em vez de ficar em branco
export const configMissing =
  !url || !key || !/^https:\/\/.+/.test(url) || /COLA/i.test(url) || /COLA/i.test(key)

export const supabase = configMissing
  ? null
  : createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
