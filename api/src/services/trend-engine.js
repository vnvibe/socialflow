const axios = require('axios')

const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

async function getTrends(region = 'VN', supabase) {
  // Check cache first
  const cutoff = new Date(Date.now() - CACHE_TTL).toISOString()
  const { data: cached } = await supabase
    .from('trends_cache')
    .select('*')
    .eq('region', region)
    .gte('cached_at', cutoff)
    .order('score', { ascending: false })
    .limit(50)

  if (cached?.length > 0) return cached

  // Fetch fresh data in parallel
  const [youtube, reddit] = await Promise.allSettled([
    fetchYoutubeTrends(region),
    fetchRedditTrends()
  ])

  const all = [
    ...(youtube.status === 'fulfilled' ? youtube.value : []),
    ...(reddit.status === 'fulfilled' ? reddit.value : [])
  ]

  const merged = mergeTrends(all)

  // Save to cache
  if (merged.length > 0) {
    await supabase.from('trends_cache').insert(
      merged.map(t => ({ ...t, region, cached_at: new Date().toISOString() }))
    )
  }

  return merged
}

async function fetchYoutubeTrends(region) {
  const apiKey = process.env.YOUTUBE_API_KEY
  if (!apiKey) return []

  try {
    const { data } = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        part: 'snippet,statistics',
        chart: 'mostPopular',
        regionCode: region,
        maxResults: 20,
        key: apiKey
      },
      timeout: 10000
    })

    return data.items.map(v => ({
      keyword: v.snippet.title,
      score: parseInt(v.statistics.viewCount) / 1000000,
      sources: ['youtube'],
      url: `https://youtube.com/watch?v=${v.id}`,
      thumbnail_url: v.snippet.thumbnails.high?.url,
      view_count: parseInt(v.statistics.viewCount)
    }))
  } catch {
    return []
  }
}

async function fetchRedditTrends() {
  try {
    const { data } = await axios.get('https://www.reddit.com/r/all/hot.json?limit=20', {
      headers: { 'User-Agent': 'SocialFlow/1.0' },
      timeout: 10000
    })

    return data.data.children.map(p => ({
      keyword: p.data.title,
      score: p.data.score / 10000,
      sources: ['reddit'],
      url: p.data.url,
      view_count: p.data.score
    }))
  } catch {
    return []
  }
}

function mergeTrends(items) {
  const map = new Map()
  for (const item of items) {
    const key = item.keyword.toLowerCase().trim()
    if (map.has(key)) {
      const e = map.get(key)
      e.score += item.score
      e.sources = [...new Set([...e.sources, ...item.sources])]
    } else {
      map.set(key, { ...item })
    }
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score)
}

module.exports = { getTrends }
