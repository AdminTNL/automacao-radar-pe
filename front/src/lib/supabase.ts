import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY as string | undefined

if (!url || !key) {
  throw new Error(
    'Faltam variáveis de ambiente. Copie .env.example para .env e preencha VITE_SUPABASE_URL e VITE_SUPABASE_SERVICE_ROLE_KEY.',
  )
}

export const supabase = createClient(url, key)
