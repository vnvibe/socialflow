// Local Redis (ioredis — TCP) is ~50× faster than Upstash REST for hits
// because it skips HTTPS and runs on the same box as the API. Falls back
// to Upstash (REST) if REDIS_URL isn't set, and to in-memory cache if
// neither is configured — the caller never needs to know which backend.

let _redis = null
let _backend = null // 'ioredis' | 'upstash' | null

function getRedis() {
  if (_redis) return _redis
  // Prefer local Redis
  const localUrl = process.env.REDIS_URL || (process.env.REDIS_HOST ? `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}` : null)
  if (localUrl) {
    try {
      const IORedis = require('ioredis')
      _redis = new IORedis(localUrl, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        connectTimeout: 2000,
        enableOfflineQueue: false,
      })
      _redis.on('error', (err) => {
        // Don't spam logs — ioredis emits "error" on every reconnect attempt
        if (err.code !== 'ECONNREFUSED') console.warn('[REDIS] error:', err.message)
      })
      _backend = 'ioredis'
      return _redis
    } catch (err) {
      console.warn('[REDIS] ioredis init failed:', err.message)
    }
  }
  // Fallback to Upstash REST (works from anywhere, slower per hit)
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    const { Redis } = require('@upstash/redis')
    _redis = new Redis({ url, token })
    _backend = 'upstash'
    return _redis
  }
  return null
}

function getBackend() { return _backend }

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
      if (hit !== null && hit !== undefined) {
        // ioredis returns string; upstash returns already-parsed value
        if (typeof hit === 'string') {
          try { return JSON.parse(hit) } catch { return hit }
        }
        return hit
      }
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
