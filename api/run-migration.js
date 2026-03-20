/**
 * Quick migration runner - creates monitor tables via Supabase
 * Usage: node run-migration.js
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Read SQL file
const sqlFile = path.join(__dirname, '..', 'migrations', '004_monitor_tables.sql')
const sql = fs.readFileSync(sqlFile, 'utf8')

// Split into individual statements (skip comments and empty lines)
const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'))

async function run() {
  // Use the Supabase SQL API endpoint
  const url = `${SUPABASE_URL}/rest/v1/rpc/`

  // Try creating tables via individual CREATE TABLE statements
  // Since we can't run raw SQL via PostgREST, let's use the pg connection
  // Fallback: use the Supabase Management API

  // First, let's try the simplest approach: use fetch to the SQL endpoint
  try {
    const resp = await fetch(`${SUPABASE_URL}/pg/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ query: sql }),
    })

    if (resp.ok) {
      const data = await resp.json()
      console.log('Migration executed successfully via /pg/query!')
      console.log(data)
      return
    }

    console.log(`/pg/query returned ${resp.status}, trying alternative...`)
  } catch (e) {
    console.log(`/pg/query failed: ${e.message}, trying alternative...`)
  }

  // Alternative: try /sql endpoint
  try {
    const resp = await fetch(`${SUPABASE_URL}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({ query: sql }),
    })

    if (resp.ok) {
      const data = await resp.json()
      console.log('Migration executed successfully via /sql!')
      console.log(data)
      return
    }

    console.log(`/sql returned ${resp.status}`)
  } catch (e) {
    console.log(`/sql failed: ${e.message}`)
  }

  // Last resort: try pg package
  try {
    const { Client } = require('pg')
    // Supabase direct connection
    const ref = SUPABASE_URL.match(/https:\/\/([^.]+)/)?.[1]
    const client = new Client({
      connectionString: `postgresql://postgres.${ref}:${process.env.SUPABASE_DB_PASSWORD || ''}@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
      ssl: { rejectUnauthorized: false },
    })
    await client.connect()
    await client.query(sql)
    console.log('Migration executed successfully via pg!')
    await client.end()
    return
  } catch (e) {
    console.log(`pg connection failed: ${e.message}`)
  }

  console.log('\n========================================')
  console.log('Could not run migration automatically.')
  console.log('Please run the SQL manually:')
  console.log('1. Go to https://supabase.com/dashboard/project/yflkinkfcvntxlmtbldw/sql')
  console.log('2. Paste the contents of: migrations/004_monitor_tables.sql')
  console.log('3. Click "Run"')
  console.log('========================================\n')
}

run().catch(console.error)
