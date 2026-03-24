# SocialFlow - Platform Documentation

## Tong quan

SocialFlow la nen tang tu dong hoa mang xa hoi Facebook. Quan ly nhieu tai khoan, tao noi dung bang AI, len lich dang bai, theo doi tuong tac va quan ly hop thu.

## Kien truc

| Thanh phan | Stack | Deploy |
|-----------|-------|--------|
| Frontend | React 19 + Vite 6 + Tailwind 4 | Vercel |
| API | Fastify 5.2.1 | Railway |
| Agent | Node.js + Playwright | Local/VPS |
| Database | Supabase PostgreSQL | Cloud |
| Cache | Upstash Redis | Cloud |
| Storage | Cloudflare R2 | Cloud |
| AI | DeepSeek, OpenAI, Gemini, Anthropic, Groq, Kimi, MiniMax, Fal.ai | Multi-provider |

## Tinh nang chinh

### 1. Quan ly tai khoan Facebook
- Them/sua/xoa tai khoan (nick) bang cookie
- Kiem tra suc khoe tai khoan (healthy/checkpoint/expired/disabled)
- Ho tro proxy HTTP/SOCKS5 cho moi nick
- Browser fingerprinting (user-agent, viewport, timezone)
- Gioi han bai dang/ngay, gio hoat dong, ngay hoat dong
- Cap nhat cookie khi het han
- **Data isolation**: Moi user chi thay tai khoan cua minh, admin cung khong thay cookie user khac

### 2. Quan ly Fanpage
- Tu dong fetch fanpages tu tai khoan
- Ho tro Graph API access token (dang bai truc tiep, khong can browser)
- Posting method: Auto / Access Token / Cookie
- Loc fanpage theo nick
- Inbox fanpage (load tin nhan, tra loi)

### 3. Quan ly Nhom
- Tu dong fetch nhom da tham gia
- Them nhom bang URL/ID (don le hoac hang loat)
- Tu dong lay ten nhom (resolve)
- Loc nhom theo nick
- Tham gia nhom moi tu ket qua scan

### 4. Tao noi dung & AI
- **Tao caption**: Nhieu style (casual, professional, viral, educational, story, promotional)
- **Tao hashtag**: Tu dong dua tren noi dung
- **Tao hinh anh**: Fal.ai (Flux Schnell, Ideogram, Recraft)
- **Spin noi dung**: Basic spintax `{option1|option2}` hoac AI spinning
- **Multi-provider AI**: DeepSeek (mac dinh), fallback OpenAI → Gemini
- **User-level override**: Moi user co the cau hinh AI provider rieng
- **Niche selection**: Chon nganh de AI hieu context

### 5. Dang bai
- **Quick Post**: Dang nhanh len nhieu target (page/group/profile)
- **Graph API direct**: Page co token → dang truc tiep, khong can browser
- **Browser automation**: Group/Profile → agent dung Playwright
- **Staggered posting**: Delay 1-4 phut giua cac target (chong spam)
- **Media modes**: Chon anh/video cu the, random tu thu vien, hoac khong media
- **Daily limits**: Gioi han so bai/ngay, tu dong reset

### 6. Chien dich (Campaigns)
- Tao chien dich voi nhieu target (pages, groups, profiles)
- Xoay noi dung: sequential hoac random
- Lich dang: 1 lan, recurring (cron), hoac interval (moi N phut)
- Delay giua cac target (chong phat hien)
- Lich chien dich (Calendar view)
- Tu dong chay theo lich

### 7. Theo doi (Monitoring)
- **Nguon tin**: Them page/group/URL de theo doi
- **Fetch tu dong**: Dat interval (15p, 30p, 1h, 2h, 4h, 8h)
- **Dedup fetch**: Neu ai do da fetch trong 30p → skip
- **Chia se du lieu**: Bai viet shared giua users cung theo doi 1 nhom
- **Bookmark per-user**: Moi user luu bai rieng (user_saved_posts table)
- **Wall tab**: Hien bai trong 24h
- **Bai viet tab**: Hien tat ca, nhom theo source
- **Tim kiem**: Full-text search trong bai

### 8. Comment & Reply AI
- Chon bai → AI generate comment (phong cach social, ngan gon)
- Agent navigate den bai, tim comment box, nhap va gui
- Ho tro mobile FB de tranh loi DOM phuc tap
- Retry logic khi gap loi tam thoi
- Luu trang thai: pending → done/failed/dismissed
- Cho phep dang lai bai da huy
- Comment log per-user

