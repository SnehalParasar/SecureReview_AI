/**
 * diff.js — Fetches the changed files for a pull request.
 *
 * Uses octokit.paginate with the pulls.listFiles endpoint so PRs with
 * more than 100 files are handled automatically.
 *
 * Returns an array of:
 *   { filename, status, patch, additions, deletions }
 *
 * Files without a patch (binaries, files too large for GitHub's diff API)
 * are skipped and logged.
 */

/**
 * @param {import('@octokit/core').Octokit} octokit - Installation-scoped Octokit
 * @param {string} owner   - Repo owner (login or org name)
 * @param {string} repo    - Repo name
 * @param {number} pullNumber - PR number
 * @returns {Promise<Array<{filename:string, status:string, patch:string, additions:number, deletions:number}>>}
 */
export async function fetchPrFiles(octokit, owner, repo, pullNumber) {
  // paginate automatically follows the `Link` header through all pages
  const allFiles = await octokit.paginate(
    octokit.rest.pulls.listFiles,
    {
      owner,
      repo,
      pull_number: pullNumber,
      per_page: 100,          // maximum allowed by GitHub
    }
  );

  const result = [];

  for (const file of allFiles) {
    // Binary files and files whose diffs exceed GitHub's 20 KB limit
    // come back without a `patch` field — skip them.
    if (!file.patch) {
      console.log(
        `[diff] Skipping ${file.filename} (${file.status}) — no patch available (binary or too large)`
      );
      continue;
    }

    result.push({
      filename:  file.filename,
      status:    file.status,       // added | modified | removed | renamed | …
      patch:     file.patch,
      additions: file.additions,
      deletions: file.deletions,
    });
  }

  return result;
}
