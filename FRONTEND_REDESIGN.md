# FRONTEND REDESIGN — Đồng nhất toàn bộ UI

## Vấn đề cốt lõi
Hiện tại có 2 design system song song:
- **Hermes dark** (CampaignHub, AgentsRoster): dùng CSS vars, bg-app-*, text-hermes
- **Legacy light** (Settings, Auth, Groups, Content): bg-white, bg-gray-*, text-gray-700

User cảm giác dùng 2 app khác nhau. Cần thống nhất 100% về dark theme Hermes.

---

## BƯỚC 1 — Xóa legacy, không giữ lại

```bash
# Xóa hoàn toàn các files/routes legacy
# /dashboard-legacy → Dashboard.jsx
# /campaigns-legacy → CampaignList.jsx  
# /campaigns/old → CampaignManager.jsx
# /campaigns/:id/legacy → CampaignDetail.jsx
# /monitor-legacy → Monitor.jsx

# Trong App.jsx: xóa các routes này
# Redirect /dashboard-legacy → /dashboard
# Redirect /campaigns-legacy → /campaigns
```

---

## BƯỚC 2 — Design tokens chuẩn hóa

```css
/* globals.css — đảm bảo các vars này được dùng nhất quán */
:root {
  --bg-base:        #080808;
  --bg-surface:     #101010;
  --bg-elevated:    #181818;
  --bg-hover:       #202020;
  --border:         #242424;
  --border-bright:  #333333;
  --text-primary:   #e2e2e2;
  --text-muted:     #606060;
  --text-dim:       #303030;
  --hermes:         #00e87a;
  --hermes-dim:     #00e87a22;
  --warn:           #f97316;
  --danger:         #ef4444;
  --info:           #3b82f6;
  --font-mono:      'JetBrains Mono', monospace;
  --font-ui:        'IBM Plex Sans', sans-serif;
}
```

**Thêm vào tailwind.config.js:**
```js
colors: {
  'app-base':     'var(--bg-base)',
  'app-surface':  'var(--bg-surface)',
  'app-elevated': 'var(--bg-elevated)',
  'app-hover':    'var(--bg-hover)',
  'app-border':   'var(--border)',
  'hermes':       'var(--hermes)',
  'hermes-dim':   'var(--hermes-dim)',
  'danger':       'var(--danger)',
  'warn':         'var(--warn)',
  'info':         'var(--info)',
}
```

**Rule thay thế:**
```
bg-white        → bg-app-surface
bg-gray-50      → bg-app-base
bg-gray-100     → bg-app-elevated
bg-gray-800/900 → bg-app-base
text-gray-700   → text-app-primary (var --text-primary)
text-gray-500   → text-app-muted
border-gray-200 → border-app-border
bg-blue-500     → bg-info
bg-green-*      → bg-hermes (nếu là success/active)
bg-purple-*     → bg-hermes-dim (nếu là Hermes-related)
rounded-xl/2xl  → rounded (max 4px)
```

---

## BƯỚC 3 — Pages cần redesign theo dark theme

### 3.1 Auth pages (/login, /register)
```
Layout: centered, full-screen dark bg-app-base
Card: bg-app-surface, border border-app-border, max-w-sm
Input: bg-app-elevated, border border-app-border, text-primary
  focus: border-hermes outline-none
Button primary: bg-hermes text-black font-semibold
  hover: opacity-90
Logo: "SF" monospace, màu hermes
Không dùng: bg-white, shadow, rounded-xl
```

### 3.2 Settings (/settings, /settings/admin)

Giữ layout hiện tại (tabs bên trái) nhưng dark hóa:
```
Container: bg-app-base
Sidebar tabs: bg-app-surface, active tab: border-l-2 border-hermes text-hermes
Content area: bg-app-elevated
Form inputs: bg-app-surface, border-app-border
Labels: text-muted font-mono text-xs uppercase
Section headers: text-primary font-mono
Buttons: save=bg-hermes text-black, cancel=bg-app-hover text-muted
Danger zone: border border-danger/30 bg-danger/5
```

### 3.3 /hermes/settings — Redesign hoàn toàn

**Layout 2 cột:**
```
┌─────────────┬──────────────────────────────────────┐
│ MENU (30%)  │  CONTENT (70%)                       │
│             │                                      │
│ ● Model     │  [section content]                   │
│   Skills    │                                      │
│   Memory    │                                      │
│   Quality   │                                      │
│   Fallback  │                                      │
│   SOUL      │  ← MỚI                               │
│   Decisions │  ← MỚI                               │
│   Learning  │  ← MỚI                               │
│   Reports   │  ← MỚI                               │
└─────────────┴──────────────────────────────────────┘
```

**Menu item style:**
```jsx
// Active
<div className="border-l-2 border-hermes text-hermes bg-hermes-dim px-4 py-2 font-mono text-sm">
// Inactive  
<div className="border-l-2 border-transparent text-muted px-4 py-2 font-mono text-sm hover:text-primary">
```

**Sections cần thêm mới:**

**SOUL — Edit personality Hermes:**
```
Textarea full: edit ~/.hermes/SOUL.md
[GET /ai-hermes/soul] → load
[PUT /ai-hermes/soul] → save + hot-reload
Placeholder: "Bạn là Hermes, AI marketing assistant..."
Save button: [Lưu SOUL] → toast "SOUL đã cập nhật"
```

