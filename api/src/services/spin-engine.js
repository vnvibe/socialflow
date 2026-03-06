// Spin Engine - Basic spintax + AI spinning

function spinBasic(template) {
  return template.replace(/\{([^}]+)\}/g, (_, options) => {
    const choices = options.split('|')
    return choices[Math.floor(Math.random() * choices.length)]
  })
}

async function spinWithAI(caption, groupCount, orchestrator) {
  const prompt = `Viết ${groupCount} phiên bản khác nhau của caption sau, giữ nguyên ý nghĩa nhưng dùng từ ngữ khác nhau, mỗi bản 1-3 câu:

"${caption}"

Trả về JSON: { "variants": ["variant1", "variant2", ...] }`

  const result = await orchestrator.call('caption_gen', [{ role: 'user', content: prompt }])
  try {
    const parsed = JSON.parse(result.text)
    return parsed.variants || [caption]
  } catch {
    return [caption]
  }
}

async function spin(caption, mode, groupCount, orchestrator) {
  if (mode === 'none') return Array(groupCount).fill(caption)
  if (mode === 'basic') return Array(groupCount).fill(null).map(() => spinBasic(caption))
  if (mode === 'ai') return spinWithAI(caption, groupCount, orchestrator)
  return Array(groupCount).fill(caption)
}

function contentHash(text) {
  const crypto = require('crypto')
  return crypto.createHash('md5').update(text.trim().toLowerCase()).digest('hex')
}

async function isDuplicateForGroup(groupId, caption, supabase) {
  const hash = contentHash(caption)
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  const { data } = await supabase
    .from('publish_history')
    .select('id')
    .eq('target_fb_id', groupId)
    .eq('status', 'success')
    .gte('published_at', cutoff)

  // Check if any published caption has the same hash
  // Simple approach: just check if anything was posted to this group recently
  return (data?.length || 0) > 0
}

module.exports = { spin, spinBasic, isDuplicateForGroup, contentHash }
