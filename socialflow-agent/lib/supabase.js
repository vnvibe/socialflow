// Agent DB client — REST proxy to VPS Postgres via /agent-db/query.
// The old Supabase cloud backend was dead data; all agent traffic
// now goes through the API so VPS Postgres is the single source of
// truth. Handler code keeps the supabase-js builder API unchanged —
// see lib/supabase-rest.js for the shim.
module.exports = require('./supabase-rest')
