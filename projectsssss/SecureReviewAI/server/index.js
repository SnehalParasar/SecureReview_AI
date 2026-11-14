// Step 1: Load environment variables first before importing modules that depend on them
import 'dotenv/config';

// Step 2: Import required dependencies
import express from 'express';
import { Webhooks } from '@octokit/webhooks';
import { getInstallationClient } from './github.js';
import { fetchPrFiles } from './diff.js';
import { postPlaceholderComment } from './comment.js';

// Step 3: Initialize Express application and define server port
const app = express();
const PORT = process.env.PORT || 3000;

// Step 4: Retrieve GitHub Webhook Secret from environment
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  console.warn('Warning: GITHUB_WEBHOOK_SECRET is not set in environment or .env file');
}

// Step 5: Initialize @octokit/webhooks instance with the secret
const webhooks = new Webhooks({
  secret: WEBHOOK_SECRET || '',
});

// Track last commented commit SHA per PR to ensure comments only post when code is updated
const lastCommentedSha = new Map();

// Step 6: Handle pull_request event for actions: opened, synchronize, and reopened
// Reads installation.id from the payload, authenticates as that installation,
// then logs repository name, PR number, action, and the authenticated installation.
webhooks.on(
  ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
  async ({ id, name, payload }) => {
    const repoName = payload.repository?.full_name || payload.repository?.name || 'unknown';
    const prNumber = payload.pull_request?.number;
    const action = payload.action;
    const installationId = payload.installation?.id;
    const headSha = payload.pull_request?.head?.sha;
    const prKey = `${repoName}#${prNumber}`;

    console.log(`Repository: ${repoName}, PR #${prNumber}, Action: ${action}`);

    // Step 6a: Avoid commenting on pull_request events triggered by bots (e.g. bot's own comments or actions)
    if (payload.sender?.type === 'Bot' || payload.sender?.login?.includes('[bot]')) {
      console.log(`[comment] Skipping event triggered by bot ${payload.sender?.login}`);
      return;
    }

    // Step 6b: On synchronize, only post a new comment if the PR was actually updated
    if (action === 'synchronize') {
      if (payload.before && payload.after && payload.before === payload.after) {
        console.log(`[comment] PR #${prNumber} synchronize event has identical before/after SHA — skipping comment`);
        return;
      }
      if (headSha && lastCommentedSha.get(prKey) === headSha) {
        console.log(`[comment] PR #${prNumber} synchronize event already processed for head SHA ${headSha} — skipping comment`);
        return;
      }
    }

    if (!installationId) {
      console.warn('No installation.id in webhook payload — skipping authentication');
      return;
    }

    try {
      // Authenticate as this specific GitHub App installation
      const octokit = await getInstallationClient(installationId);
      console.log(`authenticated as installation ${installationId}`);

      // Parse owner and repo from the full_name ("owner/repo")
      const [owner, repo] = repoName.split('/');

      // Fetch changed files for this PR
      const files = await fetchPrFiles(octokit, owner, repo, prNumber);

      console.log(`[diff] PR #${prNumber} — ${files.length} patchable file(s):`);
      for (const file of files) {
        console.log(
          `  ${file.filename}  status=${file.status}  +${file.additions}/-${file.deletions}  patch_length=${file.patch.length}`
        );
      }

      // Post placeholder comment on the PR
      const commentUrl = await postPlaceholderComment(octokit, owner, repo, prNumber, files.length);
      console.log(`[comment] Posted placeholder comment: ${commentUrl}`);

      // Record head SHA after successful comment
      if (headSha) {
        lastCommentedSha.set(prKey, headSha);
      }
    } catch (err) {
      console.error(`Failed to authenticate as installation ${installationId}:`, err.message);
    }
  }
);

// Step 7: Define POST /webhook route
// Use express.raw parser to preserve the untouched request body for signature verification
app.post('/webhook', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    // Step 7a: Read webhook headers sent by GitHub
    const signature = req.headers['x-hub-signature-256'];
    const eventName = req.headers['x-github-event'];
    const deliveryId = req.headers['x-github-delivery'];

    // Step 7b: Reject requests with missing signature header with HTTP 401
    if (!signature) {
      return res.status(401).send('Unauthorized: Missing signature header');
    }

    // Step 7c: Convert the raw body to a UTF-8 string
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString('utf-8')
      : typeof req.body === 'string'
        ? req.body
        : JSON.stringify(req.body || '');

    // Step 7d: Verify the signature using GITHUB_WEBHOOK_SECRET and reject invalid requests with 401
    let isValid = false;
    try {
      isValid = await webhooks.verify(rawBody, signature);
    } catch {
      return res.status(401).send('Unauthorized: Signature verification error');
    }

    if (!isValid) {
      return res.status(401).send('Unauthorized: Invalid signature');
    }

    // Step 7e: Parse verified payload JSON
    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return res.status(400).send('Bad Request: Invalid JSON payload');
    }

    // Step 7f: Dispatch event to @octokit/webhooks handler
    await webhooks.receive({
      id: deliveryId || '',
      name: eventName || '',
      payload,
    });

    // Step 7g: Acknowledge successful webhook receipt
    return res.status(200).send('OK');
  } catch (error) {
    console.error('Error handling webhook:', error);
    return res.status(500).send('Internal Server Error');
  }
});

// Step 8: Mount JSON body parser middleware for non-webhook routes
app.use(express.json());

// Step 9: Define health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Step 10: Start HTTP server listener
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

export default app;