### 9. Hop thu (Inbox)
- **Fanpage inbox**:
  - Co access token → Graph API (khong gioi han)
  - Khong co token → Cookie GraphQL (6h/lan)
  - Load tat ca tin nhan cu + moi
- **Messenger ca nhan**:
  - Cookie-based (6h/lan)
  - Load tin nhan tu Messenger
  - Tra loi truc tiep
- **Loc theo nick**: Dropdown chon nick → hien pages cua nick do
- **Giao dien**: Page list doc, nhom theo account

### 10. Scan & Nghien cuu
- **Scan keyword**: Tim bai trong nhom theo tu khoa
- **Scan group feed**: Theo doi feed nhom theo topics
- **Discover groups**: Tim nhom moi theo tu khoa
- **Research**: Scrape Facebook page/group/profile qua Apify
- **Web research**: Scrape noi dung website

### 11. Xu huong (Trends)
- Lay trending tu YouTube, Reddit, RSS feeds
- Focus Viet Nam
- Cache 24h, auto-refresh
- Score theo view count, upvotes, mentions

### 12. Thu vien media
- Upload anh/video len R2
- Download video tu TikTok, YouTube, Douyin
- Xu ly video: watermark, intro, nhac nen, phu de, nen
- FFmpeg processing qua agent

### 13. Thong ke (Analytics)
- **Admin**: So lieu toan he thong (tat ca accounts, tat ca users)
- **User**: Chi thay data cua minh
- Dashboard: total accounts, posts today, pending jobs, unread inbox
- Bieu do hoat dong 7 ngay
- Lich su dang bai voi filter

### 14. Quan ly nguoi dung
- Roles: admin, editor, user
- Admin tao user, cap quyen
- Chia se tai khoan qua user_resource_access
- Data isolation toan dien

### 15. Agent (Browser Automation)
- **Playwright** voi Camoufox/Chromium
- **Session pool**: Tai su dung tab cho moi nick (tiet kiem memory)
- **Human simulation**: Typing speed, scroll, delay
- **Anti-detect**: Fingerprinting, proxy rotation
- **Job polling**: Poll Supabase moi 5s
- **Sequential processing**: 1 job/lan
- **Auto-update**: Check version tu GitHub, git pull + restart
- **Electron desktop app**: Splash screen, Start/Stop

### 16. Chrome Extension
- Ho tro dang nhap va lay cookie tu trinh duyet
- Inject vao Facebook pages
- Manifest V3

## API Endpoints

### Accounts `/accounts`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | / | Danh sach tai khoan |
| POST | / | Them tai khoan |
| GET | /:id | Chi tiet tai khoan |
| PUT | /:id | Cap nhat cau hinh |
| DELETE | /:id | Xoa tai khoan |
| POST | /:id/check-health | Kiem tra suc khoe |
| POST | /:id/update-cookie | Cap nhat cookie |
| POST | /:id/fetch-pages | Fetch fanpages |
| POST | /:id/fetch-groups | Fetch nhom |
| POST | /:id/fetch-all | Fetch tat ca |
| POST | /:id/quick-post | Dang bai nhanh |
| POST | /bulk-import | Import hang loat |
| GET | /:id/inbox | Tin nhan ca nhan |
| POST | /:id/fetch-inbox | Fetch Messenger |
| POST | /:id/reply-message | Tra loi tin nhan |

### Fanpages `/fanpages`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | / | Danh sach fanpages |
| POST | / | Them fanpage |
| GET | /:id | Chi tiet fanpage |
| PUT | /:id | Cap nhat |
| DELETE | /:id | Xoa |
| GET | /:id/inbox | Hop thu fanpage |
| POST | /:id/fetch-inbox | Fetch tin moi |
| POST | /:id/reply | Tra loi tin nhan |

### Groups `/groups`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | / | Danh sach nhom |
| POST | / | Them nhom |
| POST | /bulk-add | Them hang loat |
| PUT | /:id | Cap nhat |
| DELETE | /:id | Xoa |
| POST | /resolve | Lay thong tin nhom |

