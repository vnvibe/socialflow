const axios = require('axios')
const { XMLParser } = require('fast-xml-parser')

const CACHE_TTL = 30 * 60 * 1000 // 30 minutes

const RSS_FEEDS = [
  { url: 'https://vnexpress.net/rss/khoa-hoc-cong-nghe.rss', source: 'vnexpress', category: 'tech' },
  { url: 'https://vnexpress.net/rss/kinh-doanh.rss', source: 'vnexpress', category: 'business' },
  { url: 'https://vnexpress.net/rss/tin-noi-bat.rss', source: 'vnexpress', category: 'hot' },
  { url: 'https://voz.vn/f/-/index.rss', source: 'voz', category: 'forum' },
  { url: 'http://feeds.feedburner.com/tinhte', source: 'tinhte', category: 'tech' },
]

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' })

async function getTrends(region = 'VN', supabase, options = {}) {
  const { sources: filterSources } = options

  // Check cache first
  const cutoff = new Date(Date.now() - CACHE_TTL).toISOString()
  const { data: cached } = await supabase
    .from('trends_cache')
    .select('*')
    .eq('region', region)
    .gte('cached_at', cutoff)
    .order('score', { ascending: false })
    .limit(80)

  if (cached?.length > 0) {
    if (filterSources?.length) {
      return cached.filter(t => t.sources?.some(s => filterSources.includes(s)))
    }
    return cached
  }

  // Fetch fresh data in parallel
  const [youtube, reddit, ...rssResults] = await Promise.allSettled([
    fetchYoutubeTrends(region),
    fetchRedditTrends(),
    ...RSS_FEEDS.map(feed => fetchRSS(feed)),
  ])

  const all = [
    ...(youtube.status === 'fulfilled' ? youtube.value : []),
    ...(reddit.status === 'fulfilled' ? reddit.value : []),
    ...rssResults.flatMap(r => r.status === 'fulfilled' ? r.value : []),
  ]

  const merged = mergeTrends(all)

  // Save to cache
  if (merged.length > 0) {
    await supabase.from('trends_cache').insert(
      merged.map(t => ({ ...t, region, cached_at: new Date().toISOString() }))
    )
  }

  if (filterSources?.length) {
    return merged.filter(t => t.sources?.some(s => filterSources.includes(s)))
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

/**
 * Fetch and parse RSS feed, score by recency (newer = higher score)
 */
async function fetchRSS(feed) {
  try {
    const { data: xml } = await axios.get(feed.url, {
      timeout: 15000,
      headers: { 'User-Agent': 'SocialFlow/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml' },
      responseType: 'text',
    })

    const parsed = xmlParser.parse(xml)

    // Handle both RSS 2.0 and Atom formats
    let items = parsed?.rss?.channel?.item || parsed?.feed?.entry || []
    if (!Array.isArray(items)) items = [items]

    const now = Date.now()
    const results = []

    for (const item of items.slice(0, 25)) {
      const title = item.title?.['#text'] || item.title || ''
      const link = item.link?.['@_href'] || item.link || ''
      const pubDate = item.pubDate || item.published || item.updated || ''
      const description = item.description?.['#text'] || item.description || item.summary || ''

      // Extract thumbnail: enclosure (VnExpress), image tag (Tinhte), or img in description
      const thumbnail = item.enclosure?.['@_url']
        || item.image?.['#text'] || item.image
        || item['media:thumbnail']?.['@_url']
        || item['media:content']?.['@_url']
        || extractImgFromHtml(description)
        || null

      if (!title) continue

      // Score by recency: articles from last 6 hours get highest score
      const age = pubDate ? (now - new Date(pubDate).getTime()) / (1000 * 60 * 60) : 24
      const recencyScore = Math.max(0, (24 - age) / 24) * 5 // 0-5 score based on recency

      // Boost score for hot indicators in title
      const hotBoost = /nóng|hot|breaking|sốc|viral|bùng nổ/i.test(title) ? 2 : 0

      results.push({
        keyword: cleanTitle(title),
        score: recencyScore + hotBoost,
        sources: [feed.source],
        url: link,
        thumbnail_url: thumbnail,
        category: feed.category,
        description: stripHtml(description).substring(0, 200),
        published_at: pubDate || null,
      })
    }

    return results
  } catch {
    return []
  }
}

/**
 * Clean title: remove [tags], extra whitespace
 */
function cleanTitle(title) {
  return title
    .replace(/\[.*?\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extract first img src from HTML string
 */
function extractImgFromHtml(html) {
  if (!html) return null
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/)
  return match ? match[1] : null
}

/**
 * Strip HTML tags from description
 */
function stripHtml(html) {
  if (!html) return ''
  return html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
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

module.exports = { getTrends, RSS_FEEDS }
