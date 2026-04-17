# HERMES CENTRAL BRAIN — Tiếp quản toàn bộ vận hành campaign

## Triết lý
Hiện tại: User phải tự quyết định nick nào làm gì, group nào join, pending bao lâu thì skip.
Sau khi làm xong: Hermes đọc trạng thái campaign → tự quyết định → agent chỉ thực thi.

**Hermes = Campaign Manager. Agent = Tay chân. User = Người duyệt kết quả.**

---

## PHẦN 1 — Hermes Campaign Orchestrator (não trung tâm)

### 1.1 Endpoint mới: POST /ai-hermes/orchestrate/:campaign_id

Hermes nhận toàn bộ context của campaign → trả về danh sách việc cần làm ngay.

**Input (server tự fetch, không cần client pass):**
```python
def build_orchestration_context(campaign_id):
    return {
        "campaign": {
            "goal": ...,
            "hermes_context": ...,  # product info
            "status": "running",
            "running_days": 3
        },
        "nicks": [
            {
                "id": "...", "username": "Việt Nguyễn",
                "status": "healthy",  # healthy/checkpoint/expired
                "role": "Nurture",
                "jobs_today": 12, "jobs_failed": 0,
                "hermes_score": 4.2,
                "memories": 22,
                "active_job": None  # đang rảnh
            }
        ],
        "groups": [
            {
                "id": "...", "name": "Nhóm Hosting VN",
                "join_status": "member",  # member/pending/rejected/unknown
                "member_count": 15000,
                "pending_days": None,
                "posts_this_week": 3,
                "last_posted_at": "2026-04-15"
            },
            {
                "name": "Dev Vietnam",
                "join_status": "pending",
                "pending_days": 8  # quá hạn!
            }
        ],
        "stats_today": {
            "comments": 15, "posts": 2, "interactions": 34,
            "failed_jobs": 1, "checkpoints": 2
        },
        "pending_issues": [
            "2 nicks checkpoint chưa xử lý",
            "3 groups pending >7 ngày",
            "Diệu Hiền idle 4 giờ chưa có job"
        ]
    }
```

**Hermes skill mới: `orchestrator`**
```markdown
# ~/.hermes/skills/socialflow/orchestrator.md

Bạn là Campaign Manager AI cho hệ thống marketing Facebook.
Nhiệm vụ: Đọc trạng thái campaign → đưa ra quyết định cụ thể.

Luôn trả về JSON với format:
{
  "summary": "Tóm tắt tình hình 1-2 câu",
  "health_score": 0-100,
  "issues": ["vấn đề 1", "vấn đề 2"],
  "actions": [
    {
      "priority": "critical|high|medium|low",
      "type": "assign_job|skip_group|recheck_group|reassign_nick|pause_nick|create_content|alert_user",
      "target_id": "uuid của nick/group/job",
      "target_name": "tên hiển thị",
      "action_detail": { ... },  # params cụ thể
      "reason": "Lý do ngắn gọn",
      "auto_apply": true/false  # true = tự làm, false = cần user duyệt
    }
  ],
  "next_review_minutes": 30  # Hermes muốn được review lại sau bao lâu
}

Quy tắc quyết định:
- Nick healthy + idle > 30min + campaign running → assign_job (auto_apply: true)
- Group pending > 7 ngày → skip_group (auto_apply: true)  
- Group pending 3-7 ngày → recheck_group (auto_apply: true)
- Nick checkpoint → alert_user (auto_apply: false, cần user sửa cookie)
- Nick score < 3.0 liên tục → pause_nick (auto_apply: false)
- Số comments hôm nay < 50% target → tăng frequency cho nick đang tốt
- Group member có engagement tốt → ưu tiên post thêm
```

### 1.2 Auto-execute actions từ orchestrator

```javascript
// api/src/services/hermes-orchestrator.js
async function runOrchestration(campaignId) {
  const context = await buildOrchestrationContext(campaignId)
  const result = await hermesAPI.post('/orchestrate/' + campaignId, context)
  
  for (const action of result.actions) {
    if (action.auto_apply) {
      await executeAction(action)
      await logAction(campaignId, action, 'auto_applied')
    } else {
      await createPendingRecommendation(campaignId, action)
      // Hiện trong UI để user duyệt
    }
  }
  
  return result
}

async function executeAction(action) {
  switch (action.type) {
    case 'assign_job':
      // Tạo job cho nick idle
      await db.query(`INSERT INTO jobs (account_id, type, campaign_id, payload) VALUES ...`)
      break
      
    case 'skip_group':
      // Mark group as skipped, không join nữa
      await db.query(`UPDATE fb_groups SET join_status='rejected', skip_reason='pending_timeout' WHERE id=$1`, [action.target_id])
      break
      
    case 'recheck_group':
      // Tạo job check_group_membership cho nick phù hợp
      await db.query(`INSERT INTO jobs (type, payload) VALUES ('check_group_membership', $1)`, [{ group_id: action.target_id }])
      break
      
    case 'reassign_nick':
      // Đổi role của nick trong campaign
      await db.query(`UPDATE campaign_roles SET role=$1 WHERE account_id=$2 AND campaign_id=$3`, 
        [action.action_detail.new_role, action.target_id, action.campaign_id])
      break
  }
}
```

