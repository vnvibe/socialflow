// Facebook Browser Post - posting via Playwright browser automation
// This is handled by the Local Agent, not the API server.
// The API creates jobs of type 'post_page', 'post_group', 'post_profile'
// and the agent picks them up and executes via browser.

// This file provides utility functions that can be used by the API
// for cases where direct browser posting is needed from the server side.

const { postToPage, postToGroup, postToProfile } = require('./fb-cookie-post')

// Prefer cookie-based posting (lighter, no browser needed)
// Fall back to browser posting via agent jobs when:
// - Media needs to be uploaded (images/videos)
// - Cookie posting fails
// - Account requires browser interaction

async function createPostJob(supabase, { type, content_id, target_id, account_id, userId }) {
  const jobType = {
    page: 'post_page',
    group: 'post_group',
    profile: 'post_profile'
  }[type]

  if (!jobType) throw new Error(`Invalid post type: ${type}`)

  const { data, error } = await supabase.from('jobs').insert({
    type: jobType,
    payload: { content_id, target_id, account_id },
    created_by: userId
  }).select().single()

  if (error) throw error
  return data
}

// Smart post: try cookie first, fallback to browser job
async function smartPost(supabase, { type, content, account, targetId, userId }) {
  // If content has media, always use browser (needs file upload)
  if (content.media_id) {
    return createPostJob(supabase, {
      type,
      content_id: content.id,
      target_id: targetId,
      account_id: account.id,
      userId
    })
  }

  // Try cookie-based post first (faster, lighter)
  try {
    let result
    if (type === 'page') {
      result = await postToPage(targetId, account, content, supabase)
    } else if (type === 'group') {
      result = await postToGroup(targetId, account, content, supabase)
    } else if (type === 'profile') {
      result = await postToProfile(account, content, supabase)
    }

    if (result?.success) {
      // Log to publish_history
      await supabase.from('publish_history').insert({
        content_id: content.id,
        account_id: account.id,
        target_type: type,
        target_fb_id: targetId,
        final_caption: content.caption,
        status: 'success',
        post_url: result.postUrl,
        fb_post_id: result.postId,
        published_at: new Date()
      })
      return { method: 'cookie', ...result }
    }
  } catch (err) {
    console.warn(`Cookie post failed for ${type}, falling back to browser:`, err.message)
  }

  // Fallback to browser job
  const job = await createPostJob(supabase, {
    type,
    content_id: content.id,
    target_id: targetId,
    account_id: account.id,
    userId
  })

  return { method: 'browser', job_id: job.id }
}

module.exports = { createPostJob, smartPost }
