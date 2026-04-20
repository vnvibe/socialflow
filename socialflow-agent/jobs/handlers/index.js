// Handler registry — lazy, optional loading.
//
// Old style was `const x = require('./x')` at top, which crashed the
// entire agent at boot if ANY single handler file was missing. 7 handlers
// had stale imports pointing to files that never existed (join-group,
// campaign-scan-members, campaign-send-friend-request,
// campaign-interact-profile, campaign-group-monitor,
// campaign-opportunity-react, watch-my-posts) → MODULE_NOT_FOUND → agent
// stopped with exit code 1.
//
// New style: try-require each handler, log a warning on miss, omit from
// the exported map. If a job of an unmapped type ever arrives, the
// poller already handles "no handler for type X" — that's better than a
// boot crash.

function tryRequire(name) {
  try {
    return require(`./${name}`)
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      // Handler file missing OR its inner imports are missing. Either
      // way we can't use this handler; log and skip. Real syntax errors
      // still throw (SyntaxError, ReferenceError, etc.) so we don't ship
      // silently broken code.
      console.warn(`[HANDLERS] ${name} unavailable: ${err.message.split('\n')[0]}`)
      return null
    }
    throw err
  }
}

const map = {
  post_page: tryRequire('post-page'),
  post_page_graph: tryRequire('post-page-graph'),
  post_group: tryRequire('post-group'),
  post_profile: tryRequire('post-profile'),
  check_health: tryRequire('check-health'),
  fetch_pages: tryRequire('fetch-pages'),
  fetch_groups: tryRequire('fetch-groups'),
  fetch_all: tryRequire('fetch-all'),
  resolve_group: tryRequire('resolve-group'),
  scan_group_keyword: tryRequire('scan-group-keyword'),
  discover_groups_keyword: tryRequire('discover-groups-keyword'),
  check_engagement: tryRequire('check-engagement'),
  scan_group_feed: tryRequire('scan-group-feed'),
  comment_post: tryRequire('comment-post'),
  fetch_source_cookie: tryRequire('fetch-source-cookie'),
  join_group: tryRequire('join-group'),

  // Campaign role handlers
  campaign_discover_groups: tryRequire('campaign-discover-groups'),
  campaign_scan_members: tryRequire('campaign-scan-members'),
  campaign_nurture: tryRequire('campaign-nurture'),
  campaign_send_friend_request: tryRequire('campaign-send-friend-request'),
  campaign_interact_profile: tryRequire('campaign-interact-profile'),
  campaign_post: tryRequire('campaign-post'),
  campaign_group_monitor: tryRequire('campaign-group-monitor'),
  campaign_opportunity_react: tryRequire('campaign-opportunity-react'),
  watch_my_posts: tryRequire('watch-my-posts'),
  nurture_feed: tryRequire('nurture-feed'),
  check_group_membership: tryRequire('check-group-membership'),
}

const loaded = []
const missing = []
const out = {}
for (const [type, handler] of Object.entries(map)) {
  if (handler) { out[type] = handler; loaded.push(type) }
  else missing.push(type)
}

if (missing.length) {
  console.warn(`[HANDLERS] Missing handler files (skipped): ${missing.join(', ')}`)
}
console.log(`[HANDLERS] Loaded ${loaded.length} handlers: ${loaded.join(', ')}`)

module.exports = out
