// Cloudflare R2 plugin using @aws-sdk/client-s3
// Decorates fastify with r2Client and helper methods: uploadToR2, downloadFromR2, getPublicUrl
// Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_URL

const fp = require('fastify-plugin')
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3')

module.exports = fp(async (fastify) => {
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY
    }
  })

  fastify.decorate('r2', r2)
  fastify.decorate('r2Bucket', process.env.R2_BUCKET)

  fastify.decorate('uploadToR2', async (key, body, contentType) => {
    await r2.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType
    }))
    return `${process.env.R2_PUBLIC_URL}/${key}`
  })

  fastify.decorate('downloadFromR2', async (key) => {
    const res = await r2.send(new GetObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key
    }))
    return res.Body
  })

  fastify.decorate('deleteFromR2', async (key) => {
    await r2.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key
    }))
  })

  fastify.decorate('getR2PublicUrl', (key) => {
    return `${process.env.R2_PUBLIC_URL}/${key}`
  })
})
