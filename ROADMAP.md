# SocialFlow — Ke hoach phat trien tong the

**Version:** 2.0
**Cap nhat:** 2026-03-23
**Stack:** React + Vite + Tailwind · Fastify (Railway) · Supabase · Playwright + Camoufox · Multi-model AI · Cloudflare R2

---

## 1. Tong quan he thong hien tai

### 1.1 Nhung gi da co va chay duoc

| Module | Trang thai | Ghi chu |
|--------|-----------|---------|
| Quan ly nick (cookie auth) | ✅ | Health check, proxy, fingerprint |
| Giao Viec Ngay | ✅ | Lenh tu nhien → agent chay tuc thi |
| Hen Gio Lam Viec | ✅ | Schedule theo ngay/gio cu the |
| Auto-Pilot (1 vai) | ✅ | AI parse mission → chay hang ngay |
| Dang bai (page/group/profile) | ✅ | Ca Graph API va cookie |
| Comment bai viet | ✅ | AI gen content |
| Scan group keyword | ✅ | Tim bai theo tu khoa |
| Inbox fanpage | ✅ | GraphAPI + cookie |
| Media library | ✅ | R2 + video processing |
| Multi-machine agent | ✅ | Poll Supabase moi 5 giay |
| Bang proxies | ✅ | Chua enforce 1 nick = 1 proxy |
| Job retry (3 lan) | ✅ | Can bo sung phan loai loi |

### 1.2 Nhung gi can build them

| Module | Uu tien | Phuc tap |
|--------|---------|----------|
| Role-based Campaign | 🔴 Cao | Cao |
| Safe Concurrency Engine | 🔴 Cao | Trung binh |
| scan_profile_members (job moi) | 🔴 Cao | Trung binh |
| send_friend_request (job moi) | 🔴 Cao | Trung binh |
| watch_my_posts — auto reply comment | 🟡 TB | Trung binh |
| target_queue table + claim atomic | 🔴 Cao | Thap |
| friend_request_log table | 🔴 Cao | Thap |
| job_failures table + screenshot | 🟡 TB | Thap |
| daily_budget per nick | 🔴 Cao | Thap |
| Notification system | 🟡 TB | Thap |
| Proxy enforcement UI | 🟢 Thap | Thap |

---

## 2. Kien truc muc tieu

```
USER (Frontend — React)
  ├── Tong Quan (dashboard)
  ├── Giao Viec Ngay
  ├── Hen Gio
  ├── Tu Dong (Auto-Pilot)
  ├── [MOI] Chien Dich (Role Campaign)
  ├── May Tram
  ├── Giam Sat
  ├── Mau Prompt
  └── ...

BACKEND (Fastify / Railway)
  ├── routes/campaigns.js          ← MOI
  ├── services/campaign-planner.js ← MOI: AI parse roles
  ├── services/campaign-scheduler.js ← MOI: tao jobs hang ngay
  ├── services/ai-quota-decider.js ← MOI: AI tu quyet so luong
  └── services/notification.js    ← MOI: alert checkpoint

SUPABASE
  ├── accounts           (extend: daily_budget, nick_age_days)
  ├── jobs               (extend: attempt, error_message)
  ├── campaigns          ← MOI
  ├── campaign_roles     ← MOI
  ├── target_queue       ← MOI
  ├── friend_request_log ← MOI
  ├── job_failures       ← MOI
  └── notifications      ← MOI

LOCAL AGENT (Playwright)
  ├── processor.js       (extend: NickPool concurrency)
  ├── lib/randomizer.js  ← MOI
  ├── lib/error-classifier.js ← MOI
  └── handlers/
      ├── [MOI] campaign-discover-groups.js
      ├── [MOI] campaign-scan-members.js
      ├── [MOI] campaign-nurture-group.js
      ├── [MOI] campaign-send-friend-request.js
      ├── [MOI] campaign-interact-profile.js
      └── [MOI] watch-my-posts.js
```

