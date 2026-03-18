/**
 * Apify key rotation service
 *
 * Storage format in system_settings (key='apify'):
 * {
 *   keys: [
 *     { key: 'apify_api_xxx', label: 'Account 1', disabled: false, last_error: null, disabled_at: null },
 *     { key: 'apify_api_yyy', label: 'Account 2', disabled: false, last_error: null, disabled_at: null },
 *   ],
 *   current_index: 0
 * }
 */

async function getApifyConfig(supabase) {
  const { data } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', 'apify')
    .single()
  return data?.value || { keys: [], current_index: 0 }
}

async function saveApifyConfig(supabase, config) {
  await supabase
    .from('system_settings')
    .upsert({
      key: 'apify',
      value: config,
      updated_at: new Date().toISOString(),
    })
}

/**
 * Get the next available Apify API key using round-robin.
 * Skips disabled keys. Returns null if no keys available.
 */
async function getApifyKey(supabase) {
  const config = await getApifyConfig(supabase)
  const { keys } = config
  if (!keys || keys.length === 0) return null

  const activeKeys = keys.filter(k => !k.disabled && k.key)
  if (activeKeys.length === 0) return null

  // Round-robin: use current_index, wrap around active keys
  let idx = (config.current_index || 0) % keys.length

  // Find next active key starting from current_index
  for (let i = 0; i < keys.length; i++) {
    const candidate = keys[(idx + i) % keys.length]
    if (!candidate.disabled && candidate.key) {
      // Advance index for next call
      config.current_index = ((idx + i) % keys.length) + 1
      await saveApifyConfig(supabase, config)
      return candidate.key
    }
  }

  return null
}

/**
 * Mark a key as disabled (exhausted/invalid).
 * Auto re-enables after 24h so keys with renewed quotas get retried.
 */
async function markKeyExhausted(supabase, apiKey, errorMsg) {
  const config = await getApifyConfig(supabase)
  const keyEntry = config.keys.find(k => k.key === apiKey)
  if (keyEntry) {
    keyEntry.disabled = true
    keyEntry.last_error = errorMsg || 'Usage limit exceeded'
    keyEntry.disabled_at = new Date().toISOString()
    await saveApifyConfig(supabase, config)
  }
}

/**
 * Re-enable keys that were disabled more than 24h ago.
 * Call this periodically or before getApifyKey.
 */
async function reEnableExpiredKeys(supabase) {
  const config = await getApifyConfig(supabase)
  const now = Date.now()
  const RE_ENABLE_MS = 4 * 60 * 60 * 1000 // 4 hours (not 1h — avoid re-enabling monthly-exhausted keys too fast)
  let changed = false

  for (const k of (config.keys || [])) {
    if (k.disabled && k.disabled_at) {
      const disabledTime = new Date(k.disabled_at).getTime()
      if (now - disabledTime > RE_ENABLE_MS) {
        k.disabled = false
        k.last_error = null
        k.disabled_at = null
        changed = true
      }
    }
  }

  if (changed) await saveApifyConfig(supabase, config)
  return changed
}

/**
 * Smart key getter: re-enables expired keys first, then gets next key.
 */
async function getApifyKeyWithRotation(supabase) {
  await reEnableExpiredKeys(supabase)
  return getApifyKey(supabase)
}

/**
 * Run an Apify actor with key rotation + retry.
 * @param {object} supabase - Supabase client
 * @param {string} actorId - e.g. 'apify~facebook-posts-scraper'
 * @param {object} input - Actor input payload
 * @param {object} [log] - Optional Fastify logger
 * @returns {Array} Dataset items
 */
