# AGENTS.md - AI Agent Instructions for Docs Repository

> This file provides guidance for AI coding agents operating in this repository.

---

## Repository Overview

A mixed repository containing:
- **personal-kb/**: Personal knowledge base (Markdown)
- **p4-plan-converter/**: Node.js Gantt chart converter
- **social-posting/**: 글 작성/검수/배포 도구 (Hashnode, Threads 등)
- **n8n-workflows/**: n8n automation workflows with Claude Code integration
- **claude_tutor/**: C# wrapper for Claude CLI

---

## Build/Run Commands

### p4-plan-converter (Node.js)

```bash
# Install dependencies
cd p4-plan-converter
npm install

# Run converter (XML → HTML)
node p4-to-html-converter.js

# Run local server (port 8080)
node server.js

# Fetch Jira data
node fetch-jira.js

# PM2 service management
pm2 start server.js --name "gantt-chart"
pm2 stop gantt-chart
pm2 restart gantt-chart
```

### social-posting (Node.js)

```bash
cd social-posting

# Hashnode blog CLI
node hashnode.js me                           # Show blog info + publication ID
node hashnode.js list                         # List recent posts
node hashnode.js publish <file.md>            # Publish post
node hashnode.js draft <file.md>              # Create draft
node hashnode.js publish <file.md> --tags a,b # With tags
```

### n8n-workflows (Node.js)

```bash
cd n8n-workflows

# Test Claude Code wrapper
node claude-code-wrapper.js --theme "AI trends" --debug

# Run full test suite
node test-wrapper.js

# Import workflow to n8n
n8n import:workflow --input=theme-to-threads-wrapper.json

# Start n8n (if not running)
n8n start
```

### claude_tutor (C#)

```powershell
# Build executable
Add-Type -TypeDefinition (Get-Content claude-tutor.cs -Raw) -OutputAssembly claude-tutor.exe
```

### No tests defined
This repository currently has no test suite.

---

## Code Style Guidelines

### JavaScript (Node.js)

**Imports:**
```javascript
// Use CommonJS require (not ES modules)
const fs = require('fs');
const path = require('path');
const https = require('https');
```

**Formatting:**
- 4-space indentation
- Single quotes for strings
- Semicolons required
- Opening braces on same line

**Naming:**
```javascript
// camelCase for variables and functions
const fileName = 'example.txt';
function fetchAllIssues() {}

// UPPER_SNAKE_CASE for constants
const PORT = 8080;
const MIME_TYPES = { ... };
```

**Error Handling:**
```javascript
// Use try/catch with descriptive error messages
try {
    const data = JSON.parse(response);
} catch (e) {
    console.error(`Failed to parse JSON: ${e.message}`);
    process.exit(1);
}

// Use emojis for status logging
console.log(`✓ Successfully updated ${path}`);
console.error(`❌ Error: ${message}`);
console.warn(`⚠️  Warning: ${message}`);
```

**Async/Await:**
```javascript
// Prefer async/await over .then() chains
async function main() {
    const result = await fetchData();
    // ...
}
```

### C#

**Formatting:**
- Opening braces on same line for methods
- 4-space indentation
- Use `string.Format()` or string interpolation

**Error Handling:**
```csharp
try {
    // operation
} catch (Exception ex) {
    File.AppendAllText(logPath, $"[{DateTime.Now}] Error: {ex}\n");
    Environment.Exit(1);
}
```

### Markdown

**Structure:**
- Use `#` headings (H1 for title, H2 for sections)
- Use tables for structured data
- Use code blocks with language hints
- Use `>` for quotes/callouts

---

## MCP Integration

### Available MCP Servers (from .mcp.json)

**Logseq:**
- API URL: `http://localhost:12315`
- Use for personal knowledge base operations

**Notion:**
- Use `@notionhq/notion-mcp-server`
- For personal archives

### Logseq-Specific Rules

**CRITICAL: Logseq is an outliner - every line MUST be a bullet point**

Logseq uses bullet blocks as the basic unit of content. All content must start with `-`.

```markdown
# ❌ Wrong (standard markdown)
# My Heading
This is a paragraph.
- [ ] Task item

# ✅ Correct (Logseq format)
- # My Heading
- This is a paragraph.
- TODO Task item
```

**Task Keywords (use instead of `[ ]`):**
- `TODO` - Task to do
- `DOING` - In progress
- `DONE` - Completed
- `LATER` - Deferred
- `NOW` - Immediate priority

**Nested Content:**
```markdown
- Parent block
	- Child block (use Tab to indent)
		- Grandchild block
	- Another child
- Back to parent level (Shift+Tab)
```

**Headings in Logseq:**
```markdown
- # Heading 1
- ## Heading 2
- ### Heading 3
```

**Tables in Logseq:**
```markdown
- | Header 1 | Header 2 |
  | -------- | -------- |
  | Cell 1   | Cell 2   |
```

**Links:**
```markdown
- [[Internal Page Link]]
- [External Link](https://example.com)
- ((block-uuid)) for block references
```

**Page Naming:**
- Always use **English titles** for Logseq page names
- Content inside pages can be in Korean, but the page title/name must be in English

**When creating content for Logseq:**
1. Every line starts with `-`
2. Use `TODO` not `[ ]`
3. Indent with Tab for nesting
4. Keep blocks atomic (one idea per block)
5. **Each heading (`#`, `##`, `###`) MUST be a separate block**
6. **Each numbered list item MUST be a separate block**
7. **Never combine multiple headings or sections in one block**

**API Block Insertion Rules:**
```
❌ WRONG: One block with multiple headings
insertBlock("## Section 1\n### Subsection\n- item 1\n- item 2")

✅ CORRECT: Each heading/item as separate block
insertBlock("## Section 1")
  insertBlock("### Subsection", {sibling: false})  // child
    insertBlock("item 1", {sibling: false})        // child
    insertBlock("item 2", {sibling: true})         // sibling
```

**API Usage Example:**
```bash
curl -s -X POST http://localhost:12315/api \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json; charset=utf-8" \
  -d '{"method": "logseq.Editor.createPage", "args": ["PageName"]}'
```

**Korean Content:**
- Write JSON to file first, then use `curl -d @file.json`
- Direct Korean in curl commands may cause encoding issues

---

## File Organization

```
Docs/
├── .claude/            # Claude command configs
├── social-posting/     # 글 작성/검수/배포 도구
│   ├── hashnode.js     # Hashnode GraphQL CLI
│   └── .env            # Hashnode API tokens
├── n8n-workflows/      # n8n automation workflows
│   ├── claude-code-wrapper.js         # Node.js wrapper for Claude CLI
│   ├── theme-to-threads-wrapper.json  # n8n workflow (recommended)
│   ├── test-wrapper.js                # Test suite
│   └── README.md                      # Setup guide
├── claude_tutor/       # C# wrapper project
├── p4-plan-converter/  # Node.js converter project
├── personal-kb/        # Personal knowledge base
│   ├── cheatsheet.md   # Quick reference (sync with Logseq)
│   ├── retrospective_2025.md
│   └── ...
├── .mcp.json           # MCP server configurations
└── .env                # Jira API tokens
```

---

## Environment Variables

Required `.env` file (Docs root) for p4-plan-converter:
```
JIRA_EMAIL=your-email@example.com
JIRA_API_TOKEN=your-api-token
JIRA_BASE_URL=https://your-domain.atlassian.net
```

Required `.env` file (`social-posting/.env`) for social-posting:
```
HASHNODE_API_TOKEN=your-hashnode-pat
HASHNODE_PUBLICATION_ID=your-publication-id
```

Hashnode token: https://hashnode.com/settings/developer

---

## Git Conventions

**Commit Messages:**
- Use conventional format: `type: description`
- Types: `feat`, `fix`, `docs`, `refactor`, `chore`
- Keep under 72 characters

**Do NOT commit:**
- `.env` files
- API tokens or credentials
- `node_modules/`
- Compiled executables (except claude-tutor.exe)

---

## Common Tasks

### Update Personal KB

1. Edit markdown files in `personal-kb/`
2. For Logseq sync, use API or copy content manually
3. Use `TODO` for task items (not `[ ]`)

### Publish Blog Post

See `social-posting/.claude/CLAUDE.md` for detailed instructions.

```bash
cd social-posting
node hashnode.js draft post.md      # 초안 저장
node hashnode.js publish post.md    # 즉시 발행
```

Blog: https://softdaddy.hashnode.dev

### Update Gantt Chart

1. Export P4 Plan XML to `p4-plan-converter/`
2. Run `node fetch-jira.js` to update Jira data
3. Run `node p4-to-html-converter.js`
4. View at `http://localhost:8080`

---

## Agent-Specific Notes

### When Working with Korean Content

- Logseq API has encoding issues with Korean in direct curl
- Write request body to JSON file first:
  ```javascript
  // Write to temp file
  fs.writeFileSync('request.json', JSON.stringify(body));
  // Then use: curl -d @request.json
  ```

### When Creating Checklists for Logseq

Always use Logseq TODO format:
```markdown
- ## Morning Routine
- TODO First task
- TODO Second task
- TODO Third task
```

**Converting standard markdown to Logseq:**
```markdown
# Standard Markdown        →    Logseq Format
─────────────────────────────────────────────
# Heading                  →    - # Heading
Some text                  →    - Some text
- [ ] Task                 →    - TODO Task
  - Nested item            →    	- Nested item
```

### When Editing retrospective_2025.md

- This is the main personal retrospective document
- Contains action plans, criteria, and processes
- Keep `cheatsheet.md` in sync for quick reference

---

## Document Sync Relationships

**Personal KB ↔ Logseq ↔ Notion 동기화 관계:**

| Local File | Logseq Page | Notion | 내용 |
|------------|-------------|--------|------|
| `personal-kb/cheatsheet.md` | `cheatsheet` | - | 기준/프로세스 치트시트 |
| `personal-kb/retrospective_2025.md` | `My Annual Retrospective 2025` | - | 2025년 회고 전체 (원본) |
| `personal-kb/retrospective_2025_summary.md` | - | [2025 회고 요약](https://www.notion.so/2025-2de96494df258168a9c3c863b78ab889) | 이슈→원인→해결책 요약 |
| `personal-kb/logseq_templates.md` | (템플릿 등록됨) | - | Logseq 템플릿 6개 |

**동기화 시 주의사항:**
- Logseq는 아웃라이너 → 모든 헤더/리스트 항목이 개별 블록
- 로컬 파일 수정 후 Logseq API로 동기화 필요
- 양방향 자동 동기화 아님 (수동 동기화)
- Notion API도 한글 인코딩 이슈 → JSON 파일로 저장 후 `curl -d @file.json` 사용

---

## Note Verification System

LogseqData 노트의 신뢰도를 분류하는 4단계 태그 시스템.

### Verification Tags

| Tag | 의미 | 사용 |
|-----|------|------|
| `verified` | 신뢰할 수 있는 출처에서 확인됨 | 인사이트 생성의 주요 근거로 사용 가능 |
| `unverified` | 아직 검증되지 않음 | 검증 대상. `/zk-verify`로 검증 필요 |
| `needs-evidence` | 웹검색했으나 근거 부족 | 보조 증거로만 사용. 단독 근거 금지 |
| `disputed` | 반증이 확인됨 | 인사이트 생성에 절대 사용 금지 |

### 관련 파일

| 파일 | 역할 |
|------|------|
| `zettelkasten/verification-tags.md` | 검증 태그 스키마 및 분류 기준 (정의 문서) |
| `personal-kb/note-verification-guide.md` | 사용자 가이드 |
| `zettelkasten/.claude/skills/zk-verify/SKILL.md` | 검증 스킬 정의 |
| `zettelkasten/.claude/commands/zk-verify.md` | 검증 커맨드 |
| `zettelkasten/.claude/agents/note-verifier-agent.md` | 검증 에이전트 |

### 검증 명령어

```bash
/zk-verify                    # 전체 노트 검증 (자동분류 + 웹검색)
/zk-verify --page "Page Name" # 특정 노트 검증
/zk-verify --auto-only        # 자동 분류만 (빠름)
/zk-verify --unverified        # unverified 노트 재검증
/zk-verify --status            # 검증 현황 통계
/zk-verify --dry-run           # 변경 없이 미리보기
```

### 인사이트 생성 시 검증 규칙

| Confidence | 허용 증거 |
|-----------|-----------|
| **High** | `verified` 노트만 (3개 이상) |
| **Medium** | `verified` 1개 이상 + `unverified` 혼합 가능 |
| **Exploratory** | 모든 상태 가능 (명시 필수) |

**절대 금지**: `disputed` 노트를 인사이트 증거로 사용

### "검증된 노트만 참조" 지시

아이디어 생성이나 분석 시 검증된 정보만 사용하려면:
> "verified 태그가 있는 노트만 참조해줘"

이렇게 지시하면 `verification:: verified` 프로퍼티가 있는 노트만 사용합니다.

---

## Social Scraper Conventions

### Timezone: 항상 KST (UTC+9) 기준

`social-scraper/` 내 모든 날짜/시간은 **KST 기준**으로 생성해야 한다.

**이유**: 크론잡이 오전 7-8시 KST에 실행될 때 `new Date().toISOString()`은 UTC 기준으로 전날 날짜를 반환한다. 이로 인해 리포트 파일이 전날 파일을 덮어쓰는 버그가 발생한다.

**파일명 생성 (`backup.js` 등):**
```javascript
// ❌ 잘못된 방법 (UTC — 오전 9시 이전엔 전날 날짜)
const today = new Date().toISOString().split('T')[0];

// ✅ 올바른 방법 (로컬 시스템 시간 = KST)
const _now = new Date();
const today = `${_now.getFullYear()}-${String(_now.getMonth()+1).padStart(2,'0')}-${String(_now.getDate()).padStart(2,'0')}`;
```

**`scrapedAt` 타임스탬프 (`lib/platforms/*.js`):**
```javascript
// ❌ 잘못된 방법
scrapedAt: new Date().toISOString()
// → "2026-02-18T23:00:00.000Z"  (KST 08:00인데 전날 날짜)

// ✅ 올바른 방법
scrapedAt: new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().replace('Z', '+09:00')
// → "2026-02-19T08:00:00.000+09:00"
```

`differ.js`의 `scrapedAt.split('T')[0]` 로직과 호환됨 — KST 기준 올바른 날짜 반환.

**적용 파일 목록** (2026-02-19 기준, 전부 수정 완료):

| 파일 | 수정 위치 |
|------|-----------|
| `lib/platforms/threads.js` | `scrapedAt` 1곳 |
| `lib/platforms/twitter.js` | `scrapedAt` 3곳 |
| `lib/platforms/youtube.js` | `scrapedAt` 1곳 |
| `lib/platforms/reddit.js` | `scrapedAt` 3곳 |
| `lib/platforms/newsletter.js` | `scrapedAt` 2곳 |
| `lib/platforms/arxiv.js` | `scrapedAt` 3곳 |

> **주의**: `publishedAt` (게시글 원본 날짜)은 UTC 그대로 유지. KST 변환 대상은 `scrapedAt`(스크랩 시각)과 파일명 날짜만 해당.

### Multi-Account Architecture

스크래퍼/포스팅이 **계정별 독립 파이프라인**으로 동작한다. `--account <name>` 플래그로 계정 선택 (기본: `softdaddy`).

**디렉토리 구조:**
```
social-scraper/
├── accounts.json                    # 계정 레지스트리 (default, accounts 목록)
├── accounts/
│   ├── softdaddy/                   # AI·생산성·1인창업 콘텐츠
│   │   ├── scrape-targets.json      # active/candidate/ignored
│   │   ├── reference-history.json
│   │   ├── output/                  # 스크랩 결과
│   │   └── history/                 # 일별 스냅샷
│   └── devideas/                    # Reddit 제품 아이디어 수집
│       ├── scrape-targets.json
│       └── ...
├── lib/
│   ├── account-paths.js             # 경로 해석기 (핵심 모듈)
│   ├── accounts.js                  # PLATFORMS export (lazy getter)
│   └── reference-tracker.js         # 상태 전환 (initAccount 필요)

social-posting/
├── accounts.json                    # 포스팅 계정 레지스트리
├── accounts/
│   ├── softdaddy/
│   │   ├── posting-log.jsonl
│   │   ├── learn-result.json
│   │   ├── threads-scheduled/
│   │   ├── threads-posted/
│   │   └── .threads-session/
│   └── devideas/
│       └── ...
└── lib/
    └── account-paths.js             # 포스팅 경로 해석기
```

**CLI 사용법:**
```bash
node backup.js --account softdaddy   # softdaddy 계정 스크랩
node backup.js --account devideas    # devideas 계정 스크랩
node find-sources.js --account devideas <url>  # 계정별 소스 발굴
node threads-api.js post file.md --account softdaddy  # 계정별 포스팅 (API)
```

### Scrape Target Management (scrape-targets.json)

스크랩 대상의 lifecycle을 `accounts/{accountName}/scrape-targets.json` 단일 파일로 관리한다.

**파일 구조:**

| 파일 | 역할 |
|------|------|
| `accounts/{accountName}/scrape-targets.json` | 단일 소스 — active, candidate, ignored |
| `accounts/{accountName}/reference-history.json` | append-only 디버깅 로그 |
| `lib/account-paths.js` | 계정별 경로 해석기 |
| `lib/accounts.js` | scrape-targets.json 읽는 thin wrapper (PLATFORMS export) |
| `lib/reference-tracker.js` | 상태 전환 로직 |

**상태 전환:**

| 전환 | 기준 | 트리거 |
|------|------|--------|
| → candidate | 외부 링크/검색 출처 발견 | 자동 |
| candidate → active | 14일 내 3회+ 발견 | 자동 (platform 필드 기준으로 해당 플랫폼으로) |
| active → candidate | 30일 내 lastPosted 없음 | 자동 (checkDemotions) |
| → ignored | 유저 결정 | 수동 |

**실행 시점:**
- 매일 07:00 KST (cron DailyStart): `backup.js --account <name>` → `trackReferences()` → 자동 카운팅/프로모트
- 수동: `/find-sources --account <name> <url>` → 특정 URL 스크랩 → candidate 추가
- `checkDemotions()`, `pruneOldReferences()`: 아직 자동 스케줄 없음

**CLI:**
```bash
node find-sources.js --account softdaddy <url>  # 소스 발굴 + candidate 추가
node find-sources.js --account softdaddy --candidates  # 후보 목록
node find-sources.js --promote <d>              # candidate → active
node find-sources.js --ignore <d>               # → ignored
```

> 상세 스펙: `.claude/skills/find-sources/SKILL.md` 참조