### 1.3 Cron: Orchestrator chạy tự động

```javascript
// Mỗi 15 phút với mỗi campaign RUNNING
cron.schedule('*/15 * * * *', async () => {
  const campaigns = await db.query(`SELECT id FROM campaigns WHERE status='running'`)
  for (const camp of campaigns.rows) {
    try {
      const result = await runOrchestration(camp.id)
      console.log(`[ORCHESTRATOR] campaign=${camp.id} health=${result.health_score} actions=${result.actions.length}`)
    } catch (err) {
      console.error(`[ORCHESTRATOR] failed for ${camp.id}:`, err.message)
    }
  }
})
```

---

## PHẦN 2 — Group Intelligence

### 2.1 Hermes quyết định group nào nên join/skip/recheck

**Skill mới: `group_evaluator`**
```markdown
# ~/.hermes/skills/socialflow/group-evaluator.md

Đánh giá group Facebook có phù hợp để marketing không.
Input: { name, member_count, group_type, keywords, post_frequency, pending_days }
Output JSON:
{
  "score": 0-10,
  "decision": "join|skip|recheck|wait",
  "reason": "...",
  "priority": "high|medium|low"
}

Tiêu chí:
- member_count > 5000: +3 điểm
- group_type = public: +2 điểm  
- Tên/keywords liên quan product: +3 điểm
- pending_days > 7: decision = "skip"
- pending_days 3-7: decision = "recheck"
```

### 2.2 Auto-flow group management

```
Hermes Orchestrator chạy mỗi 15 phút:

Groups pending > 7 ngày:
  → Hermes: decision=skip, auto_apply=true
  → UPDATE join_status='skipped'
  → Tìm group thay thế (tạo discover_groups job)

Groups pending 3-7 ngày:
  → Hermes: decision=recheck, auto_apply=true  
  → Tạo job check_group_membership
  → Agent vào check → nếu member → update status
  → Nếu vẫn pending → để thêm 2 ngày

Groups member nhưng chưa post 3+ ngày:
  → Hermes: create post job
  → assign cho nick có score cao nhất

Groups member, đã post, engagement tốt:
  → Hermes: tăng frequency
  → remember() "high_engagement_group"
```

---

## PHẦN 3 — Interaction Intelligence

### 3.1 Hermes quyết định comment style theo context

Khi agent chuẩn bị comment 1 post, pass thêm context:
```javascript
// Trong campaign-nurture.js, trước khi gọi Hermes:
const interactionContext = {
  post_text: postBody,           // nội dung bài
  post_author: authorName,       // người đăng
  group_name: groupName,         // tên nhóm
  group_member_count: memberCount,
  existing_comments: commentsPreview,  // 2-3 comment đã có
  nick_previous_comments: await getRecentComments(accountId, groupId, 3),
  campaign_goal: campaign.goal,
  product_context: campaign.hermes_context
}

const comment = await hermesClient.generateComment({
  post_text: postBody,
  campaign_id: campaignId,
  account_id: accountId,
  interaction_context: interactionContext  // NEW
})
```

**Hermes sẽ quyết định:**
- Nick đã comment trong group này gần đây → comment khác style, không lặp
- Post có nhiều comment rồi → comment ngắn hơn
- Post liên quan trực tiếp product → mention sản phẩm tự nhiên
- Post không liên quan → comment value trước, không mention product

### 3.2 Interaction memory per group

Sau mỗi interaction:
```javascript
// remember theo (account, group, post_type)
await remember(accountId, campaignId, groupFbId, 'nick_behavior', 
  'interaction_pattern', {
    post_keywords: extractKeywords(postBody),
    comment_length: comment.length,
    comment_style: hermesResult.style,  // 'question' | 'share_experience' | 'advice'
    engagement: null  // update sau khi check lại
  }
)

// Sau 24h, agent check lại post:
// Nếu comment được like/reply → update engagement=high
// remember() với confidence tăng
// Hermes dùng example này cho lần sau
```

---

## PHẦN 4 — Báo cáo thông minh từ Hermes

### 4.1 Hermes tự gen báo cáo

**Endpoint: POST /ai-hermes/report/:campaign_id**

