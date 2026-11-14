// GitHub App authentication module
// Creates an authenticated Octokit client for a given installation ID

import 'dotenv/config';
import { App } from 'octokit';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Fail fast if required env vars are missing
const APP_ID = process.env.GITHUB_APP_ID;
const PRIVATE_KEY_PATH = process.env.GITHUB_PRIVATE_KEY_PATH;

if (!APP_ID) {
  throw new Error('GITHUB_APP_ID environment variable is required');
}
if (!PRIVATE_KEY_PATH) {
  throw new Error('GITHUB_PRIVATE_KEY_PATH environment variable is required');
}

// Read the private key from disk (never log it)
const privateKey = readFileSync(resolve(PRIVATE_KEY_PATH), 'utf-8');

// Initialise the GitHub App — this authenticates as the App itself (JWT-based)
const app = new App({
  appId: APP_ID,
  privateKey,
});

/**
 * Returns an Octokit instance authenticated as the given installation.
 * Uses the App's built-in token caching / refresh logic.
 *
 * @param {number|string} installationId - The installation.id from the webhook payload
 * @returns {Promise<import('@octokit/core').Octokit>} Authenticated Octokit for that installation
 */
export async function getInstallationClient(installationId) {
  const octokit = await app.getInstallationOctokit(installationId);
  return octokit;
}
