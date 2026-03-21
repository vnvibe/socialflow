// Fastify CORS plugin
// Allow all origins in dev, configure for production
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
})
