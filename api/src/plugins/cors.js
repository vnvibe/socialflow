// Fastify CORS plugin
// Allow all origins in dev, configure for production
const fp = require('fastify-plugin')

module.exports = fp(async (fastify) => {
  fastify.register(require('@fastify/cors'), {
    origin: true, // Allow all in dev
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
})
