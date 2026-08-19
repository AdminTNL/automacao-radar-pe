import { createClient } from '@supabase/supabase-js'

const url = `${window.location.origin}/api/db`

export const supabase = createClient(url, 'anonymous')
