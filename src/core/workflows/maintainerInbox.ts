import { GitHubClient } from '../github';
import { listActionablePrs } from './listActionablePrs';

/**
 * Summarises the maintainer inbox across one or more repositories.
 *
 * For each repository the tool categorises open pull requests into
 * the same buckets returned by `listActionablePrs`: ready to merge,
 * waiting on checks, waiting on author, waiting on human and blocked.
 * The result contains a high‑level summary string, a per‑repo breakdown
 * of pull request numbers grouped by category and a suggested next
 * follow‑up prompt. This function does not mutate any data.
 */
export async function maintainerInbox({
  client,
  repos,
  includeDrafts = true,
  includeBlocked = true,
  includeReadyToMerge = true,
}: {
  client: GitHubClient;
  repos: string[];
  includeDrafts?: boolean;
  includeBlocked?: boolean;
  includeReadyToMerge?: boolean;
}) {
  const results: any[] = [];
  let totalReady = 0;
  let totalWaitingChecks = 0;
  let totalWaitingAuthor = 0;
  let totalWaitingHuman = 0;
  let totalBlocked = 0;
  for (const repo of repos) {
    const categories = await listActionablePrs({ client, repo });
    const repoSummary = {
      repo,
      ready: categories.readyToMerge,
      waitingOnChecks: categories.waitingOnChecks,
      waitingOnAuthor: categories.waitingOnAuthor,
      waitingOnHuman: categories.waitingOnHuman,
      blocked: categories.blocked,
    };
    results.push(repoSummary);
    totalReady += repoSummary.ready.length;
    totalWaitingChecks += repoSummary.waitingOnChecks.length;
    totalWaitingAuthor += repoSummary.waitingOnAuthor.length;
    totalWaitingHuman += repoSummary.waitingOnHuman.length;
    totalBlocked += repoSummary.blocked.length;
  }
  // Build a human friendly summary
  const summaryParts: string[] = [];
  if (totalReady > 0 && includeReadyToMerge) {
    summaryParts.push(`${totalReady} pull request${totalReady === 1 ? '' : 's'} ready to merge`);
  }
  if (totalWaitingChecks > 0) {
    summaryParts.push(`${totalWaitingChecks} waiting on checks`);
  }
  if (totalWaitingAuthor > 0) {
    summaryParts.push(`${totalWaitingAuthor} waiting on author`);
  }
  if (totalWaitingHuman > 0) {
    summaryParts.push(`${totalWaitingHuman} waiting on human review`);
  }
  if (totalBlocked > 0 && includeBlocked) {
    summaryParts.push(`${totalBlocked} blocked`);
  }
  const summary = summaryParts.length > 0 ? `You have ${summaryParts.join(', ')} across ${repos.length} repos.` : 'No open pull requests requiring attention.';
  // Suggest next action
  let nextSuggestedPrompt: string | undefined;
  if (totalReady > 0) {
    nextSuggestedPrompt = 'Merge the ready pull requests';
  } else if (totalWaitingChecks > 0) {
    nextSuggestedPrompt = 'Check CI status for pending pull requests';
  } else if (totalWaitingAuthor > 0) {
    nextSuggestedPrompt = 'Ask authors to address requested changes';
  } else if (totalWaitingHuman > 0) {
    nextSuggestedPrompt = 'Review the pending pull requests';
  }
  return {
    summary,
    repos: results,
    nextSuggestedPrompt,
  };
}