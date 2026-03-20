-- =======================================
-- SYSTEM SETTINGS (admin-only config)
-- =======================================
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES auth.users(id)
);

-- Seed R2 storage setting
INSERT INTO system_settings (key, value) VALUES
    ('r2_storage', '{}')
ON CONFLICT (key) DO NOTHING;

-- RLS: only admin can read/write
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_all" ON system_settings FOR ALL
    USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
