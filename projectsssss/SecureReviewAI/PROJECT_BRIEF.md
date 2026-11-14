# SecureReview AI: Project Brief

## What it is
A GitHub App that reviews pull requests for security vulnerabilities. On each PR it
detects issues, grounds them in OWASP/CWE knowledge (RAG), verifies whether each
issue is truly exploitable (agent), then posts inline comments on the PR.

## Pipeline
PR opened -> GitHub webhook -> Express server -> BullMQ queue (Redis)
-> worker fetches diff (Octokit)
-> Stage 1: rule-based scan (secrets, SQL injection, weak JWT, eval)
-> Stage 2: Gemini detector via LangChain.js, structured output (Zod),
   with RAG context retrieved from OWASP/CWE docs (MongoDB Atlas Vector Search)
-> Stage 3: LangGraph.js verification agent with tools
   (read more of file, trace variable origin, check sanitizers)
   -> verdict: confirmed / dismissed / uncertain
-> post confirmed findings as inline PR comments with CWE citation
-> store scans and findings in MongoDB
-> evaluation script compares: rules only, LLM only, +RAG, +verification

## Tech stack (do not add other libraries without asking)
- Node.js 20+, Express, ES modules
- Octokit (GitHub App auth, webhooks), smee.io for local webhook tunnel
- LangChain.js + LangGraph.js, Google Gemini (free tier, model names in .env)
- Zod for all LLM structured outputs
- MongoDB Atlas (data + vector search), Redis + BullMQ
- React + Vite for a minimal dashboard (late stage)

## Constraints
- Gemini free tier: throttle requests, cache results, exponential backoff on 429
- Never log secrets. All keys in .env, .env is gitignored
- Verify GitHub webhook signatures on every request
- Only scan repos the app is installed on; treat PR code as untrusted input
  (prompt injection in code comments must not change reviewer behavior)
- Small commits, one feature per commit

## Folder structure
/server    Express app, webhook routes, GitHub client
/worker    queue processors, pipeline stages
/rag       ingestion + retrieval
/agents    verification agent
/eval      labeled samples + evaluation scripts
/dashboard React app (later)

## Progress log

### Day 1 (Thu 12 Nov)
- **Project skeleton and folder structure:**
  - Initialized Node.js ES module project (`package.json`).
  - Created directory layout per brief: `server/`, `worker/` (`.gitkeep`), `rag/` (`.gitkeep`), `agents/` (`.gitkeep`), `eval/` (`.gitkeep`), and `dashboard/` (`.gitkeep`).
- **Express server and /health route:**
  - `server/index.js`: Express server configured on `PORT` (defaults to 3000), providing `GET /health` which returns `{ status: 'ok' }`.
- **POST /webhook route with signature verification:**
  - `server/index.js`: Added `POST /webhook` route using `@octokit/webhooks`. Uses `express.raw({ type: '*/*' })` to preserve the raw request body Buffer for HMAC verification. Validates `x-hub-signature-256` against `GITHUB_WEBHOOK_SECRET`, rejecting invalid or missing signatures with HTTP 401. Handles `pull_request` event for actions `opened`, `synchronize`, and `reopened`, logging repository name, PR number, and action to the console.
- **smee-client forwarding script:**
  - `server/smee.js`: Created forwarding script using `smee-client` to forward webhooks from `WEBHOOK_PROXY_URL` to `http://localhost:PORT/webhook`.
  - Configured npm scripts: `npm run smee` (and alias `npm run webhook:proxy`).
- **.env.example variables and .gitignore entries:**
  - `.env.example`: Contains placeholders for `PORT`, `WEBHOOK_PROXY_URL`, `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_PRIVATE_KEY_PATH`.
  - `.gitignore`: Configured to ignore `node_modules/`, environment files (`.env`, `.env.local`, `*.env`), private key files (`*.pem`, protecting `github-app-private-key.pem`), build/log artifacts (`logs/`, `*.log`, `dist/`, `build/`), and OS files (`.DS_Store`, `Thumbs.db`).

### Day 2 (Fri 13 - Sat 14 Nov)
- **GitHub App authentication (`server/github.js`):**
  - Implemented `server/github.js` using the Octokit `App` class initialized with `GITHUB_APP_ID` and private key read from `GITHUB_PRIVATE_KEY_PATH`.
  - Exports `getInstallationClient(installationId)` returning an authenticated installation-scoped Octokit client.
  - Updated `server/index.js` to read `payload.installation.id` dynamically from the webhook payload (never from `.env`) and authenticate per-installation.
- **PR diff fetching with pagination (`server/diff.js`):**
  - Implemented `server/diff.js` exporting `fetchPrFiles(octokit, owner, repo, pullNumber)`.
  - Uses `octokit.paginate` with `octokit.rest.pulls.listFiles` (`per_page: 100`) to retrieve all changed files across pages without truncating large PRs.
  - Skips files without a `patch` (binaries, diffs exceeding GitHub's size limits) and logs skipped files.
  - Returns array of `{ filename, status, patch, additions, deletions }`.
  - Verified on a 37-file PR; handles renamed, removed, modified, and added statuses.
- **Placeholder PR comment (`server/comment.js`):**
  - Implemented `server/comment.js` exporting `postPlaceholderComment(octokit, owner, repo, prNumber, fileCount)`.
  - Calls `octokit.rest.issues.createComment` to post top-level comment: `"SecureReview AI received this PR and found N changed files."`.
  - Returns `html_url` of the comment.
- **Webhook event handling & guards (`server/index.js`):**
  - Subscribes to `pull_request` events (`opened`, `synchronize`, `reopened`).
  - Guards against bot comment infinite loops by skipping events where `payload.sender?.type === 'Bot'` or login contains `[bot]`.
  - Deduplicates on `synchronize` by verifying `payload.before !== payload.after` and validating against an in-memory head-SHA cache (`lastCommentedSha`).
- **Testing on test repo:**
  - Tested against `SnehalParasar/SecureReview_Test_REPO` PRs (including a 4-file PR, a 37-file PR, and across renamed/removed/modified/added file statuses).

**Next (Day 3):**
- File filtering (skip lockfiles, minified files, binaries, removed files, patches above a size limit), then the rule-based scanner.

**Known issues / TODO:**
- Bot posts a new comment on every event; needs update-in-place or dedup.
- .env.example missing MONGODB_URI, GEMINI_API_KEY, REDIS_URL.
- app.listen() runs on import; split app.js and server start before adding tests.
- Webhook handler should log ignored actions.

## Test repo
`SnehalParasar/SecureReview_Test_REPO`, with branches:
- `pr-mixed-vulns`
- `pr-clean-refactor`
- `pr-tricky-safe`
- `pr-tricky-vulnerable`
- `pr-prompt-injection`
- `pr-large-diff`
- `pr-rename-delete` (base: `rename-base`)
- `pr-non-code`
- `pr-sync-test`

`eval-manifest/expected.json` there is the ground truth for evaluation.

## Rules for all prompts
- Never hardcode file names, repo names, line numbers, test strings, keys or model names from the test repo; write general patterns only.
- Models and keys come from .env.
- Evaluate on a held-out set as well as the test repo, to avoid inflated numbers.
- Keep Gemini free-tier usage low: skip big files, cache, back off on 429.