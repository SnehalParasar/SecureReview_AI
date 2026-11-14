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

### Day 2 (Fri 14 Nov)
- **GitHub App authentication (`server/github.js`):**
  - Created `server/github.js` using the `App` class from `octokit`.
  - Reads `GITHUB_APP_ID` and the private key from `GITHUB_PRIVATE_KEY_PATH` at startup.
  - Exports `getInstallationClient(installationId)` which calls `app.getInstallationOctokit(installationId)` and returns an installation-scoped authenticated Octokit.
- **Webhook handler updated (`server/index.js`):**
  - Imports `getInstallationClient` from `./github.js`.
  - `pull_request` handler now reads `payload.installation.id`, calls `getInstallationClient`, and logs `authenticated as installation <id>`.
  - Does NOT use `GITHUB_INSTALLATION_ID` from `.env`; installation ID is read exclusively from the webhook payload.

**Next:**
- Day 2 (cont.): Fetch PR diff/files using the installation client, post a placeholder comment.

### Day 2 cont. — PR diff fetching (`server/diff.js`)
- **`server/diff.js`** — `fetchPrFiles(octokit, owner, repo, pullNumber)`:
  - Uses `octokit.paginate` with `pulls.listFiles` (100 per page) for full pagination.
  - Strips files with no `patch` (binary / too-large diffs) and logs each skip.
  - Returns `[{ filename, status, patch, additions, deletions }]`.
- **`server/index.js`** updated:
  - Now assigns the returned octokit from `getInstallationClient`.
  - Calls `fetchPrFiles` with owner/repo split from `payload.repository.full_name`.
  - Logs each patchable file: `filename  status=…  +N/-N  patch_length=N`.

**Next:**
- Post confirmed findings as inline PR review comments.

### Day 2 cont. — Placeholder PR comment (`server/comment.js`)
- **`server/comment.js`** — `postPlaceholderComment(octokit, owner, repo, prNumber, fileCount)`:
  - Calls `octokit.rest.issues.createComment` (PRs share the Issues API number space).
  - Posts exact specified text: `"SecureReview AI received this PR and found N changed files."`
  - Returns the `html_url` of the created comment.
- **Bot loop prevention & synchronize deduplication (`server/index.js`):**
  - Ignores events where `payload.sender?.type === 'Bot'` or login contains `[bot]`, preventing cycles from bot actions or comments.
  - On `synchronize`, checks `payload.before !== payload.after` and validates against a head-SHA cache (`lastCommentedSha`), posting a new comment only when the PR code is updated with new commits.
  - Logs the resulting comment URL upon success.

**Next:**
- Stage 1: rule-based secret/SQL/JWT/eval scanner over the fetched patches.

**Known issues:**
- `.env.example` is missing some environment variables that appear in `.env` (`GITHUB_INSTALLATION_ID`, `MONGODB_URI`, `GEMINI_API_KEY`, `REDIS_URL`).
- `server/index.js` only logs PR events to stdout; BullMQ queue integration and worker pipeline processing are not yet wired up.
- `server/index.js` immediately starts listening on `PORT` when imported via `app.listen()`, rather than exporting `app` separately from server bootstrap.