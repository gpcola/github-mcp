import { GitHubClient } from '../github';
import { evaluateMergePolicy, MergePolicy } from '../policy';
import { defaultMergePolicy } from '../policy';

/**
 * Categorizes open pull requests in a repository according to their readiness or required action.
 * Categories include:
 *  - readyToMerge: passes the merge policy
 *  - waitingOnChecks: failing or pending status checks
 *  - waitingOnAuthor: has requested changes or missing required labels
 *  - waitingOnHuman: needs review approval
 *  - blocked: blocked by other policy reasons (e.g. forbidden phrases or labels)
 */
export async function listActionablePrs({
  client,
  repo,
  policy,
}: {
  client: GitHubClient;
  repo: string;
  policy?: MergePolicy;
}) {
  const effectivePolicy: MergePolicy = { ...defaultMergePolicy, ...(policy || {}) };
  const prs = await client.listPulls({ repoFullName: repo, state: 'open', per_page: 100 });
  const readyToMerge: number[] = [];
  const waitingOnChecks: { pr: number; blockers: string[] }[] = [];
  const waitingOnAuthor: { pr: number; blockers: string[] }[] = [];
  const waitingOnHuman: { pr: number; blockers: string[] }[] = [];
  const blocked: { pr: number; blockers: string[] }[] = [];
  for (const pr of prs) {
    const sha = pr.head?.sha;
    if (!sha) continue;
    const checks = await client.getCommitChecks({ repoFullName: repo, sha });
    const reviews = await client.getPullReviews({ repoFullName: repo, number: pr.number });
    const evaluation = evaluateMergePolicy({ pr, checks, reviews, policy: effectivePolicy });
    if (evaluation.policyPass) {
      readyToMerge.push(pr.number);
    } else {
      // Determine which category based on blockers
      const blockers = evaluation.blockers;
      if (blockers.includes('Not all status checks are green') || blockers.includes('Pull request is not mergeable (merge conflicts)')) {
        waitingOnChecks.push({ pr: pr.number, blockers });
      } else if (blockers.includes('There are requested changes') || blockers.some((b) => b.startsWith('PR missing required label'))) {
        waitingOnAuthor.push({ pr: pr.number, blockers });
      } else if (blockers.includes('No approved reviews')) {
        waitingOnHuman.push({ pr: pr.number, blockers });
      } else {
        blocked.push({ pr: pr.number, blockers });
      }
    }
  }
  return { readyToMerge, waitingOnChecks, waitingOnAuthor, waitingOnHuman, blocked };
}