async function runApifyActor(supabase, actorId, input, log) {
  const MAX_RETRIES = 3
  const failCounts = {}
  let lastError = null
  const triedKeys = new Set() // track keys tried in this call to avoid re-picking

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Only re-enable on first attempt; subsequent attempts should use fresh keys
    if (attempt === 0) await reEnableExpiredKeys(supabase)
    const apiKey = await getApifyKey(supabase)
    if (!apiKey) throw lastError || new Error('Không có Apify API key khả dụng. Vui lòng thêm key trong Cài đặt.')

    // Skip keys already tried and failed in this call
    if (triedKeys.has(apiKey)) {
      log?.warn({ attempt, actorId }, 'All available keys already tried, stopping')
      break
    }

    try {
      // Exponential backoff for retries
      if (attempt > 0) {
        const delay = Math.min(2000 * Math.pow(2, attempt - 1), 10000)
        log?.info({ attempt, delay, actorId }, `Retry #${attempt} after ${delay}ms...`)
        await new Promise(r => setTimeout(r, delay))
      }

      const startRes = await fetch(
        `https://api.apify.com/v2/acts/${actorId}/runs?token=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(input),
          signal: AbortSignal.timeout(30000), // 30s timeout for initial request
        }
      )

      if (startRes.status === 429) {
        log?.warn({ attempt, actorId }, 'Apify rate limited (429), retrying...')
        lastError = new Error('Rate limited (429)')
        continue
      }

      if (startRes.status === 402) {
        const k = apiKey.slice(-6)
        failCounts[k] = (failCounts[k] || 0) + 1
        if (failCounts[k] >= 2) {
          await markKeyExhausted(supabase, apiKey, `HTTP 402 x${failCounts[k]} — có thể hết quota`)
          log?.warn({ attempt, actorId }, 'Apify key disabled after repeated 402s')
        } else {
          log?.warn({ attempt, actorId }, 'Apify 402 (may be transient), retrying...')
        }
        lastError = new Error('Quota exceeded (402)')
        continue
      }

      // 403 = quota exceeded or feature disabled — disable this key and try next
      if (startRes.status === 403) {
        const errBody = await startRes.text()
        triedKeys.add(apiKey)
        await markKeyExhausted(supabase, apiKey, `HTTP 403 — ${errBody.substring(0, 100)}`)
        log?.warn({ attempt, actorId }, 'Apify 403 (quota/feature disabled), switching key...')
        lastError = new Error(`Apify error 403: ${errBody}`)
        continue
      }

      if (!startRes.ok) {
        const errBody = await startRes.text()
        throw new Error(`Apify error ${startRes.status}: ${errBody}`)
      }

      const runData = await startRes.json()
      const runId = runData.data?.id
      if (!runId) throw new Error('Không nhận được run ID từ Apify')

      // Poll for completion (max 5 min)
      const deadline = Date.now() + 5 * 60 * 1000
      let status = runData.data?.status
      while (status !== 'SUCCEEDED' && status !== 'FAILED' && status !== 'ABORTED' && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 3000))
        try {
          const pollRes = await fetch(`https://api.apify.com/v2/actor-runs/${runId}?token=${apiKey}`, {
            signal: AbortSignal.timeout(15000),
          })
          const pollData = await pollRes.json()
          status = pollData.data?.status
        } catch (pollErr) {
          log?.warn({ err: pollErr.message, runId }, 'Poll request failed, will retry...')
          // Continue polling — don't break on transient errors
        }
      }

      if (status !== 'SUCCEEDED') {
        throw new Error(`Actor run ${status || 'TIMEOUT'}`)
      }

      // Get dataset items
      const datasetId = runData.data?.defaultDatasetId
      // Limit dataset items to reduce bandwidth — caller can further filter
      const itemsLimit = input?.resultsLimit || input?.maxPosts || input?.maxPostsPerGroup || 20
      const itemsRes = await fetch(`https://api.apify.com/v2/datasets/${datasetId}/items?token=${apiKey}&limit=${itemsLimit}`, {
        signal: AbortSignal.timeout(15000),
      })
      const items = await itemsRes.json()
      return items
    } catch (err) {
      lastError = err
      const isNetworkError = err.message?.includes('ENOTFOUND')
        || err.message?.includes('fetch failed')
        || err.message?.includes('ETIMEDOUT')
        || err.message?.includes('ECONNRESET')
        || err.message?.includes('ECONNREFUSED')
        || err.name === 'AbortError'
        || err.message?.includes('timed out')

      log?.error({ err: err.message, attempt, actorId, isNetworkError }, 'Apify actor error')

      // Retry on network errors, throw immediately on API/logic errors
      if (isNetworkError && attempt < MAX_RETRIES - 1) {
        continue
      }
      throw err
    }
  }
  throw lastError || new Error('Đã thử tất cả Apify key nhưng đều thất bại')
}

module.exports = {
  getApifyKey,
  getApifyKeyWithRotation,
  markKeyExhausted,
  reEnableExpiredKeys,
  runApifyActor,
}