---

## 3. Tinh nang moi — Role-based Campaign

### 3.1 Khai niem

Mot chien dich gom nhieu vai (Role), moi vai duoc gan nhom nick rieng voi nhiem vu rieng. AI tu len ke hoach, tu quyet so luong, tu chay hang ngay. Cac vai co the chia se du lieu voi nhau.

**Vi du thuc te:**
```
Chien dich "VPS Growth"
├── Role A (5 nick) — Tham do
│   "Tim group VPS, hosting. Tham gia, scan member active."
│   → ghi danh sach nguoi vao target_queue
│
├── Role B (5 nick) — Cham soc
│   "Vao group da join, like bai, comment tu nhien."
│
└── Role C (10 nick) — Ket noi
    "Nhan list tu Role A, ket ban, tuong tac profile."
    ← doc target_queue tu Role A
```

### 3.2 So sanh voi Auto-Pilot hien tai

| | Auto-Pilot | Role Campaign |
|---|-----------|---------------|
| So vai | 1 | N (toi da 5) |
| Giao tiep giua nick | Khong | Role A → Role C qua target_queue |
| AI quyet so luong | Khong | Co — dua vao health + quota + gio |
| Scope | 1 may | Multi-machine |
| Concurrency control | Khong | Co — NickPool |

### 3.3 Database schema

```sql
-- Bang chinh
CREATE TABLE campaigns (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id              UUID REFERENCES auth.users(id),
  name                  TEXT NOT NULL,
  topic                 TEXT NOT NULL,
  status                TEXT DEFAULT 'idle'
    CHECK (status IN ('idle','running','paused','completed','error')),
  schedule_type         TEXT DEFAULT 'daily'
    CHECK (schedule_type IN ('daily','once','interval')),
  start_time            TIME DEFAULT '06:00',
  end_time              TIME DEFAULT '22:00',
  active_days           INT[] DEFAULT '{1,2,3,4,5,6,0}',
  nick_stagger_seconds  INT DEFAULT 60,
  role_stagger_minutes  INT DEFAULT 30,
  total_runs            INT DEFAULT 0,
  last_run_at           TIMESTAMPTZ,
  next_run_at           TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Tung vai
CREATE TABLE campaign_roles (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  role_type      TEXT NOT NULL
    CHECK (role_type IN ('scout','nurture','connect','post','custom')),
  account_ids    UUID[] NOT NULL,
  mission        TEXT NOT NULL,
  parsed_plan    JSONB,
  quota_override JSONB DEFAULT NULL,
  feeds_into     UUID REFERENCES campaign_roles(id),
  read_from      UUID REFERENCES campaign_roles(id),
  sort_order     INT DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Queue nguoi muc tieu (Role A → Role C)
CREATE TABLE target_queue (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       UUID REFERENCES campaigns(id) ON DELETE CASCADE,
  source_role_id    UUID REFERENCES campaign_roles(id),
  target_role_id    UUID REFERENCES campaign_roles(id),
  fb_user_id        TEXT NOT NULL,
  fb_user_name      TEXT,
  fb_profile_url    TEXT,
  source_group_name TEXT,
  active_score      REAL DEFAULT 0,
  status            TEXT DEFAULT 'pending'
    CHECK (status IN ('pending','assigned','done','skip','failed')),
  assigned_to       UUID REFERENCES accounts(id),
  processed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(campaign_id, fb_user_id)
);

CREATE INDEX idx_target_queue_pending
  ON target_queue(campaign_id, target_role_id, status)
  WHERE status = 'pending';

-- Log ket ban — dedup toan he thong
CREATE TABLE friend_request_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     UUID REFERENCES accounts(id),
  campaign_id    UUID REFERENCES campaigns(id),
  target_fb_id   TEXT NOT NULL,
  target_name    TEXT,
  status         TEXT DEFAULT 'sent'
    CHECK (status IN ('sent','accepted','declined','cancelled','already_friend')),
  sent_at        TIMESTAMPTZ DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ,
  UNIQUE(account_id, target_fb_id)
);

-- Atomic claim — tranh 2 nick lay cung 1 nguoi
CREATE OR REPLACE FUNCTION claim_targets(
  p_campaign_id    UUID,
  p_target_role_id UUID,
  p_account_id     UUID,
  p_limit          INT DEFAULT 10
) RETURNS SETOF target_queue AS $$
BEGIN
  RETURN QUERY
  UPDATE target_queue SET status = 'assigned', assigned_to = p_account_id
  WHERE id IN (
    SELECT id FROM target_queue
    WHERE campaign_id = p_campaign_id
      AND target_role_id = p_target_role_id
      AND status = 'pending'
    ORDER BY active_score DESC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$ LANGUAGE plpgsql;
```

