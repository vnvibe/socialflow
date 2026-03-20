const axios = require('axios')
const https = require('https')
const dns = require('dns')

// Force Node.js DNS to prefer IPv4 globally for fal.ai compatibility
dns.setDefaultResultOrder('ipv4first')

// Resolve hostname via Cloudflare DNS-over-HTTPS (bypasses broken local DNS)
async function resolveViaDoH(hostname) {
  try {
    const resp = await axios.get(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
      headers: { accept: 'application/dns-json' },
      timeout: 5000,
    })
    const ip = resp.data?.Answer?.[0]?.data
    if (ip) return ip
  } catch {}
  return null
}

function createFal({ apiKey }) {
  const agent = new https.Agent({ family: 4, rejectUnauthorized: true })

  async function falRequest(method, path, data) {
    const url = `https://fal.run${path}`

    // Try normal request first
    try {
      const resp = await axios({ method, url, data, headers: { Authorization: `Key ${apiKey}` }, timeout: 120000, httpsAgent: agent })
      return resp.data
    } catch (err) {
      // If DNS failed, fallback to DoH resolution
      if (err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN') {
        console.log(`[Fal.ai] DNS failed for fal.run, trying Cloudflare DoH...`)
        const ip = await resolveViaDoH('fal.run')
        if (!ip) throw err

        console.log(`[Fal.ai] Resolved fal.run -> ${ip} via DoH`)
        const fallbackAgent = new https.Agent({ family: 4, rejectUnauthorized: false })
        const fallbackUrl = url.replace('fal.run', ip)
        const resp = await axios({
          method, url: fallbackUrl, data,
          headers: { Authorization: `Key ${apiKey}`, Host: 'fal.run' },
          timeout: 120000, httpsAgent: fallbackAgent,
        })
        return resp.data
      }
      throw err
    }
  }

  return {
    /**
     * Generate image using fal.ai
     * @param {string} model - Model ID (e.g. 'fal-ai/flux/schnell')
     * @param {string} prompt - Image description
     * @param {object} options - { image_size, num_images, negative_prompt }
     * @returns {{ images: [{ url, content_type }], seed, prompt }}
     */
    async generateImage(model, prompt, options = {}) {
      // Map frontend size identifiers to Fal.ai expected formats
      const sizeMapping = {
        'landscape_4_3': { image_size: 'landscape_4_3', aspect_ratio: '4:3' },
        'landscape_16_9': { image_size: 'landscape_16_9', aspect_ratio: '16:9' },
        'square': { image_size: 'square', aspect_ratio: '1:1' },
        'square_hd': { image_size: 'square_hd', aspect_ratio: '1:1' },
        'portrait_4_3': { image_size: 'portrait_4_3', aspect_ratio: '3:4' },
        'portrait_16_9': { image_size: 'portrait_16_9', aspect_ratio: '9:16' },
      }

      const requestedSize = options.image_size || 'landscape_4_3'
      const mappedSize = sizeMapping[requestedSize] || sizeMapping['landscape_4_3']

      let sizePayload = {}
      if (model.includes('nano-banana') || model.includes('stable-diffusion')) {
        sizePayload = { aspect_ratio: mappedSize.aspect_ratio }
      } else if (model.includes('recraft')) {
        sizePayload = { image_size: mappedSize.image_size }
      } else {
        sizePayload = { image_size: mappedSize.image_size }
      }

      const payload = {
        prompt,
        ...sizePayload,
        num_images: options.num_images || 1,
        sync_mode: false,
        ...(options.negative_prompt && { negative_prompt: options.negative_prompt }),
      }

      console.log(`[Fal.ai] Calling ${model} with payload:`, JSON.stringify(payload))

      try {
        return await falRequest('post', `/${model}`, payload)
      } catch (err) {
        console.error(`[Fal.ai Error] Failed calling ${model}:`, err.response?.data || err.message)
        if (err.response?.data) {
          err.detail = err.response.data.detail || JSON.stringify(err.response.data)
        }
        throw err
      }
    }
  }
}

module.exports = { createFal }
