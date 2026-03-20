// Cloudflare R2 plugin using @aws-sdk/client-s3
// Reads config from system_settings DB table, falls back to env vars
// Decorates fastify with r2Client and helper methods: uploadToR2, downloadFromR2, getPublicUrl

const fp = require('fastify-plugin')
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

module.exports = fp(async (fastify) => {
  // Start with env vars as default
  let r2Config = {
    accountId: process.env.R2_ACCOUNT_ID,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucket: process.env.R2_BUCKET,
    publicUrl: process.env.R2_PUBLIC_URL
  }

  // Try loading from DB
  try {
    const { data } = await fastify.supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'r2_storage')
      .single()

    let configValue = data?.value
    if (typeof configValue === 'string') {
      try { configValue = JSON.parse(configValue) } catch(e) {}
    }

    if (configValue?.account_id) {
      console.log('[R2 Plugin] Loaded R2 configuration from Supabase db')
      r2Config = {
        accountId: configValue.account_id,
        accessKeyId: configValue.access_key_id,
        secretAccessKey: configValue.secret_access_key,
        bucket: configValue.bucket,
        publicUrl: configValue.public_url || ''
      }
    } else {
      console.log('[R2 Plugin] No account_id found in Supabase R2 setting')
    }
  } catch (err) {
    console.error('[R2 Plugin] Error loading R2 config from DB:', err.message)
    // DB not ready or no settings — use env vars
  }

  function createClient(config) {
    if (!config.accountId) return null
    return new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    })
  }

  let r2 = createClient(r2Config)

  fastify.decorate('r2', r2)
  fastify.decorate('r2Bucket', r2Config.bucket)

  // Runtime reload when admin saves new R2 config
  fastify.decorate('reloadR2Config', (newConfig) => {
    if (newConfig.account_id) {
      r2Config = {
        accountId: newConfig.account_id,
        accessKeyId: newConfig.access_key_id,
        secretAccessKey: newConfig.secret_access_key,
        bucket: newConfig.bucket,
        publicUrl: newConfig.public_url || ''
      }
      r2 = createClient(r2Config)
      fastify.r2 = r2
      fastify.r2Bucket = r2Config.bucket
    }
  })

  fastify.decorate('uploadToR2', async (key, body, contentType) => {
    console.log('[uploadToR2] Has r2 instance?', !!r2, r2 ? 'Yes' : 'No')
    if (!r2) {
      console.log('[uploadToR2] r2 is null. r2Config was:', r2Config)
      throw new Error('R2 storage not configured')
    }
    await r2.send(new PutObjectCommand({
      Bucket: r2Config.bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    }))
    
    // Ensure we don't return 'undefined/key' or 'null/key'
    const baseUrl = r2Config.publicUrl ? r2Config.publicUrl.replace(/\/$/, '') : `https://${r2Config.bucket}.${r2Config.accountId}.r2.cloudflarestorage.com`
    return `${baseUrl}/${key}`
  })

  fastify.decorate('downloadFromR2', async (key) => {
    if (!r2) throw new Error('R2 storage not configured')
    const res = await r2.send(new GetObjectCommand({
      Bucket: r2Config.bucket,
      Key: key
    }))
    return res.Body
  })

  fastify.decorate('deleteFromR2', async (key) => {
    if (!r2) throw new Error('R2 storage not configured')
    await r2.send(new DeleteObjectCommand({
      Bucket: r2Config.bucket,
      Key: key
    }))
  })

  fastify.decorate('getR2PublicUrl', (key) => {
    return `${r2Config.publicUrl}/${key}`
  })
})
