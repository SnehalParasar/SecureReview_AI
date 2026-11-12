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
(Update after each day: what works, what is next, known issues)