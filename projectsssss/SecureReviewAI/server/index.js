// Step 1: Import required dependencies
import express from 'express';
import dotenv from 'dotenv';
import { Webhooks } from '@octokit/webhooks';

// Step 2: Load environment variables from .env file
dotenv.config();

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

// Step 6: Handle pull_request event for actions: opened, synchronize, and reopened
// Logs repository name, PR number, and action to the terminal
webhooks.on(
  ['pull_request.opened', 'pull_request.synchronize', 'pull_request.reopened'],
  ({ id, name, payload }) => {
    const repoName = payload.repository?.full_name || payload.repository?.name || 'unknown';
    const prNumber = payload.pull_request?.number;
    const action = payload.action;

    console.log(`Repository: ${repoName}, PR #${prNumber}, Action: ${action}`);
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
