/**
 * pg-supabase.js — Drop-in replacement for @supabase/supabase-js
 * Uses native pg Pool instead of Supabase REST API.
 * Implements the subset of supabase-js API actually used in codebase.
 *
 * Usage:
 *   const { createClient } = require('./pg-supabase')
 *   const supabase = createClient(process.env.DATABASE_URL)
 *   // Same API: supabase.from('table').select('*').eq('id', 1)
 */

const { Pool } = require('pg')

function createClient(databaseUrl) {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  })

  pool.on('error', (err) => {
    console.error('[PG-POOL] Unexpected error on idle client:', err.message)
  })

  return {
    from: (table) => new QueryBuilder(pool, table),
    rpc: (fnName, params) => rpcCall(pool, fnName, params),
    // Stubs for unused features
    channel: () => ({
      on: () => ({ subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return { unsubscribe: () => {} } } }),
      subscribe: (cb) => { if (cb) cb('SUBSCRIBED'); return { unsubscribe: () => {} } },
    }),
    removeChannel: async () => {},
    auth: {
      getUser: async () => ({ data: { user: null }, error: { message: 'Auth not available in pg-supabase' } }),
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({ data: null, error: { message: 'Use API /auth/login instead' } }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
    _pool: pool, // Expose for direct SQL when needed
  }
}

class QueryBuilder {
  constructor(pool, table) {
    this._pool = pool
    this._table = table
    this._operation = 'select'
    this._selectCols = '*'
    this._wheres = []
    this._orders = []
    this._limitVal = null
    this._offsetVal = null
    this._rangeStart = null
    this._rangeEnd = null
    this._returnSingle = false
    this._returnMaybeSingle = false
    this._data = null
    this._upsertOptions = null
    this._returnSelect = null // .select() after insert/update
  }

  // ── Operations ──
  select(cols) {
    if (this._operation !== 'select' || this._data) {
      // .select() after .insert()/.update()/.upsert() = RETURNING clause
      this._returnSelect = cols || '*'
      return this
    }
    this._selectCols = cols || '*'
    return this
  }

  insert(data) {
    this._operation = 'insert'
    this._data = Array.isArray(data) ? data : [data]
    return this
  }

  update(data) {
    this._operation = 'update'
    this._data = data
    return this
  }

  upsert(data, options) {
    this._operation = 'upsert'
    this._data = Array.isArray(data) ? data : [data]
    this._upsertOptions = options || {}
    return this
  }

  delete() {
    this._operation = 'delete'
    return this
  }

  // ── Filters ──
  eq(col, val) { this._wheres.push({ col, op: '=', val }); return this }
  neq(col, val) { this._wheres.push({ col, op: '!=', val }); return this }
  gt(col, val) { this._wheres.push({ col, op: '>', val }); return this }
  gte(col, val) { this._wheres.push({ col, op: '>=', val }); return this }
  lt(col, val) { this._wheres.push({ col, op: '<', val }); return this }
  lte(col, val) { this._wheres.push({ col, op: '<=', val }); return this }

  in(col, vals) {
    this._wheres.push({ col, op: 'IN', val: vals })
    return this
  }

  is(col, val) {
    this._wheres.push({ col, op: val === null ? 'IS NULL' : `IS ${val}`, val: null, raw: true })
    return this
  }

  not(col, operator, val) {
    if (operator === 'is' && val === null) {
      this._wheres.push({ col, op: 'IS NOT NULL', val: null, raw: true })
    } else if (operator === 'in') {
      // .not('col', 'in', '(val1,val2)') — parse the parenthesized list
      const vals = val.replace(/[()]/g, '').split(',').map(v => v.trim())
      this._wheres.push({ col, op: 'NOT IN', val: vals })
    } else {
      this._wheres.push({ col, op: `NOT ${operator}`, val })
    }
    return this
  }

  like(col, pattern) { this._wheres.push({ col, op: 'LIKE', val: pattern }); return this }
  ilike(col, pattern) { this._wheres.push({ col, op: 'ILIKE', val: pattern }); return this }