### Monitoring `/monitoring`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | /sources | Danh sach nguon |
| POST | /sources | Them nguon |
| PUT | /sources/:id | Cap nhat nguon |
| DELETE | /sources/:id | Xoa nguon |
| POST | /sources/:id/fetch-now | Fetch ngay |
| GET | /wall | Bai viet wall (24h) |
| GET | /saved | Tat ca bai da load |
| POST | /save-post | Luu bai vao DB |
| POST | /bookmark | Bookmark bai (per-user) |
| DELETE | /bookmark/:fb_post_id | Bo bookmark |
| PUT | /bookmark/:fb_post_id | Cap nhat note/tags |
| GET | /bookmarks | Danh sach da bookmark |
| GET | /bookmark-ids | IDs da bookmark |

### Content `/content`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | / | Danh sach noi dung |
| POST | / | Tao moi |
| GET | /:id | Chi tiet |
| PUT | /:id | Cap nhat |
| DELETE | /:id | Xoa |

### AI `/ai`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | /settings | Cau hinh AI (admin) |
| PUT | /settings | Cap nhat AI |
| POST | /test | Test provider |
| POST | /generate | Tao noi dung AI |

### Analytics `/analytics`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | /dashboard | Dashboard (admin: global, user: own) |
| GET | /accounts | Hieu suat tai khoan |
| GET | /history | Lich su dang bai |
| GET | /activity | Nhat ky hoat dong |

### Jobs `/jobs`
| Method | Path | Mo ta |
|--------|------|-------|
| GET | / | Danh sach jobs |
| GET | /:id | Chi tiet job |
| POST | /:id/cancel | Huy job |

## Database Tables

| Table | RLS | Mo ta |
|-------|-----|-------|
| profiles | Yes | User roles & settings |
| accounts | Yes | Facebook nicks |
| proxies | No | HTTP/SOCKS5 proxies |
| fanpages | No | Facebook pages |
| fb_groups | No | Facebook groups |
| contents | No | Post compositions |
| media | No | Media library |
| jobs | Yes | Job queue |
| publish_history | No | Posting records |
| campaigns | No | Scheduled campaigns |
| inbox_messages | Yes | Page & personal messages |
| monitored_sources | Yes | Monitoring configs (per-user) |
| monitored_posts | Yes | Fetched posts (shared) |
| user_saved_posts | Yes | Bookmarks (per-user) |
| comment_logs | Yes | Comment tracking (per-user) |
| scan_keywords | Yes | Keyword scan configs |
| discovered_posts | Yes | Posts from scans |
| discovered_groups | Yes | Groups from scans |
| trends_cache | No | Trending keywords |
| ai_settings | No | System AI config |
| user_settings | Yes | User overrides |
| user_resource_access | Yes | Shared access |
| agent_heartbeats | Yes | Agent online status |
| research_results | No | Scrape results |
| websites | Yes | Website analytics |
| system_settings | Yes | Global settings |
| activity_log | No | Audit log |

## Agent Job Types

| Type | Handler | Mo ta |
|------|---------|-------|
| post_page | post-page.js | Dang bai len page (cookie) |
| post_page_graph | post-page-graph.js | Dang bai len page (Graph API) |
| post_group | post-group.js | Dang bai len nhom |
| post_profile | post-profile.js | Dang bai len profile |
| comment_post | comment-post.js | Comment bai viet |
| check_health | check-health.js | Kiem tra tai khoan |
| fetch_pages | fetch-pages.js | Fetch fanpages |
| fetch_groups | fetch-groups.js | Fetch nhom |
| fetch_all | fetch-all.js | Fetch tat ca |
| fetch_source_cookie | fetch-source-cookie.js | Fetch monitoring source |
| process_video | process-video.js | Download/xu ly video |
| scan_group_keyword | scan-group-keyword.js | Scan keyword trong nhom |
| scan_group_feed | scan-group-feed.js | Scan feed nhom |
| discover_groups_keyword | discover-groups-keyword.js | Tim nhom moi |
| resolve_group | resolve-group.js | Lay thong tin nhom |
| join_group | join-group.js | Tham gia nhom |
| check_engagement | check-engagement.js | Theo doi tuong tac |

## Security & Data Isolation

- **Admin khong thay cookie user khac**: `canAccess` va `getAccessibleIds` khong bypass cho admin
- **Per-user data**: Accounts, sources, bookmarks, comments deu filter theo owner_id
- **Shared data**: Monitored posts shared (keyed by fb_post_id), nhung user chi thay bai tu nhom ho theo doi
- **RLS**: Supabase Row Level Security tren cac bang nhay cam
- **JWT auth**: Supabase JWT verification tren moi request
