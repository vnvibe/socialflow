const { createClient } = require('@supabase/supabase-js')

// Agent needs service_role key to bypass RLS (no auth.uid() context)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

module.exports = { supabase }
