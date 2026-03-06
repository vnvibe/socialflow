const path = require('path')
const { randomUUID } = require('crypto')

module.exports = async (fastify) => {
  const { supabase } = fastify

  // GET /media - List media
  fastify.get('/', { preHandler: fastify.authenticate }, async (req, reply) => {
    const type = req.query.type // video, image, music
    let query = supabase
      .from('media')
      .select('*')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: false })

    if (type) query = query.eq('type', type)

    const { data, error } = await query
    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // GET /media/:id
  fastify.get('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data, error } = await supabase
      .from('media')
      .select('*')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (error) return reply.code(404).send({ error: 'Not found' })
    return data
  })

  // POST /media/upload - Upload file to R2
  fastify.post('/upload', { preHandler: fastify.authenticate }, async (req, reply) => {
    const data = await req.file()
    if (!data) return reply.code(400).send({ error: 'No file uploaded' })

    const buffer = await data.toBuffer()
    const ext = path.extname(data.filename)
    const mediaId = randomUUID()

    // Determine type from mimetype
    let type = 'image'
    if (data.mimetype.startsWith('video/')) type = 'video'
    else if (data.mimetype.startsWith('audio/')) type = 'music'

    // Upload to R2
    const r2Key = type === 'video'
      ? `videos/original/${req.user.id}/${mediaId}${ext}`
      : type === 'music'
        ? `music/${req.user.id}/${mediaId}${ext}`
        : `images/uploads/${req.user.id}/${mediaId}${ext}`

    const publicUrl = await fastify.uploadToR2(r2Key, buffer, data.mimetype)

    // Create DB record
    const { data: media, error } = await supabase.from('media').insert({
      id: mediaId,
      owner_id: req.user.id,
      type,
      source_type: 'upload',
      original_path: r2Key,
      title: data.filename,
      file_size_bytes: buffer.length
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return reply.code(201).send({ ...media, public_url: publicUrl })
  })

  // POST /media/download-url - Download from external URL (TikTok, YouTube, etc.)
  fastify.post('/download-url', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { url, title, platform } = req.body
    if (!url) return reply.code(400).send({ error: 'url required' })

    // Create media record with pending status
    const mediaId = randomUUID()
    const { data: media, error } = await supabase.from('media').insert({
      id: mediaId,
      owner_id: req.user.id,
      type: 'video',
      source_type: 'download',
      source_url: url,
      source_platform: platform,
      title: title || url,
      processing_status: 'processing'
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })

    // Create a job for the agent to download
    await supabase.from('jobs').insert({
      type: 'process_video',
      payload: { media_id: mediaId, action: 'download', url },
      created_by: req.user.id
    })

    return reply.code(201).send(media)
  })

  // PUT /media/:id - Update media metadata
  fastify.put('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const allowed = ['title', 'tags']
    const updates = {}
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key]
    }

    const { data, error } = await supabase
      .from('media')
      .update(updates)
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .select()
      .single()

    if (error) return reply.code(500).send({ error: error.message })
    return data
  })

  // DELETE /media/:id
  fastify.delete('/:id', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { data: media } = await supabase
      .from('media')
      .select('original_path, processed_path, thumbnail_path, subtitle_path')
      .eq('id', req.params.id)
      .eq('owner_id', req.user.id)
      .single()

    if (!media) return reply.code(404).send({ error: 'Not found' })

    // Delete files from R2
    const paths = [media.original_path, media.processed_path, media.thumbnail_path, media.subtitle_path].filter(Boolean)
    for (const p of paths) {
      try { await fastify.deleteFromR2(p) } catch {}
    }

    // Delete DB record
    const { error } = await supabase.from('media').delete().eq('id', req.params.id)
    if (error) return reply.code(500).send({ error: error.message })
    return { success: true }
  })

  // POST /media/:id/process - Create video processing job
  fastify.post('/:id/process', { preHandler: fastify.authenticate }, async (req, reply) => {
    const { watermark, intro_path, music_id, music_volume, subtitle } = req.body

    const config = { watermark, intro_path, music_id, music_volume, subtitle }

    // Update processing config
    await supabase.from('media').update({
      processing_config: config,
      processing_status: 'processing'
    }).eq('id', req.params.id)

    // Create job
    const { data: job, error } = await supabase.from('jobs').insert({
      type: 'process_video',
      payload: { media_id: req.params.id, action: 'process', config },
      created_by: req.user.id
    }).select().single()

    if (error) return reply.code(500).send({ error: error.message })
    return { job_id: job.id }
  })
}