---

## 4. Safe Concurrency Engine

### 4.1 Nguyen tac cot loi

- Toi da 2 nick concurrent tren cung 1 may tai 1 thoi diem
- Khong bao gio dung so co dinh — moi timing deu co jitter ngau nhien
- Nick khoi dong lech nhau — khong bao gio cung gio
- 1 nick = 1 proxy (enforce khi scale len 30+ nick)

### 4.2 NickPool — concurrency controller

```javascript
const MAX_CONCURRENT = 2

class NickPool {
  constructor() {
    this.running = new Set()
  }

  async acquire(accountId) {
    while (this.running.size >= MAX_CONCURRENT) {
      await sleep(3000)
    }
    this.running.add(accountId)
  }

  release(accountId) {
    this.running.delete(accountId)
  }
}
```

### 4.3 Randomizer — tat ca timing deu ngau nhien

```javascript
const R = {
  nickStartOffset: (idx) => {
    const base   = idx * 18 * 60 * 1000
    const jitter = Math.random() * 15 * 60 * 1000
    return base + jitter
  },
  actionGap: () => ms(45 + Math.random() * 75),
  friendRequestGap: () => ms(45 + Math.random() * 45),
  joinGroupGap: () => ms(90 + Math.random() * 90),
  likeCount:    () => Math.floor(10 + Math.random() * 40),
  commentCount: () => Math.floor(3  + Math.random() * 12),
  friendCount:  () => Math.floor(4  + Math.random() * 8),
  keyDelay:     () => 50 + Math.random() * 130,
  thinkPause:   () => Math.random() < 0.05 ? 500 + Math.random() * 1000 : 0,
  clickOffset: (box) => ({
    x: box.width  * (0.3 + Math.random() * 0.4),
    y: box.height * (0.3 + Math.random() * 0.4)
  })
}
```

---

## 5. Retry & Failure System

### 5.1 Database

```sql
CREATE TABLE job_failures (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id         UUID REFERENCES jobs(id),
  account_id     UUID REFERENCES accounts(id),
  campaign_id    UUID,
  error_type     TEXT,
  error_message  TEXT,
  screenshot_url TEXT,
  page_url       TEXT,
  attempt        INT,
  will_retry     BOOLEAN,
  next_retry_at  TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID REFERENCES auth.users(id),
  type       TEXT,
  title      TEXT,
  body       TEXT,
  data       JSONB,
  level      TEXT DEFAULT 'info'
    CHECK (level IN ('info','warning','urgent')),
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE VIEW account_health_summary AS
SELECT
  a.id, a.username, a.status,
  COUNT(jf.id) FILTER (WHERE jf.created_at > NOW()-INTERVAL '24h') AS fails_24h,
  COUNT(jf.id) FILTER (WHERE jf.error_type = 'CHECKPOINT') AS total_checkpoints,
  MAX(jf.created_at) AS last_fail_at
FROM accounts a
LEFT JOIN job_failures jf ON jf.account_id = a.id
GROUP BY a.id, a.username, a.status;
```

### 5.2 Phan loai loi