```python
# Skill: reporter
# Hermes đọc stats → viết báo cáo bằng tiếng Việt tự nhiên

Input:
  - Stats 7 ngày
  - Top performing nicks
  - Top performing groups  
  - Failed jobs + reasons
  - Memory insights (những gì đã học)

Output:
{
  "executive_summary": "Tuần này campaign Openclaw VPS hoạt động ổn định...",
  "highlights": ["Việt Nguyễn là nick hiệu quả nhất với score 4.2", "Nhóm Hosting VN cho engagement tốt nhất"],
  "issues": ["2 nick bị checkpoint cần xử lý", "3 group pending quá hạn"],  
  "recommendations": ["Tăng tần suất post cho Nhóm Dev Vietnam", "Thêm nick mới thay Do Hoang Nam"],
  "next_week_plan": "Tập trung discover thêm 10 group mới, scale comment cho Việt Nguyễn..."
}
```

### 4.2 UI: /reports tab "Hermes Analysis"

Hiện báo cáo Hermes gen tự động:
```
┌─────────────────────────────────────────────────────┐
│ 🧠 HERMES ANALYSIS — Openclaw VPS                   │
│ Cập nhật: 22:15 hôm nay                             │
├─────────────────────────────────────────────────────┤
│ "Tuần này campaign hoạt động ổn định với 156 jobs   │
│  thành công. Việt Nguyễn dẫn đầu với score 4.2.    │
│  Cần xử lý 2 nick checkpoint và 3 group pending."  │
│                                                     │
│ ✅ ĐIỂM NỔI BẬT          ⚠️ VẤN ĐỀ CẦN XỬ LÝ      │
│ • Việt Nguyễn: 4.2 score  • Do Hoang Nam: checkpoint │
│ • Hosting VN: top group   • 3 groups pending >7d    │
│                                                     │
│ 📋 KẾ HOẠCH TUẦN TỚI                               │
│ Hermes đề xuất: Discover thêm 10 groups, scale...  │
│                                                     │
│ [Áp dụng kế hoạch] [Xem chi tiết] [Tạo báo cáo PDF]│
└─────────────────────────────────────────────────────┘
```

---

## PHẦN 5 — Đồng bộ toàn bộ hệ thống

### 5.1 Single source of truth: Hermes Orchestrator

Thay vì nhiều nơi quyết định độc lập:
```
TRƯỚC (rối rắm):
  Poller tự quyết định job nào → claim
  Handler tự quyết định skip/continue
  User tự quyết định nick nào làm gì
  Không ai biết group nào pending bao lâu

SAU (Hermes làm trung tâm):
  Hermes orchestrate() mỗi 15 phút
    → Assign jobs cho nick idle
    → Skip/recheck groups tự động
    → Điều chỉnh frequency theo performance
    → Alert user khi cần can thiệp thủ công
  Agent chỉ nhận job → thực thi → report kết quả
  User chỉ cần: sửa cookie khi có alert + duyệt recommendations
```

### 5.2 Hermes Decision Log

Mọi quyết định của Hermes đều được ghi lại:
```sql
CREATE TABLE IF NOT EXISTS hermes_decisions (
  id SERIAL PRIMARY KEY,
  campaign_id UUID,
  decision_type TEXT,  -- 'orchestration' | 'group_eval' | 'job_assign' | 'skip_group'
  context_summary TEXT,  -- tóm tắt input
  decision JSONB,  -- full output từ Hermes
  auto_applied BOOLEAN,
  applied_at TIMESTAMPTZ,
  outcome TEXT,  -- 'success' | 'failed' | 'pending' (cập nhật sau)
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Frontend: Tab "Quyết định của Hermes" trong /hermes page
```
22:15  assign_job      Diệu Hiền → campaign_nurture     ✓ auto-applied
22:00  skip_group      Dev Vietnam (pending 8d)          ✓ auto-applied  
21:45  recheck_group   VPS Server (pending 4d)           ✓ auto-applied
21:30  alert_user      Do Hoang Nam checkpoint           ⏳ chờ user
21:15  increase_freq   Việt Nguyễn (score 4.2, idle)    ✓ auto-applied
```

---

## THỨ TỰ THỰC HIỆN

1. **Hermes skill `orchestrator`** — tạo file + test response format
2. **`build_orchestration_context()`** — fetch đủ data từ DB
3. **`executeAction()`** — implement 5 action types
4. **Cron 15 phút** — wire orchestrator vào scheduler
5. **Group intelligence** — pending timeout + recheck flow
6. **Interaction context** — pass full context khi gen comment
7. **Reporter skill + /reports Hermes tab**
8. **hermes_decisions table + UI log**

## VERIFY

```bash
# 1. Manual trigger orchestration
curl -X POST https://103-142-24-60.sslip.io/campaigns/aded1474-.../orchestrate \
  -H "Authorization: Bearer $TOKEN"
# → Nhận JSON với actions, health_score, issues

# 2. Check Diệu Hiền tự được assign job (idle >30min)
# → Trong vòng 15 phút kế tiếp, /agents hiện Diệu Hiền có job

# 3. Check groups pending >7 ngày tự bị skip
# → fb_groups.join_status = 'skipped' sau orchestration

# 4. /hermes page → tab "Quyết định" → thấy log decisions
```
