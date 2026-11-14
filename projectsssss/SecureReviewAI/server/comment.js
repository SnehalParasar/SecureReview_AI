/**
 * comment.js — Posts PR comments via the GitHub Issues API.
 *
 * GitHub's Issues API is used for PR comments because a pull request is
 * a specialised issue. `issues.createComment` posts a top-level (non-inline)
 * comment visible in the "Conversation" tab.
 */

/**
 * Post a placeholder comment on a pull request.
 *
 * @param {import('@octokit/core').Octokit} octokit - Installation-scoped Octokit
 * @param {string} owner      - Repo owner (login or org)
 * @param {string} repo       - Repo name
 * @param {number} prNumber   - Pull request number (issues and PRs share the same number space)
 * @param {number} fileCount  - Number of patchable changed files found
 * @returns {Promise<string>} URL of the created comment
 */
export async function postPlaceholderComment(octokit, owner, repo, prNumber, fileCount) {
  const body = `SecureReview AI received this PR and found ${fileCount} changed files.`;

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,   // PRs share the issue number space on GitHub
    body,
  });

  return data.html_url;
}
