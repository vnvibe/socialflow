-- =====================================================================
-- 011_check_group_membership_type.sql
-- Allow jobs.type = 'check_group_membership' for the Phase 7 cron that
-- re-verifies groups whose join request is still pending admin approval.
-- Also re-adds campaign_group_monitor + campaign_opportunity_react which
-- had drifted from the live constraint.
-- =====================================================================

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_type_check CHECK (type = ANY (ARRAY[
  'post_page','post_page_graph','post_profile','post_group',
  'fetch_inbox','reply_inbox','check_health',
  'fetch_pages','fetch_groups','fetch_all',
  'comment_post','scan_group_keyword','scan_group_feed','discover_groups_keyword',
  'check_engagement','resolve_group','fetch_source_cookie','join_group',
  'campaign_discover_groups','campaign_send_friend_request','campaign_nurture',
  'campaign_post','campaign_scan_members','campaign_interact_profile',
  'campaign_group_monitor','campaign_opportunity_react',
  'watch_my_posts','warmup_browse','campaign_cleanup_groups','nurture_feed',
  'check_group_membership'
]));
