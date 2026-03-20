// Quick test to debug 500 error on fetch-pages
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

async function test() {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // 1. Check profiles table for is_active column
  console.log('\n--- Check profiles ---')
  const { data: profile, error: profileErr } = await supabase
    .from('profiles')
    .select('*')
    .limit(1)
    .single()
  if (profileErr) console.log('Profile error:', profileErr.message)
  else console.log('Profile columns:', Object.keys(profile))

  // 2. Check agent_heartbeats
  console.log('\n--- Check agent_heartbeats ---')
  const { data: agents, error: agentErr } = await supabase
    .from('agent_heartbeats')
    .select('agent_id')
    .gte('last_seen', new Date(Date.now() - 30000).toISOString())
    .limit(1)
  if (agentErr) console.log('Heartbeat error:', agentErr.message)
  else console.log('Online agents:', agents)

  // 3. Check jobs table insert
  console.log('\n--- Check jobs insert ---')
  const { data: job, error: jobErr } = await supabase.from('jobs').insert({
    type: 'fetch_pages',
    payload: { account_id: 'test-123' },
    status: 'pending',
    scheduled_at: new Date().toISOString()
  }).select().single()
  if (jobErr) console.log('Jobs insert error:', jobErr.message, jobErr.details, jobErr.hint)
  else {
    console.log('Job created OK:', job.id)
    // Clean up test job
    await supabase.from('jobs').delete().eq('id', job.id)
    console.log('Test job cleaned up')
  }
}

test().catch(console.error)
