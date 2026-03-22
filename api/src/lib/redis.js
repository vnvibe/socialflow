const { Redis } = require('@upstash/redis')

let _redis = null

function getRedis() {
  if (_redis) return _redis
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null  // Redis chưa cấu hình — fallback về in-memory
  _redis = new Redis({ url, token })
  return _redis
}

/**
 * Cache wrapper — tự động fallback về in-memory nếu Redis chưa set
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {Function} fn - async function trả về data
 */
const memCache = new Map()

async function cached(key, ttlSeconds, fn) {
  const redis = getRedis()

  if (redis) {
    // Thử lấy từ Redis
    try {
      const hit = await redis.get(key)
      if (hit !== null) return hit
    } catch {}

    // Không có cache → gọi fn → lưu vào Redis
    const data = await fn()
    try {
      await redis.setex(key, ttlSeconds, JSON.stringify(data))
    } catch {}
    return data
  }

  // Fallback: in-memory cache
  const hit = memCache.get(key)
  if (hit && Date.now() < hit.exp) return hit.data
  const data = await fn()
  memCache.set(key, { data, exp: Date.now() + ttlSeconds * 1000 })
  return data
}

async function invalidate(pattern) {
  const redis = getRedis()
  if (!redis) {
    // Xóa in-memory cache theo prefix
    for (const key of memCache.keys()) {
      if (key.startsWith(pattern)) memCache.delete(key)
    }
    return
  }
  try {
    const keys = await redis.keys(`${pattern}*`)
    if (keys.length > 0) await redis.del(...keys)
  } catch {}
}

module.exports = { getRedis, cached, invalidate }
