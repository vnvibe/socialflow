/**
 * Centralized Supabase client — uses pg-supabase wrapper when DATABASE_URL is set,
 * falls back to @supabase/supabase-js for Supabase cloud.
 */
let supabase

if (process.env.DATABASE_URL) {
  // Self-hosted PostgreSQL via drop-in wrapper
  const { createClient } = require('./pg-supabase')
  supabase = createClient(process.env.DATABASE_URL)
  console.log('[DB] Using self-hosted PostgreSQL via pg-supabase')
} else {
  // Supabase cloud (legacy)
  const { createClient } = require('@supabase/supabase-js')
  supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  console.log('[DB] Using Supabase cloud')
}

module.exports = { supabase }