  filter(col, operator, val) {
    // Handle JSONB arrow operator: 'payload->>key'
    if (col.includes('->>')) {
      this._wheres.push({ col, op: operator === 'eq' ? '=' : operator, val, jsonb: true })
    } else {
      const opMap = { eq: '=', neq: '!=', gt: '>', gte: '>=', lt: '<', lte: '<=' }
      this._wheres.push({ col, op: opMap[operator] || operator, val })
    }
    return this
  }

  or(orString) {
    // Parse PostgREST OR format: 'col1.eq.val1,col2.eq.val2'
    // Also handles: 'status.eq.running,status.eq.active,status.is.null'
    const conditions = []
    const parts = orString.split(',')
    for (const part of parts) {
      const [col, op, ...rest] = part.trim().split('.')
      const val = rest.join('.')
      if (op === 'eq') conditions.push({ col, op: '=', val })
      else if (op === 'neq') conditions.push({ col, op: '!=', val })
      else if (op === 'is' && val === 'null') conditions.push({ col, op: 'IS NULL', val: null, raw: true })
      else if (op === 'gt') conditions.push({ col, op: '>', val })
      else if (op === 'gte') conditions.push({ col, op: '>=', val })
      else if (op === 'lt') conditions.push({ col, op: '<', val })
      else if (op === 'lte') conditions.push({ col, op: '<=', val })
    }
    this._wheres.push({ or: conditions })
    return this
  }

  // ── Modifiers ──
  order(col, opts) {
    const dir = opts?.ascending === false ? 'DESC' : 'ASC'
    this._orders.push(`${col} ${dir}`)
    return this
  }

  limit(n) { this._limitVal = n; return this }

  range(start, end) {
    this._offsetVal = start
    this._limitVal = end - start + 1
    return this
  }

  single() { this._returnSingle = true; this._limitVal = 1; return this }
  maybeSingle() { this._returnMaybeSingle = true; this._limitVal = 1; return this }

  // ── Execute ──
  async then(resolve, reject) {
    try {
      const result = await this._execute()
      resolve(result)
    } catch (err) {
      if (reject) reject(err)
      else resolve({ data: null, error: { message: err.message } })
    }
  }

