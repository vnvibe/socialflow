// Agent-side Supabase client — REST-based (B option, 2026-04-20).
//
// Previous build used @supabase/supabase-js pointed at a Supabase cloud
// URL that had drifted to a stale snapshot (no writes since 2026-04-13
// while VPS Postgres kept advancing). Every supabase.from(...) in the
// handlers was hitting that dead DB. Switched to a REST proxy that
// mirrors supabase-js's chainable API but routes all traffic through
// POST /agent-db/query on the VPS API, where the pg pool is local (<1ms
// queries) and same DB the API + Hermes + frontend all write to.
//
// Handler code (150+ call sites) stays unchanged: same
// `const { supabase } = require('../lib/supabase')` import, same
// `supabase.from('jobs').select(...).eq(...).single()` call shape.
//
// Escape hatch: if REST_MODE=off, fall back to the old cloud client.
// Use this if we ever need to bypass the API temporarily for debugging.

const REST_MODE = process.env.SUPABASE_REST_MODE !== 'off'

if (REST_MODE) {
  module.exports = require('./supabase-rest')
} else {
  const { createClient } = require('@supabase/supabase-js')
  let config = {}
  try { config = require('./config') } catch {}
  const SUPABASE_URL = process.env.SUPABASE_URL || config.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
    || process.env.SUPABASE_ANON_KEY
    || config.SUPABASE_SERVICE_ROLE_KEY
    || config.SUPABASE_ANON_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[SUPABASE] REST_MODE=off but credentials missing — re-enable REST_MODE')
    process.exit(1)
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
  module.exports = { supabase, config }
}