```javascript
const ERROR_CONFIG = {
  CHECKPOINT: {
    patterns: ['checkpoint', 'security check', 'verify your identity'],
    retry: false, pauseAccount: true, alertLevel: 'urgent'
  },
  RATE_LIMIT: {
    patterns: ['try again later', 'too many requests'],
    retry: true, delayMin: 60, alertLevel: 'warning'
  },
  SESSION_EXPIRED: {
    patterns: ['session expired', 'please log in'],
    retry: false, refreshCookie: true, alertLevel: 'warning'
  },
  ELEMENT_NOT_FOUND: {
    patterns: ['TimeoutError', 'waiting for selector'],
    retry: true, delayMin: 5, alertLevel: null
  },
  NETWORK_ERROR: {
    patterns: ['net::ERR', 'ECONNREFUSED', 'ETIMEDOUT'],
    retry: true, delayMin: 10, alertLevel: null
  },
  UNKNOWN: {
    patterns: [], retry: true, delayMin: 15, alertLevel: 'info'
  }
}
```

---

## 6. Daily Budget per Nick

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS daily_budget JSONB DEFAULT '{
  "like":           {"used": 0, "max": 80},
  "comment":        {"used": 0, "max": 25},
  "friend_request": {"used": 0, "max": 15},
  "join_group":     {"used": 0, "max": 3},
  "post":           {"used": 0, "max": 5},
  "scan":           {"used": 0, "max": 10},
  "reset_at":       null
}';

-- Hard limits
-- friend_request: max 20/day, 5/session, 45s gap
-- join_group:     max 3/day,  1/session, 120s gap
-- comment:        max 30/day, 8/session, 10s gap
-- like:           max 100/day, 25/session, 2s gap
-- post:           max 5/day,  2/session, 60s gap

-- Nick < 30 ngay → 40% quota
-- Nick < 90 ngay → 65% quota
-- Nick < 180 ngay → 85% quota
```

---

## 7. IP & Proxy Strategy

| Giai doan | Mo ta |
|-----------|-------|
| GD1 (ngay) | Multi-machine tu nhien. Moi may IP khac nhau → phan bo nick deu |
| GD2 (30+ nick) | Mua proxy mobile 4G. 1 proxy = 1 nick co dinh |

**Rule vang:**
- 1 nick = 1 proxy co dinh
- Proxy cung timezone VN
- Khong dung datacenter proxy (FB blacklist)
- Mobile 4G > residential > datacenter

---

## 8. Ke hoach trien khai

### Sprint 1 — Nen tang (2 ngay)
- [ ] Migration: 5 bang moi
- [ ] Supabase RPC: claim_targets, increment_budget
- [ ] lib/randomizer.js, error-classifier.js, human.js
- [ ] processor.js — NickPool + processWithRetry

### Sprint 2 — Backend Campaign (2 ngay)
- [ ] routes/campaigns.js — CRUD + start/pause/run-now
- [ ] services/campaign-planner.js — AI parse mission
- [ ] services/ai-quota-decider.js
- [ ] services/campaign-scheduler.js

### Sprint 3 — Agent Handlers (2 ngay)
- [ ] campaign-discover-groups.js
- [ ] campaign-scan-members.js
- [ ] campaign-nurture-group.js
- [ ] campaign-send-friend-request.js
- [ ] campaign-interact-profile.js
- [ ] watch-my-posts.js

### Sprint 4 — Frontend (2 ngay)
- [ ] Route /campaigns + danh sach
- [ ] Form tao/sua campaign + RoleCard
- [ ] AI parse preview + Gantt timeline
- [ ] Stats realtime panel
- [ ] Notification system
- [ ] Account Health tab

### Sprint 5 — Polish & Test (1 ngay)
- [ ] Test end-to-end voi 5 nick that
- [ ] Daily scheduler (Railway cron)
- [ ] Proxy warning UI
- [ ] Export CSV

**Tong: ~9 ngay**