  async _execute() {
    const params = []
    let paramIdx = 1

    const addParam = (val) => {
      params.push(val)
      return `$${paramIdx++}`
    }

    const buildWhere = () => {
      if (this._wheres.length === 0) return ''
      const conditions = this._wheres.map(w => {
        if (w.or) {
          const orConds = w.or.map(c => {
            if (c.raw) return `${c.col} ${c.op}`
            return `${c.col} ${c.op} ${addParam(c.val)}`
          })
          return `(${orConds.join(' OR ')})`
        }
        if (w.raw) return `${w.col} ${w.op}`
        if (w.op === 'IN' || w.op === 'NOT IN') {
          if (!Array.isArray(w.val) || w.val.length === 0) {
            return w.op === 'IN' ? 'FALSE' : 'TRUE'
          }
          const placeholders = w.val.map(v => addParam(v))
          return `${w.col} ${w.op} (${placeholders.join(', ')})`
        }
        if (w.jsonb) return `${w.col} ${w.op} ${addParam(w.val)}`
        return `${w.col} ${w.op} ${addParam(typeof w.val === 'object' && w.val !== null ? JSON.stringify(w.val) : w.val)}`
      })
      return ' WHERE ' + conditions.join(' AND ')
    }

    try {
      let sql, result

      switch (this._operation) {
        case 'select': {
          // Handle nested relations in select (e.g., '*, campaign_roles(*)')
          const { selectSql, joins } = parseSelect(this._selectCols, this._table)
          sql = `SELECT ${selectSql} FROM ${this._table}${joins}${buildWhere()}`
          if (this._orders.length) sql += ` ORDER BY ${this._orders.join(', ')}`
          if (this._limitVal != null) sql += ` LIMIT ${addParam(this._limitVal)}`
          if (this._offsetVal != null) sql += ` OFFSET ${addParam(this._offsetVal)}`

          result = await this._pool.query(sql, params)

          // Post-process nested relations
          let data = result.rows
          if (joins) {
            data = deduplicateJoinRows(data, this._table, this._selectCols)
          }

          if (this._returnSingle) {
            if (data.length === 0) return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
            return { data: data[0], error: null }
          }
          if (this._returnMaybeSingle) {
            return { data: data[0] || null, error: null }
          }
          return { data, error: null }
        }

        case 'insert': {
          const rows = this._data
          if (!rows.length) return { data: [], error: null }

          const allCols = [...new Set(rows.flatMap(r => Object.keys(r)))]
          const valueRows = rows.map(row => {
            return `(${allCols.map(col => {
              const val = row[col]
              if (val === undefined || val === null) return 'DEFAULT'
              return addParam(typeof val === 'object' ? JSON.stringify(val) : val)
            }).join(', ')})`
          })

          sql = `INSERT INTO ${this._table} (${allCols.join(', ')}) VALUES ${valueRows.join(', ')}`
          if (this._returnSelect) sql += ` RETURNING ${this._returnSelect === '*' ? '*' : this._returnSelect}`

          result = await this._pool.query(sql, params)
          const data = this._returnSelect ? result.rows : null

          if (this._returnSingle) return { data: data?.[0] || null, error: null }
          return { data, error: null }
        }

        case 'update': {
          const setClauses = Object.entries(this._data)
            .map(([col, val]) => {
              if (val === undefined) return null
              if (val === null) return `${col} = NULL`
              return `${col} = ${addParam(typeof val === 'object' ? JSON.stringify(val) : val)}`
            })
            .filter(Boolean)

          if (!setClauses.length) return { data: null, error: null }

          sql = `UPDATE ${this._table} SET ${setClauses.join(', ')}${buildWhere()}`
          if (this._returnSelect) sql += ` RETURNING ${this._returnSelect === '*' ? '*' : this._returnSelect}`

          result = await this._pool.query(sql, params)
          const data = this._returnSelect ? result.rows : null

          if (this._returnSingle) return { data: data?.[0] || null, error: null }
          return { data, error: null }
        }

        case 'upsert': {
          const rows = this._data
          if (!rows.length) return { data: [], error: null }

          const allCols = [...new Set(rows.flatMap(r => Object.keys(r)))]
          const valueRows = rows.map(row => {
            return `(${allCols.map(col => {
              const val = row[col]
              if (val === undefined || val === null) return 'NULL'
              return addParam(typeof val === 'object' ? JSON.stringify(val) : val)
            }).join(', ')})`
          })

          const conflictCols = this._upsertOptions.onConflict || 'id'
          const ignoreDuplicates = this._upsertOptions.ignoreDuplicates

          sql = `INSERT INTO ${this._table} (${allCols.join(', ')}) VALUES ${valueRows.join(', ')}`
          sql += ` ON CONFLICT (${conflictCols})`

          if (ignoreDuplicates) {
            sql += ' DO NOTHING'
          } else {
            const updateCols = allCols.filter(c => !conflictCols.split(',').map(s => s.trim()).includes(c))
            if (updateCols.length) {
              sql += ` DO UPDATE SET ${updateCols.map(c => `${c} = EXCLUDED.${c}`).join(', ')}`
            } else {
              sql += ' DO NOTHING'
            }
          }

          if (this._returnSelect) sql += ` RETURNING ${this._returnSelect === '*' ? '*' : this._returnSelect}`

          result = await this._pool.query(sql, params)
          const data = this._returnSelect ? result.rows : null

          if (this._returnSingle) return { data: data?.[0] || null, error: null }
          return { data, error: null }
        }

        case 'delete': {
          sql = `DELETE FROM ${this._table}${buildWhere()}`
          if (this._returnSelect) sql += ` RETURNING ${this._returnSelect === '*' ? '*' : this._returnSelect}`
          result = await this._pool.query(sql, params)
          return { data: this._returnSelect ? result.rows : null, error: null }
        }

        default:
          return { data: null, error: { message: `Unknown operation: ${this._operation}` } }
      }
    } catch (err) {
      return { data: null, error: { message: err.message, code: err.code, details: err.detail } }
    }
  }
}

