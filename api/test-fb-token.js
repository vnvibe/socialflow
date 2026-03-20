// Quick test: read token from Supabase and call Facebook Graph API directly
const { createClient } = require('@supabase/supabase-js')
const axios = require('axios')
const fs = require('fs')
const dotenv = require('dotenv')

// Load environment variables from api/.env
const envConfig = dotenv.parse(fs.readFileSync('f:/Work/tools auto social/socialflow/api/.env'))
for (const k in envConfig) {
  process.env[k] = envConfig[k]
}

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // 1. Get token from system_settings
  const { data: setting, error: settingErr } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'facebook_api')
    .single()

  if (settingErr) {
    console.log('ERROR reading system_settings:', settingErr.message)
    return
  }

  const token = setting?.value?.access_token
  if (!token) {
    console.log('NO TOKEN in system_settings!')
    return
  }

  console.log('Token from DB:', token.substring(0, 25) + '...' + token.substring(token.length - 10))
  console.log('Token length:', token.length)

  // 2. Test token with /me
  try {
    const { data } = await axios.get('https://graph.facebook.com/v21.0/me', {
      params: { access_token: token, fields: 'id,name,email' },
      timeout: 10000,
    })
    console.log('\n✅ Token VALID! User:', JSON.stringify(data))
  } catch (err) {
    const fbErr = err.response?.data?.error
    console.log('\n❌ Token INVALID!')
    console.log('  Status:', err.response?.status)
    console.log('  Error:', fbErr?.message || err.message)
    console.log('  Code:', fbErr?.code)
    console.log('  Type:', fbErr?.type)
    console.log('  Subcode:', fbErr?.error_subcode)
    console.log('  Full response:', JSON.stringify(err.response?.data, null, 2))
  }

  // 3. Check fanpages with tokens  
  const { data: fanpages } = await supabase
    .from('fanpages')
    .select('id, name, fb_page_id, access_token')

  console.log('\n--- Fanpages in DB ---')
  console.log(`Total: ${fanpages?.length || 0}`)
  for (const p of (fanpages || [])) {
    console.log(`  ${p.name} (${p.fb_page_id}): token=${p.access_token ? p.access_token.substring(0, 15) + '...' : 'NULL'}`)
  }
}

main().catch(console.error)
