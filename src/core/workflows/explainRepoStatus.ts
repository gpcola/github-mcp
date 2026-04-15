import { GitHubClient } from '../github';
import { evaluateMergePolicy, defaultMergePolicy, MergePolicy } from '../policy';
import { listActionablePrs } from './listActionablePrs';
import { branchCleanup } from './branchCleanup';
import { AuditLogger } from '../audit';

/**
 * Provides an explanation for why a given pull request or branch cannot proceed.
 *
 * If a `prNumber` is provided, the function evaluates the merge policy and returns
 * the blockers. If a `branch` is provided, it inspects branch cleanup suggestions
 * to explain whether the branch is stale or protected. If neither is provided it
 * returns a generic message.
 */
export async function explainRepoStatus({
  client,
  repo,
  prNumber,
  branch,
  policy,
  correlationId = 'explain',
  audit,
}: {
  client: GitHubClient;
  repo: string;
  prNumber?: number;
  branch?: string;
  policy?: MergePolicy;
  correlationId?: string;
  audit?: AuditLogger;
}) {
  if (prNumber !== undefined) {
    // Evaluate merge readiness for PR
    const pr = await client.getPull({ repoFullName: repo, number: prNumber });
    const sha = pr?.head?.sha;
    if (!sha) return { summary: 'Unable to determine PR head SHA.' };
    const checks = await client.getCommitChecks({ repoFullName: repo, sha });
    const reviews = await client.getPullReviews({ repoFullName: repo, number: prNumber });
    const effectivePolicy: MergePolicy = { ...defaultMergePolicy, ...(policy || {}) };
    const evaluation = evaluateMergePolicy({ pr, checks, reviews, policy: effectivePolicy });
    if (evaluation.policyPass) {
      return { summary: `Pull request #${prNumber} meets the merge policy and can be merged.`, mergeable: true };
    }
    // Format blockers into human sentences
    const blockersList = evaluation.blockers.map((b) => `- ${b}`);
    const summary = `Pull request #${prNumber} is blocked for the following reasons:\n${blockersList.join('\n')}`;
    return { summary, mergeable: false, blockers: evaluation.blockers };
  }
  if (branch) {
    // Determine branch cleanup status using branchCleanup in inspect mode
    const dummyAudit = audit || ({} as any);
    const cleanup = await branchCleanup({ client, repos: [repo], correlationId, audit: dummyAudit, mode: 'inspect' });
    const branchEntry = cleanup.toDelete.find((e: any) => e.branch === branch) || cleanup.kept.find((e: any) => e.branch === branch);
    if (!branchEntry) {
      return { summary: `Branch ${branch} not found.` };
    }
    if (branchEntry.status === 'stale' || branchEntry.status === 'eligible' || branchEntry.status === 'deleted') {
      return { summary: `Branch ${branch} is considered stale (${branchEntry.reason}) and can be deleted.`, deletable: true };
    }
    if (branchEntry.reason === 'default') {
      return { summary: `Branch ${branch} is the default branch and cannot be deleted.`, deletable: false };
    }
    if (branchEntry.reason === 'protected') {
      return { summary: `Branch ${branch} is protected and cannot be deleted.`, deletable: false };
    }
    return { summary: `Branch ${branch} should be kept because: ${branchEntry.reason}.`, deletable: false };
  }
  return { summary: 'No pull request or branch specified to explain.' };
}