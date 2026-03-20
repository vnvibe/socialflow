require('dotenv').config()
const Fastify = require('fastify')
const { createClient } = require('@supabase/supabase-js')
const { initScheduler } = require('./services/campaign-scheduler')

const app = Fastify({ logger: true })

// Supabase admin client (service role)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Decorate supabase on fastify instance
app.decorate('supabase', supabase)

// Plugins
app.register(require('./plugins/cors'))
app.register(require('./plugins/auth'))
app.register(require('./plugins/r2'))
app.register(require('@fastify/multipart'), {
  limits: {
    fileSize: 500 * 1024 * 1024 // 500MB max
  }
})

// Routes
app.register(require('./routes/auth'), { prefix: '/auth' })
app.register(require('./routes/accounts'), { prefix: '/accounts' })
app.register(require('./routes/proxies'), { prefix: '/proxies' })
app.register(require('./routes/fanpages'), { prefix: '/fanpages' })
app.register(require('./routes/groups'), { prefix: '/groups' })
app.register(require('./routes/media'), { prefix: '/media' })
app.register(require('./routes/content'), { prefix: '/content' })
app.register(require('./routes/jobs'), { prefix: '/jobs' })
app.register(require('./routes/campaigns'), { prefix: '/campaigns' })
app.register(require('./routes/ai'), { prefix: '/ai' })
app.register(require('./routes/trends'), { prefix: '/trends' })
app.register(require('./routes/inbox'), { prefix: '/inbox' })
app.register(require('./routes/analytics'), { prefix: '/analytics' })
app.register(require('./routes/users'), { prefix: '/users' })
app.register(require('./routes/agent'), { prefix: '/agent' })
app.register(require('./routes/monitor'), { prefix: '/monitor' })
app.register(require('./routes/system-settings'), { prefix: '/system-settings' })
app.register(require('./routes/facebook'), { prefix: '/facebook' })
app.register(require('./routes/research'), { prefix: '/research' })
app.register(require('./routes/websites'), { prefix: '/websites' })
app.register(require('./routes/monitoring'), { prefix: '/monitoring' })
app.register(require('./routes/user-settings'), { prefix: '/user-settings' })
app.register(require('./routes/permissions'), { prefix: '/permissions' })

// Health check
app.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }))

// Start server
const start = async () => {
  try {
    const port = parseInt(process.env.PORT) || 3000
    await app.listen({ port, host: '0.0.0.0' })

    // Start campaign scheduler
    initScheduler()

    console.log(`SocialFlow API running on port ${port}`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

start()