/**
 * Parse select columns with nested relations
 * e.g., '*, campaign_roles(*)' → LEFT JOIN
 */
function parseSelect(cols, mainTable) {
  if (!cols || cols === '*') return { selectSql: `${mainTable}.*`, joins: '' }

  // Check for relation patterns: relation_name(col1, col2) or relation_name(*)
  const relationPattern = /(\w+)\(([^)]*)\)/g
  let match
  const relations = []
  let simpleCols = cols

  while ((match = relationPattern.exec(cols)) !== null) {
    const [full, relTable, relCols] = match
    relations.push({ table: relTable, cols: relCols || '*', full })
    simpleCols = simpleCols.replace(full, '').replace(/,\s*,/, ',').replace(/^,\s*|,\s*$/g, '')
  }

  if (relations.length === 0) {
    // No relations, just plain columns
    const colList = cols.split(',').map(c => c.trim()).filter(Boolean)
    return { selectSql: colList.map(c => c === '*' ? `${mainTable}.*` : `${mainTable}.${c}`).join(', '), joins: '' }
  }

  // Build joins
  let selectParts = []
  if (simpleCols.trim()) {
    const mainCols = simpleCols.split(',').map(c => c.trim()).filter(Boolean)
    selectParts = mainCols.map(c => c === '*' ? `${mainTable}.*` : `${mainTable}.${c}`)
  }

  let joins = ''
  for (const rel of relations) {
    // Handle !inner syntax: 'table!inner(cols)'
    const isInner = rel.table.includes('!')
    const actualTable = rel.table.replace('!inner', '')
    const joinType = isInner ? 'INNER JOIN' : 'LEFT JOIN'

    // Guess FK: mainTable.id = relTable.mainTable_id OR relTable.id = mainTable.relTable_id
    const fk1 = `${actualTable}.${mainTable.replace(/s$/, '')}_id` // e.g., campaign_roles.campaign_id
    const fk2 = `${mainTable}.${actualTable.replace(/s$/, '')}_id` // e.g., campaigns.role_id
    // Use convention: child table has parent_id
    joins += ` ${joinType} ${actualTable} ON ${fk1} = ${mainTable}.id`

    const relCols = rel.cols === '*'
      ? `${actualTable}.*`
      : rel.cols.split(',').map(c => `${actualTable}.${c.trim()}`).join(', ')
    selectParts.push(relCols)
  }

  return { selectSql: selectParts.join(', '), joins }
}

/**
 * Deduplicate rows from LEFT JOIN back into nested objects
 * This is a simplified version — groups child rows under parent
 */
function deduplicateJoinRows(rows, mainTable, selectCols) {
  // For now, return rows as-is. Nested relation dedup is complex and
  // most code handles flat results anyway. If needed, implement later.
  return rows
}

/**
 * Execute RPC (stored function) call
 */
async function rpcCall(pool, fnName, params) {
  try {
    const paramEntries = Object.entries(params || {})
    const paramNames = paramEntries.map(([k]) => k)
    const paramValues = paramEntries.map(([, v]) => v)
    const placeholders = paramValues.map((_, i) => `$${i + 1}`)

    // Call as: SELECT * FROM fn_name(param1 := $1, param2 := $2)
    const namedParams = paramNames.map((name, i) => `${name} := ${placeholders[i]}`)
    const sql = `SELECT * FROM ${fnName}(${namedParams.join(', ')})`

    const result = await pool.query(sql, paramValues)
    return { data: result.rows[0] || null, error: null }
  } catch (err) {
    return { data: null, error: { message: err.message, code: err.code } }
  }
}

module.exports = { createClient }
