/**
 * Mobile Facebook Selectors — centralized registry
 * When FB changes DOM, update this file (or override via ~/.socialflow/selectors-override.json)
 */

const path = require('path')
const fs = require('fs')
const os = require('os')

// --- Like ---
const LIKE_SELECTORS = [
  'a[data-sigil*="like-reaction-flyout"]',
  'a[href*="/reactions/picker/"]',
  'a[data-sigil*="ufi-like"]',
  'a[role="button"][aria-label="Like"]',
  'a[role="button"][aria-label="Thích"]',
  'div[data-sigil="feed-ufi-likeable"]',
]

const ALREADY_LIKED_PATTERNS = ['unlike', 'Đã thích', 'Liked', 'Bỏ thích']

// --- Comment Input ---
const COMMENT_INPUT_SELECTORS = [
  'textarea[name="comment_text"]',             // classic mobile FB
  'textarea[data-sigil="comment-body-input"]',  // mbasic
  'textarea[placeholder*="bình luận" i]',
  'textarea[placeholder*="comment" i]',
  'div[contenteditable="true"][role="textbox"]', // newer mobile
  'textarea',                                    // last resort
]

// --- Comment Submit ---
const COMMENT_SUBMIT_SELECTORS = [
  'button[type="submit"][name="submit"]',    // mbasic
  'button[data-sigil="submit_composer"]',
  'input[type="submit"]',
  'button[type="submit"]',
]

// --- Comment Link (expand comment area) ---
const COMMENT_LINK_SELECTORS = [
  'a[href*="comment"]',
  'a[data-sigil*="comment"]',
  'span:has-text("Bình luận")',
  'span:has-text("Comment")',
]

// --- Post Containers ---
const POST_CONTAINERS = [
  'div[data-sigil*="story-div"]',
  'article[data-sigil*="story"]',
  'article',
  'div[data-ft]',  // older mobile FB post wrapper
]

// --- Post Links (extract individual post URLs) ---
const POST_LINK_PATTERNS = [
  'a[href*="/story.php"]',
  'a[href*="/posts/"]',
  'a[href*="/permalink/"]',
  'a[href*="/photo.php"]',
]

// --- Merge with override file if exists ---
function loadOverrides() {
  const overridePath = path.join(os.homedir(), '.socialflow', 'selectors-override.json')
  try {
    if (fs.existsSync(overridePath)) {
      const data = JSON.parse(fs.readFileSync(overridePath, 'utf8'))
      return data
    }
  } catch (err) {
    console.warn(`[SELECTORS] Override file error: ${err.message}`)
  }
  return null
}

function getSelectors() {
  const overrides = loadOverrides()
  if (!overrides) {
    return {
      LIKE_SELECTORS,
      ALREADY_LIKED_PATTERNS,
      COMMENT_INPUT_SELECTORS,
      COMMENT_SUBMIT_SELECTORS,
      COMMENT_LINK_SELECTORS,
      POST_CONTAINERS,
      POST_LINK_PATTERNS,
    }
  }

  return {
    LIKE_SELECTORS: overrides.LIKE_SELECTORS || LIKE_SELECTORS,
    ALREADY_LIKED_PATTERNS: overrides.ALREADY_LIKED_PATTERNS || ALREADY_LIKED_PATTERNS,
    COMMENT_INPUT_SELECTORS: overrides.COMMENT_INPUT_SELECTORS || COMMENT_INPUT_SELECTORS,
    COMMENT_SUBMIT_SELECTORS: overrides.COMMENT_SUBMIT_SELECTORS || COMMENT_SUBMIT_SELECTORS,
    COMMENT_LINK_SELECTORS: overrides.COMMENT_LINK_SELECTORS || COMMENT_LINK_SELECTORS,
    POST_CONTAINERS: overrides.POST_CONTAINERS || POST_CONTAINERS,
    POST_LINK_PATTERNS: overrides.POST_LINK_PATTERNS || POST_LINK_PATTERNS,
  }
}

/**
 * Convert URL to mobile Facebook
 */
function toMobileUrl(url) {
  return (url || '').replace('://www.facebook.com', '://m.facebook.com')
}

/**
 * Check if a like element indicates already-liked state
 * @param {string} text - element text or data-sigil value
 * @returns {boolean}
 */
function isAlreadyLiked(text) {
  if (!text) return false
  const lower = text.toLowerCase()
  return ALREADY_LIKED_PATTERNS.some(p => lower.includes(p.toLowerCase()))
}

module.exports = {
  getSelectors,
  toMobileUrl,
  isAlreadyLiked,
  // Direct exports for convenience
  LIKE_SELECTORS,
  ALREADY_LIKED_PATTERNS,
  COMMENT_INPUT_SELECTORS,
  COMMENT_SUBMIT_SELECTORS,
  COMMENT_LINK_SELECTORS,
  POST_CONTAINERS,
  POST_LINK_PATTERNS,
}
