// Fastify CORS plugin
// Allow all origins + Private Network Access (Chrome 104+)
const fp = require('fastify-plugin')

module.exports = fp(async (fastify) => {
  fastify.register(require('@fastify/cors'), {
    origin: (origin, cb) => cb(null, true), // reflect any origin
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })

  // Chrome Private Network Access: required when public website calls private/local IP
  // https://developer.chrome.com/blog/private-network-access-preflight/
  fastify.addHook('onSend', (request, reply, payload, done) => {
    reply.header('Access-Control-Allow-Private-Network', 'true')
    done()
  })
})