**DECISIONS — Tổng hợp quyết định:**
```
Table: tất cả hermes_decisions (không filter theo campaign)
Columns: Thời gian | Campaign | Loại | Target | Status | Actions
Filter: All / pending / auto_applied / failed
Row click → link đến campaign Hermes tab
```

**LEARNING LOG — Nhật ký học:**
```
[GET /ai-hermes/learning-log]
Timeline feed:
  23:00 hôm qua  🧠 Tự cải thiện skill comment_gen
                 "Score trung bình 3.1 → đã rewrite prompt"
  22:45          ✓ Xóa 3 examples chất lượng thấp (score < 3)
  Hôm kia        🧠 Soften quality gate (rejection rate 45%)
[Trigger manual: Run Daily Review Now] → POST /ai-hermes/daily-review
```

**REPORTS:**
```
Dropdown: chọn campaign
[Tạo báo cáo] → POST /ai-hermes/report/:campaign_id → loading ~10s
Hiển thị kết quả: executive_summary, highlights, issues, recommendations
[Export PDF] [Copy text]
```

### 3.4 /hermes (HermesBrain) — Thêm tab Learning

Hiện có: Overview, Skills, Feedback
Thêm tab: **Learning** → render learning-log timeline

### 3.5 Pages cần dark hóa nhưng KHÔNG redesign layout:
```
/groups (GroupList)
/pages (PageList)  
/monitor (SignalWall)
/content (ContentList)
/content/new (ContentComposer)
/publish (UnifiedPublish)
/media (MediaLibrary)
/analytics (Analytics)
/data-center (DataCenter)
/trends (TrendCenter)
/nick-nurture (NickNurture)
/settings/websites (WebsiteSettings)
```

Với mỗi page: chỉ thay màu, giữ layout:
- bg-white → bg-app-surface
- bg-gray-* → bg-app-* tương ứng  
- text-gray-* → text-primary/muted
- border-gray-* → border-app-border
- rounded-xl → rounded
- Input fields: bg-app-elevated border-app-border

### 3.6 Components cần đồng nhất

**Modal/Dialog:**
```
bg-app-surface border border-app-border
Header: font-mono text-sm text-muted uppercase
Không có: shadow-xl, bg-white, rounded-2xl
```

**Table:**
```
thead: bg-app-base text-muted font-mono text-xs uppercase
tbody tr: border-b border-app-border hover:bg-app-hover
td: text-primary py-3 px-4
```

**Input/Select:**
```
bg-app-elevated border border-app-border text-primary
focus: border-hermes ring-0 outline-none
placeholder: text-dim
```

**Badge/Pill:**
```
Status active:   bg-hermes/10 text-hermes
Status paused:   bg-warn/10 text-warn
Status error:    bg-danger/10 text-danger
Status unknown:  bg-app-elevated text-muted
```

**Button:**
```
Primary:   bg-hermes text-black font-semibold hover:opacity-90
Secondary: bg-app-elevated text-primary border border-app-border
Danger:    bg-danger/10 text-danger border border-danger/30
Ghost:     text-muted hover:text-primary
```

---

## BƯỚC 4 — Skill CRUD đầy đủ

Mount SkillsEditor.jsx vào route `/hermes/skills`
Thêm vào SideNav dưới Hermes Brain icon

Hoặc nhúng vào /hermes/settings Skills section với:
- [+ Tạo skill] → modal: task_type + content textarea
- [Xóa] per skill với confirm  
- [Import JSON] / [Export JSON]
- Avg score badge bên cạnh tên

---

## BƯỚC 5 — Navigation cleanup

**SideNav** — review lại icons:
```
⬡  /dashboard       Dashboard
👥 /agents          Agent Roster  
🎯 /campaigns       Mission Board
📡 /monitor         Signal Wall
📨 /inbox           Inbox (nếu có)
📁 /content         Content
🧠 /hermes          Hermes Brain
⚙️  /settings        Settings
```

Xóa khỏi nav: mọi legacy routes
Thêm breadcrumb trong Campaign Hub (Mission > Openclaw VPS > Hermes)

---

## THỨ TỰ THỰC HIỆN

1. Xóa 5 legacy routes + files
2. Cập nhật tailwind.config.js tokens
3. globals.css đảm bảo vars đúng
4. Dark hóa Auth pages (Login/Register)
5. Dark hóa Settings pages
6. Redesign /hermes/settings (thêm 4 sections mới)
7. Thêm tab Learning vào HermesBrain
8. Dark hóa 12 pages còn lại (chỉ đổi màu)
9. Đồng nhất components (Modal, Table, Input, Badge, Button)
10. Mount SkillsEditor + cleanup SideNav

## VERIFY

```bash
# Sau khi build:
npm run build  # không có warning về unused vars

# Check không còn bg-white trong new pages:
grep -rn "bg-white\|bg-gray-50\|text-gray-700" \
  src/pages/ --include="*.jsx" | wc -l
# → Phải = 0 (hoặc chỉ còn trong legacy files đã xóa)

# Check tất cả pages load không lỗi:
# /login /dashboard /agents /campaigns /hermes /hermes/settings /settings
```
