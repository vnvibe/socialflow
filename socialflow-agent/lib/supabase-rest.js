// Drop-in replacement for @supabase/supabase-js against the VPS Postgres,
// routed through POST /agent-db/query. Exports the same `.from(t).select()
// .eq()...` chainable API so existing handler code (~150 call sites) can
// stay unchanged.
//
// Why: the agent's old SUPABASE_URL still pointed to a Supabase cloud DB
// that had drifted to a stale snapshot. Every handler's
// supabase.from(...) was writing into a dead database. This wrapper makes
// the same calls hit the VPS pg, where the API + Hermes + frontend all
// live, so data stops fragmenting across two sources.

const axios = require('axios')
const https = require('https')
const http = require('http')

const API_URL = process.env.API_URL || process.env.API_BASE_URL || 'https://103-142-24-60.sslip.io'
const AGENT_KEY = process.env.AGENT_SECRET_KEY || process.env.AGENT_SECRET || ''

const httpsKA = new https.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 20 })
const httpKA = new http.Agent({ keepAlive: true, keepAliveMsecs: 30000, maxSockets: 20 })
const client = axios.create({
  baseURL: `${API_URL}/agent-db`,
  timeout: 15000,
  httpsAgent: httpsKA,
  httpAgent: httpKA,
  headers: {
    'X-Agent-Key': AGENT_KEY,
    'Connection': 'keep-alive',
    'Content-Type': 'application/json',
  },
})

async function dbRequest(body) {
  try {
    const res = await client.post('/query', body)
    return res.data
  } catch (err) {
    const msg = err.response?.data?.error || err.message
    return { data: null, error: { message: msg } }
  }
}

class QueryBuilder {
  constructor(table) {
    this._table = table
    this._op = 'select'
    this._cols = '*'
    this._filters = []
    this._options = {}
    this._rows = null
    this._updates = null
    this._returning = true
    this._returnAsArray = false
  }

  select(cols, opts) {
    if (opts?.count) this._options.count = opts.count
    if (opts?.head) this._options.head = true
    if (cols) this._cols = cols
    this._op = this._op === 'select' ? 'select' : this._op
    if (this._op !== 'select' && !this._rows && !this._updates) this._op = 'select'
    return this
  }

  insert(rows, opts) {
    this._op = 'insert'
    this._rows = Array.isArray(rows) ? rows : [rows]
    if (opts?.returning === 'minimal') this._returning = false
    return this
  }

  update(updates) {
    this._op = 'update'
    this._updates = updates
    return this
  }

  delete() {
    this._op = 'delete'
    return this
  }

  upsert(rows, opts) {
    this._op = 'upsert'
    this._rows = Array.isArray(rows) ? rows : [rows]
    if (opts?.onConflict) this._options.onConflict = opts.onConflict
    if (opts?.ignoreDuplicates) this._options.ignoreDuplicates = true
    return this
  }

  // Filters
  eq(column, value) { this._filters.push({ type: 'eq', column, value }); return this }
  neq(column, value) { this._filters.push({ type: 'neq', column, value }); return this }
  gt(column, value) { this._filters.push({ type: 'gt', column, value }); return this }
  gte(column, value) { this._filters.push({ type: 'gte', column, value }); return this }
  lt(column, value) { this._filters.push({ type: 'lt', column, value }); return this }
  lte(column, value) { this._filters.push({ type: 'lte', column, value }); return this }
  like(column, value) { this._filters.push({ type: 'like', column, value }); return this }
  ilike(column, value) { this._filters.push({ type: 'ilike', column, value }); return this }
  in(column, values) { this._filters.push({ type: 'in', column, value: values }); return this }
  is(column, value) {
    if (value === null) this._filters.push({ type: 'is_null', column })
    else this._filters.push({ type: 'is', column, value })
    return this
  }
  not(column, op, value) {
    if (op === 'is' && value === null) {
      this._filters.push({ type: 'is_not_null', column })
    } else if (op === 'in') {
      this._filters.push({ type: 'not_in', column, value })
    } else {
      this._filters.push({ type: 'not', column, op, value })
    }
    return this
  }
  filter(column, op, value) { this._filters.push({ type: 'filter', column, op, value }); return this }
  or(conditions) {
    // Not fully supported via this simple proxy — stash as raw filter
    // so the API endpoint can special-case if we ever need it.
    this._filters.push({ type: 'or_raw', value: conditions })
    return this
  }
  match(obj) {
    for (const [k, v] of Object.entries(obj || {})) this.eq(k, v)
    return this
  }

  // Modifiers
  order(column, opts = {}) {
    this._options.order = { column, ascending: opts.ascending !== false }
    return this
  }
  limit(n) { this._options.limit = n; return this }
  range(from, to) {
    this._options.offset = from
    this._options.limit = (to - from) + 1
    return this
  }
  single() { this._options.single = true; return this._exec() }
  maybeSingle() { this._options.maybeSingle = true; return this._exec() }

  // Final: thenable so `await builder` works without .then()
  then(onFulfilled, onRejected) {
    return this._exec().then(onFulfilled, onRejected)
  }

  async _exec() {
    const body = {
      op: this._op,
      table: this._table,
      cols: this._cols,
      filters: this._filters,
      options: this._options,
      rows: this._rows,
      updates: this._updates,
      returning: this._returning,
    }
    return dbRequest(body)
  }
}

// Channel stub — real Supabase realtime isn't proxied. Poller already
// falls back to 5s polling when realtime is unavailable, so a no-op
// channel keeps the existing subscribe() code path from crashing.
function channel(name) {
  return {
    on() { return this },
    subscribe(cb) {
      if (typeof cb === 'function') {
        setImmediate(() => cb('CHANNEL_ERROR', new Error('Realtime disabled in REST mode — polling active')))
      }
      return this
    },
    unsubscribe() { return Promise.resolve() },
  }
}

function removeChannel() { return Promise.resolve() }

// Expose pool-like method so callers that read supabase._pool (API-side
// pattern) get a clean undefined without crashing. Agent shouldn't use
// this but some handlers import from both contexts.
const supabase = {
  from(table) { return new QueryBuilder(table) },
  async rpc(fnName, params) {
    return dbRequest({ op: 'rpc', rpc: fnName, options: { params } })
  },
  channel,
  removeChannel,
  _pool: null,
  // Soft auth stub — nothing in agent code actually uses supabase.auth
  // directly, but guard against surprise references
  auth: {
    getUser: async () => ({ data: { user: null }, error: null }),
  },
}

module.exports = { supabase }
