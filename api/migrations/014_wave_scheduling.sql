-- 014_wave_scheduling.sql — Wave scheduling system
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS wave_config JSONB DEFAULT '{
  "enabled": false,
  "wave_duration_minutes": 180,
  "waves": [
    {"start": 6, "end": 9, "nick_ratio": 0.4},
    {"start": 10, "end": 13, "nick_ratio": 0.3},
    {"start": 14, "end": 17, "nick_ratio": 0.3},
    {"start": 19, "end": 22, "nick_ratio": 0.4}
  ]
}'::jsonb;
