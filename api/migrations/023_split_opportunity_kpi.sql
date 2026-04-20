-- 023: Tách KPI quảng cáo (opportunity_comment) khỏi comment thường.
--
-- Trước: `done_comments` gộp cả comment thường + opportunity_comment →
-- không đo được chiến dịch QC có đang chạy tốt không, lẫn vào KPI
-- tương tác chung.
--
-- Sau: khi campaign bật brand_config, bot có mini-mission riêng
-- (opportunity_comment 1-2/nick/ngày). Tách thành cột riêng cho phép:
--   - Báo cáo ngày thấy "QC: 4/6" tách biệt với "Comment: 12/15"
--   - Hermes chấm điểm 2 chỉ số độc lập
--   - Cost analysis: QC chạy bao nhiêu lần/ngày, hiệu quả ra sao
--
-- Account chưa bật brand giữ nguyên target_opportunity_comments = 0 →
-- kpi_met bypass (điều kiện `target = 0 OR done >= target` luôn true).

ALTER TABLE nick_kpi_daily
  ADD COLUMN IF NOT EXISTS target_opportunity_comments INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS done_opportunity_comments   INT DEFAULT 0;

-- Recompute kpi_met để tính cả opportunity_comments khi target > 0.
CREATE OR REPLACE FUNCTION increment_kpi(
  p_campaign_id UUID,
  p_account_id UUID,
  p_date DATE,
  p_field TEXT,
  p_delta INT DEFAULT 1
) RETURNS void AS $$
BEGIN
  INSERT INTO nick_kpi_daily (campaign_id, account_id, date)
  VALUES (p_campaign_id, p_account_id, p_date)
  ON CONFLICT (campaign_id, account_id, date) DO NOTHING;

  EXECUTE format(
    'UPDATE nick_kpi_daily SET %I = COALESCE(%I, 0) + $1, last_updated_at = now() WHERE campaign_id = $2 AND account_id = $3 AND date = $4',
    p_field, p_field
  ) USING p_delta, p_campaign_id, p_account_id, p_date;

  UPDATE nick_kpi_daily SET kpi_met = (
    (target_likes = 0 OR done_likes >= target_likes) AND
    (target_comments = 0 OR done_comments >= target_comments) AND
    (target_friend_requests = 0 OR done_friend_requests >= target_friend_requests) AND
    (target_group_joins = 0 OR done_group_joins >= target_group_joins) AND
    (COALESCE(target_opportunity_comments, 0) = 0 OR done_opportunity_comments >= target_opportunity_comments)
  )
  WHERE campaign_id = p_campaign_id AND account_id = p_account_id AND date = p_date;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON COLUMN nick_kpi_daily.target_opportunity_comments IS
  'Daily target for branded/ad comments (opportunity_comment action). 0 when campaign has no brand_config.';
COMMENT ON COLUMN nick_kpi_daily.done_opportunity_comments IS
  'Actual branded/ad comments posted today. Separate from done_comments.';
