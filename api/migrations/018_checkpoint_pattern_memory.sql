-- Allow 'checkpoint_pattern' as a valid ai_pilot_memory.memory_type so the
-- cookie-death postmortem can persist its findings. Original constraint
-- listed only 3 types; adding a 4th for per-nick death pattern learning.

ALTER TABLE ai_pilot_memory
  DROP CONSTRAINT IF EXISTS ai_pilot_memory_memory_type_check;

ALTER TABLE ai_pilot_memory
  ADD CONSTRAINT ai_pilot_memory_memory_type_check
  CHECK (memory_type = ANY (ARRAY[
    'campaign_pattern',
    'nick_behavior',
    'group_response',
    'checkpoint_pattern'
  ]));
