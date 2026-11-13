// Step 1: Import SmeeClient and dotenv
import SmeeClient from 'smee-client';
import dotenv from 'dotenv';

// Step 2: Load environment variables from .env file
dotenv.config();

// Step 3: Retrieve port and webhook proxy URL from environment variables
const PORT = process.env.PORT || 3000;
const WEBHOOK_PROXY_URL = process.env.WEBHOOK_PROXY_URL;

// Step 4: Validate that WEBHOOK_PROXY_URL is set
if (!WEBHOOK_PROXY_URL) {
  console.error('Error: WEBHOOK_PROXY_URL is not set in environment or .env file');
  process.exit(1);
}

// Step 5: Configure smee-client to forward webhooks to http://localhost:PORT/webhook
const targetUrl = `http://localhost:${PORT}/webhook`;
const smee = new SmeeClient({
  source: WEBHOOK_PROXY_URL,
  target: targetUrl,
  logger: console,
});

// Step 6: Start forwarding events from the proxy URL to local server
console.log(`Starting smee-client forwarding ${WEBHOOK_PROXY_URL} to ${targetUrl}`);
const events = smee.start();

// Step 7: Handle graceful shutdown on process termination
process.on('SIGINT', () => {
  console.log('\nStopping smee-client...');
  smee.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  smee.stop();
  process.exit(0);
});
