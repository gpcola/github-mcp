import { z } from 'zod';
import { Tool, ToolError, ExecutionMode } from '../types';
import { GitHubClient } from '../core/github';
import { defaultMergePolicy, MergePolicy, evaluateMergePolicy } from '../core/policy';
import { loadConfig } from '../config';
import { AuditLogger } from '../core/audit';
import { mergeSafePrs } from '../core/workflows/mergeSafePrs';
import { sweepOwnerRepos } from '../core/workflows/sweepOwnerRepos';
import { closeStaleDrafts } from '../core/workflows/closeStaleDrafts';
import { deleteMergedBranchesAcrossRepos } from '../core/workflows/deleteMergedBranches';
import { repoHygieneCampaign } from '../core/workflows/repoHygieneCampaign';
import { listActionablePrs } from '../core/workflows/listActionablePrs';
import { detectRepoDrift } from '../core/workflows/detectRepoDrift';
import { applyRepoBaseline } from '../core/workflows/applyRepoBaseline';
// conversational workflow helpers
import { maintainerInbox } from '../core/workflows/maintainerInbox';
import { branchCleanup } from '../core/workflows/branchCleanup';
import { mergeReadyWork } from '../core/workflows/mergeReadyWork';
import { runRepoHygiene } from '../core/workflows/runRepoHygiene';
import { compareRepos } from '../core/workflows/compareRepos';
import { explainRepoStatus } from '../core/workflows/explainRepoStatus';

/**
 * Helper to create a GitHub client and validate authentication. Throws if invalid.
 */
async function getClient(): Promise<GitHubClient> {
  const client = new GitHubClient();
  await client.validateAuthentication();
  return client;
}

/**
 * Helper to create an audit logger and correlation ID for a run.
 */
function getAudit(): { audit: AuditLogger; correlationId: string } {
  const audit = new AuditLogger();
  const correlationId = audit.generateCorrelationId();
  return { audit, correlationId };
}

// Tool to get the authenticated user
const githubAdminGetAuthenticatedUser: Tool<undefined, any> = {
  name: 'github_admin_get_authenticated_user',
  description: 'Returns the authenticated GitHub user.',
  inputSchema: z.undefined(),
  outputSchema: z.any(),
  async execute() {
    const client = await getClient();
    return client.getAuthenticatedUser();
  },
};

// List repositories
const githubAdminListRepos: Tool<{ owner?: string; visibility?: 'all' | 'public' | 'private'; affiliation?: string; archived?: boolean }, any> = {
  name: 'github_admin_list_repos',
  description: 'Lists repositories accessible to the authenticated user.',
  inputSchema: z.object({
    owner: z.string().optional(),
    visibility: z.enum(['all', 'public', 'private']).optional(),
    affiliation: z.string().optional(),
    archived: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  async execute(input) {
    const client = await getClient();
    return client.listRepositories({
      owner: input.owner,
      visibility: input.visibility,
      affiliation: input.affiliation,
      archived: input.archived,
      per_page: 100,
    });
  },
};

// Get repo
const githubAdminGetRepo: Tool<{ repo: string }, any> = {
  name: 'github_admin_get_repo',
  description: 'Gets metadata about a repository (owner/repo).',
  inputSchema: z.object({ repo: z.string() }),
  outputSchema: z.any(),
  async execute({ repo }) {
    const client = await getClient();
    return client.getRepo(repo);
  },
};

// List open PRs
const githubAdminListOpenPrs: Tool<{ repo: string; base?: string; head?: string; draft?: boolean; author?: string }, any> = {
  name: 'github_admin_list_open_prs',
  description: 'Lists open pull requests with optional filters.',
  inputSchema: z.object({
    repo: z.string(),
    base: z.string().optional(),
    head: z.string().optional(),
    draft: z.boolean().optional(),
    author: z.string().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repo, base, head, draft, author }) {
    const client = await getClient();
    return client.listPulls({ repoFullName: repo, state: 'open', base, head, draft, author, per_page: 100 });
  },
};

// Get PR
const githubAdminGetPr: Tool<{ repo: string; prNumber: number }, any> = {
  name: 'github_admin_get_pr',
  description: 'Gets details of a pull request.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    return client.getPull({ repoFullName: repo, number: prNumber });
  },
};

// Get PR checks
const githubAdminGetPrChecks: Tool<{ repo: string; prNumber: number }, { status: any; checks: any }> = {
  name: 'github_admin_get_pr_checks',
  description: 'Returns combined status and check runs for the head commit of a pull request.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.object({ status: z.any(), checks: z.any() }),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    const pr = await client.getPull({ repoFullName: repo, number: prNumber });
    const sha = pr?.head?.sha;
    if (!sha) throw new ToolError('Unable to determine PR head SHA');
    return client.getCommitChecks({ repoFullName: repo, sha });
  },
};

// Get PR reviews
const githubAdminGetPrReviews: Tool<{ repo: string; prNumber: number }, any[]> = {
  name: 'github_admin_get_pr_reviews',
  description: 'Lists reviews for a pull request.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    return client.getPullReviews({ repoFullName: repo, number: prNumber });
  },
};

// Get PR merge readiness
const githubAdminGetPrMergeReadiness: Tool<{ repo: string; prNumber: number; policy?: MergePolicy }, any> = {
  name: 'github_admin_get_pr_merge_readiness',
  description: 'Evaluates whether a pull request is ready to merge under a given policy.',
  inputSchema: z.object({
    repo: z.string(),
    prNumber: z.number().int(),
    policy: z.any().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repo, prNumber, policy }) {
    const client = await getClient();
    const pr = await client.getPull({ repoFullName: repo, number: prNumber });
    const sha = pr?.head?.sha;
    if (!sha) throw new ToolError('Unable to determine PR head SHA');
    const checks = await client.getCommitChecks({ repoFullName: repo, sha });
    const reviews = await client.getPullReviews({ repoFullName: repo, number: prNumber });
    const effectivePolicy: MergePolicy = { ...defaultMergePolicy, ...(policy || {}) };
    return evaluateMergePolicy({ pr, checks, reviews, policy: effectivePolicy });
  },
};

// List branches
const githubAdminListBranches: Tool<{ repo: string }, any[]> = {
  name: 'github_admin_list_branches',
  description: 'Lists all branches for a repository.',
  inputSchema: z.object({ repo: z.string() }),
  outputSchema: z.any(),
  async execute({ repo }) {
    const client = await getClient();
    return client.listBranches({ repoFullName: repo, per_page: 100 });
  },
};

// Find stale branches tool — reuse sweepOwnerRepos with inspect mode but for one repo
const githubAdminFindStaleBranches: Tool<{
  repo: string;
  olderThanDays?: number;
  prefixAllowlist?: string[];
  mode?: ExecutionMode;
}, any> = {
  name: 'github_admin_find_stale_branches',
  description: 'Finds stale branches in a repository and recommends deletion but does not perform it by default.',
  inputSchema: z.object({
    repo: z.string(),
    olderThanDays: z.number().optional(),
    prefixAllowlist: z.array(z.string()).optional(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
  }),
  outputSchema: z.any(),
  async execute({ repo, olderThanDays, prefixAllowlist, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    // Use sweepOwnerRepos on a single repo but do not delete when mode is not apply
    return sweepOwnerRepos({
      client,
      repos: [repo],
      olderThanDays: olderThanDays || 30,
      prefixAllowlist,
      mode: mode || 'propose',
      correlationId,
      audit,
    });
  },
};

// Mark PR ready for review
const githubAdminMarkPrReadyForReview: Tool<{ repo: string; prNumber: number }, any> = {
  name: 'github_admin_mark_pr_ready_for_review',
  description: 'Marks a draft PR as ready for review.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    return client.markPrReadyForReview({ repoFullName: repo, number: prNumber });
  },
};

// Close PR
const githubAdminClosePr: Tool<{ repo: string; prNumber: number }, any> = {
  name: 'github_admin_close_pr',
  description: 'Closes a pull request.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    return client.updatePullState({ repoFullName: repo, number: prNumber, state: 'closed' });
  },
};

// Reopen PR
const githubAdminReopenPr: Tool<{ repo: string; prNumber: number }, any> = {
  name: 'github_admin_reopen_pr',
  description: 'Reopens a closed pull request.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber }) {
    const client = await getClient();
    return client.updatePullState({ repoFullName: repo, number: prNumber, state: 'open' });
  },
};

// Merge PR with execution mode
const githubAdminMergePr: Tool<{
  repo: string;
  prNumber: number;
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  commitTitle?: string;
  commitMessage?: string;
  mode?: ExecutionMode;
}, any> = {
  name: 'github_admin_merge_pr',
  description: 'Merges a pull request. By default returns a proposal; set mode=apply to perform.',
  inputSchema: z.object({
    repo: z.string(),
    prNumber: z.number().int(),
    mergeMethod: z.enum(['merge', 'squash', 'rebase']).optional(),
    commitTitle: z.string().optional(),
    commitMessage: z.string().optional(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
  }),
  outputSchema: z.any(),
  async execute({ repo, prNumber, mergeMethod, commitTitle, commitMessage, mode }) {
    const execMode: ExecutionMode = mode || 'propose';
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const auth = await client.validateAuthentication();
    const target = { repo, pr: prNumber };
    if (execMode === 'inspect' || execMode === 'propose') {
      // Just return summary and audit
      const result = {
        dryRun: true,
        message: `Would merge PR #${prNumber} using ${mergeMethod || 'merge'}.`,
      };
      await audit.log({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: 'github_admin_merge_pr',
        mode: execMode,
        actor: auth.login,
        target,
        rationale: 'PR merge proposed',
        outcome: 'success',
      });
      return result;
    }
    // Apply mode
    try {
      const mergeResult = await client.mergePullRequest({ repoFullName: repo, number: prNumber, mergeMethod, commitTitle, commitMessage });
      await audit.log({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: 'github_admin_merge_pr',
        mode: execMode,
        actor: auth.login,
        target,
        rationale: 'PR merged',
        outcome: 'success',
      });
      return mergeResult;
    } catch (err: any) {
      await audit.log({
        timestamp: new Date().toISOString(),
        correlationId,
        tool: 'github_admin_merge_pr',
        mode: execMode,
        actor: auth.login,
        target,
        rationale: 'PR merge failed',
        outcome: 'failure',
        error: err.message,
      });
      throw err;
    }
  },
};

// Delete branch with execution mode
const githubAdminDeleteBranch: Tool<{
  repo: string;
  branch: string;
  mode?: ExecutionMode;
}, any> = {
  name: 'github_admin_delete_branch',
  description: 'Deletes a branch if allowed. Defaults to propose mode.',
  inputSchema: z.object({ repo: z.string(), branch: z.string(), mode: z.enum(['inspect', 'propose', 'apply']).optional() }),
  outputSchema: z.any(),
  async execute({ repo, branch, mode }) {
    const execMode = mode || 'propose';
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const repoInfo = await client.getRepo(repo);
    const defaultBranch = repoInfo.default_branch;
    if (branch === defaultBranch) {
      throw new ToolError('Cannot delete default branch');
    }
    const branchInfo = await client.getBranch({ repoFullName: repo, branch });
    if (branchInfo.protected) {
      throw new ToolError('Cannot delete protected branch');
    }
    const auth = await client.validateAuthentication();
    const target = { repo, branch };
    if (execMode === 'inspect' || execMode === 'propose') {
      await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'github_admin_delete_branch', mode: execMode, actor: auth.login, target, rationale: 'Branch deletion proposed', outcome: 'success' });
      return { dryRun: true, message: `Would delete branch ${branch} in ${repo}` };
    }
    // apply
    try {
      await client.deleteBranch({ repoFullName: repo, branch });
      await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'github_admin_delete_branch', mode: execMode, actor: auth.login, target, rationale: 'Branch deleted', outcome: 'success' });
      return { deleted: true };
    } catch (err: any) {
      await audit.log({ timestamp: new Date().toISOString(), correlationId, tool: 'github_admin_delete_branch', mode: execMode, actor: auth.login, target, rationale: 'Branch deletion failed', outcome: 'failure', error: err.message });
      throw err;
    }
  },
};

// Merge safe PRs across repos
const githubAdminMergeSafePrs: Tool<{
  repos: string[];
  policy?: MergePolicy;
  mode?: ExecutionMode;
}, any> = {
  name: 'github_admin_merge_safe_prs',
  description: 'Merges PRs across multiple repositories that pass the merge policy. Defaults to propose mode.',
  inputSchema: z.object({
    repos: z.array(z.string()),
    policy: z.any().optional(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, policy, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    const effectivePolicy: MergePolicy = { ...defaultMergePolicy, ...(policy || {}) };
    return mergeSafePrs({ client, repos, mode: execMode, policy: effectivePolicy, correlationId, audit });
  },
};

// Sweep owner repos for stale branches
const githubAdminSweepOwnerRepos: Tool<{
  repos: string[];
  olderThanDays?: number;
  prefixAllowlist?: string[];
  mode?: ExecutionMode;
}, any> = {
  name: 'github_admin_sweep_owner_repos',
  description: 'Sweeps branches across multiple repos and deletes stale branches. Defaults to propose mode.',
  inputSchema: z.object({
    repos: z.array(z.string()),
    olderThanDays: z.number().optional(),
    prefixAllowlist: z.array(z.string()).optional(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, olderThanDays, prefixAllowlist, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return sweepOwnerRepos({ client, repos, olderThanDays: olderThanDays || 30, prefixAllowlist, mode: execMode, correlationId, audit });
  },
};

// List PRs ready to merge according to policy
const githubAdminListPrsReadyToMerge: Tool<{
  repo: string;
  policy?: MergePolicy;
}, any> = {
  name: 'github_admin_list_prs_ready_to_merge',
  description: 'Lists open pull requests that pass the merge policy.',
  inputSchema: z.object({ repo: z.string(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, policy }) {
    const client = await getClient();
    const prs = await client.listPulls({ repoFullName: repo, state: 'open', per_page: 100 });
    const ready: any[] = [];
    const blocked: any[] = [];
    for (const pr of prs) {
      const sha = pr.head?.sha;
      if (!sha) continue;
      const checks = await client.getCommitChecks({ repoFullName: repo, sha });
      const reviews = await client.getPullReviews({ repoFullName: repo, number: pr.number });
      const evaluation = evaluateMergePolicy({ pr, checks, reviews, policy: { ...defaultMergePolicy, ...(policy || {}) } });
      if (evaluation.policyPass) {
        ready.push(pr.number);
      } else {
        blocked.push({ pr: pr.number, blockers: evaluation.blockers });
      }
    }
    return { ready, blocked };
  },
};

// Apply PR policy explicitly, returning pass/fail and suggested next action
const githubAdminApplyPrPolicy: Tool<{ repo: string; prNumber: number; policy?: MergePolicy }, any> = {
  name: 'github_admin_apply_pr_policy',
  description: 'Applies a merge policy to a pull request and returns pass/fail, blockers and suggested next action.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber, policy }) {
    const client = await getClient();
    const pr = await client.getPull({ repoFullName: repo, number: prNumber });
    const sha = pr?.head?.sha;
    if (!sha) throw new ToolError('Unable to determine PR head SHA');
    const checks = await client.getCommitChecks({ repoFullName: repo, sha });
    const reviews = await client.getPullReviews({ repoFullName: repo, number: prNumber });
    const effectivePolicy: MergePolicy = { ...defaultMergePolicy, ...(policy || {}) };
    const evaluation = evaluateMergePolicy({ pr, checks, reviews, policy: effectivePolicy });
    const suggestedAction = evaluation.policyPass ? 'merge' : 'fix';
    return { pass: evaluation.policyPass, blockers: evaluation.blockers, suggestedAction };
  },
};

// Explain why a PR cannot merge
const githubAdminExplainWhyPrCannotMerge: Tool<{ repo: string; prNumber: number; policy?: MergePolicy }, any> = {
  name: 'github_admin_explain_why_pr_cannot_merge',
  description: 'Explains why a pull request cannot be merged according to the merge policy.',
  inputSchema: z.object({ repo: z.string(), prNumber: z.number().int(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, prNumber, policy }) {
    const client = await getClient();
    const pr = await client.getPull({ repoFullName: repo, number: prNumber });
    const sha = pr?.head?.sha;
    if (!sha) throw new ToolError('Unable to determine PR head SHA');
    const checks = await client.getCommitChecks({ repoFullName: repo, sha });
    const reviews = await client.getPullReviews({ repoFullName: repo, number: prNumber });
    const evaluation = evaluateMergePolicy({ pr, checks, reviews, policy: { ...defaultMergePolicy, ...(policy || {}) } });
    if (evaluation.policyPass) {
      return { mergeable: true, message: 'Pull request meets the policy requirements and can be merged.' };
    }
    return { mergeable: false, blockers: evaluation.blockers };
  },
};

// Get repository governance details (branch protection and merge strategies)
const githubAdminGetRepoGovernance: Tool<{ repo: string }, any> = {
  name: 'github_admin_get_repo_governance',
  description: 'Returns governance information about a repository including default branch protection and merge strategies.',
  inputSchema: z.object({ repo: z.string() }),
  outputSchema: z.any(),
  async execute({ repo }) {
    const client = await getClient();
    const repoInfo = await client.getRepo(repo);
    const defaultBranch = repoInfo.default_branch;
    const protection = await client.getBranchProtection({ repoFullName: repo, branch: defaultBranch });
    const mergeStrategies = {
      allowMergeCommit: repoInfo.allow_merge_commit,
      allowSquashMerge: repoInfo.allow_squash_merge,
      allowRebaseMerge: repoInfo.allow_rebase_merge,
    };
    return { defaultBranch, protection, mergeStrategies };
  },
};

// Compare governance between two repos
const githubAdminCompareRepoGovernance: Tool<{ repoA: string; repoB: string }, any> = {
  name: 'github_admin_compare_repo_governance',
  description: 'Compares governance settings between two repositories and highlights differences.',
  inputSchema: z.object({ repoA: z.string(), repoB: z.string() }),
  outputSchema: z.any(),
  async execute({ repoA, repoB }) {
    const client = await getClient();
    const infoA = await client.getRepo(repoA);
    const infoB = await client.getRepo(repoB);
    const fields = ['default_branch', 'allow_merge_commit', 'allow_squash_merge', 'allow_rebase_merge', 'delete_branch_on_merge'];
    const diffs: Record<string, any> = {};
    fields.forEach((field) => {
      if (infoA[field] !== infoB[field]) {
        diffs[field] = { [repoA]: infoA[field], [repoB]: infoB[field] };
      }
    });
    return { differences: diffs };
  },
};

// Close stale draft PRs across repos
const githubAdminCloseStaleDrafts: Tool<{ repos: string[]; olderThanDays?: number; mode?: ExecutionMode }, any> = {
  name: 'github_admin_close_stale_drafts',
  description: 'Closes draft pull requests that have been open longer than a threshold across multiple repositories.',
  inputSchema: z.object({
    repos: z.array(z.string()),
    olderThanDays: z.number().optional(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, olderThanDays, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return closeStaleDrafts({ client, repos, olderThanDays: olderThanDays || 30, mode: execMode, correlationId, audit });
  },
};

// Delete merged branches across repos
const githubAdminDeleteMergedBranches: Tool<{ repos: string[]; mode?: ExecutionMode }, any> = {
  name: 'github_admin_delete_merged_branches_across_repos',
  description: 'Deletes branches whose PR has been merged across multiple repositories.',
  inputSchema: z.object({ repos: z.array(z.string()), mode: z.enum(['inspect', 'propose', 'apply']).optional() }),
  outputSchema: z.any(),
  async execute({ repos, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return deleteMergedBranchesAcrossRepos({ client, repos, mode: execMode, correlationId, audit });
  },
};

// Repo hygiene campaign
const githubAdminRepoHygieneCampaign: Tool<{ repos: string[]; mode?: ExecutionMode }, any> = {
  name: 'github_admin_repo_hygiene_campaign',
  description: 'Performs a full hygiene campaign across repositories including merging safe PRs, sweeping stale branches, closing stale drafts, and deleting merged branches.',
  inputSchema: z.object({ repos: z.array(z.string()), mode: z.enum(['inspect', 'propose', 'apply']).optional() }),
  outputSchema: z.any(),
  async execute({ repos, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return repoHygieneCampaign({ client, repos, mode: execMode, correlationId, audit });
  },
};

// List actionable PRs
const githubAdminListActionablePrs: Tool<{ repo: string; policy?: MergePolicy }, any> = {
  name: 'github_admin_list_actionable_prs',
  description: 'Categorizes open PRs in a repo into ready, waiting on checks, waiting on author, waiting on human, and blocked.',
  inputSchema: z.object({ repo: z.string(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, policy }) {
    const client = await getClient();
    return listActionablePrs({ client, repo, policy });
  },
};

// List PRs waiting on checks
const githubAdminListPrsWaitingOnChecks: Tool<{ repo: string; policy?: MergePolicy }, any> = {
  name: 'github_admin_list_prs_waiting_on_checks',
  description: 'Lists pull requests that are waiting on status checks or merge conflicts to be resolved.',
  inputSchema: z.object({ repo: z.string(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, policy }) {
    const client = await getClient();
    const result = await listActionablePrs({ client, repo, policy });
    return result.waitingOnChecks;
  },
};

// List PRs waiting on author
const githubAdminListPrsWaitingOnAuthor: Tool<{ repo: string; policy?: MergePolicy }, any> = {
  name: 'github_admin_list_prs_waiting_on_author',
  description: 'Lists pull requests that require action from the author (e.g. addressing requested changes or adding required labels).',
  inputSchema: z.object({ repo: z.string(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, policy }) {
    const client = await getClient();
    const result = await listActionablePrs({ client, repo, policy });
    return result.waitingOnAuthor;
  },
};

// List PRs needing human attention (review)
const githubAdminListPrsNeedingHumanAttention: Tool<{ repo: string; policy?: MergePolicy }, any> = {
  name: 'github_admin_list_prs_needing_human_attention',
  description: 'Lists pull requests that require human review or approval.',
  inputSchema: z.object({ repo: z.string(), policy: z.any().optional() }),
  outputSchema: z.any(),
  async execute({ repo, policy }) {
    const client = await getClient();
    const result = await listActionablePrs({ client, repo, policy });
    return result.waitingOnHuman;
  },
};

// Detect repo drift
const githubAdminDetectRepoDrift: Tool<{ repo: string }, any> = {
  name: 'github_admin_detect_repo_drift',
  description: 'Detects configuration drift in a repository compared to the baseline defined in MCP config.',
  inputSchema: z.object({ repo: z.string() }),
  outputSchema: z.any(),
  async execute({ repo }) {
    const client = await getClient();
    return detectRepoDrift({ client, repo });
  },
};

// Preview repo baseline changes
const githubAdminPreviewRepoBaselineChanges: Tool<{ repo: string }, any> = {
  name: 'github_admin_preview_repo_baseline_changes',
  description: 'Previews changes that would be applied to a repository to conform to the baseline settings.',
  inputSchema: z.object({ repo: z.string() }),
  outputSchema: z.any(),
  async execute({ repo }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    return applyRepoBaseline({ client, repo, mode: 'inspect', correlationId, audit });
  },
};

// Apply repo baseline
const githubAdminApplyRepoBaseline: Tool<{ repo: string; mode?: ExecutionMode }, any> = {
  name: 'github_admin_apply_repo_baseline',
  description: 'Applies baseline repository settings to a repository. Defaults to propose mode.',
  inputSchema: z.object({ repo: z.string(), mode: z.enum(['inspect', 'propose', 'apply']).optional() }),
  outputSchema: z.any(),
  async execute({ repo, mode }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return applyRepoBaseline({ client, repo, mode: execMode, correlationId, audit });
  },
};

// --------------------------------------------------
// Conversational operator tools
// These tools are designed for natural‑language usage and produce chat‑friendly summaries.

// Maintainer inbox summarises actionable pull requests across repositories
const githubAdminMaintainerInbox: Tool<{
  repos: string[];
  includeDrafts?: boolean;
  includeBlocked?: boolean;
  includeReadyToMerge?: boolean;
}, any> = {
  name: 'github_admin_maintainer_inbox',
  description:
    'Summarises what needs attention across repositories.\n' +
    'Use this tool to see pull requests that are ready to merge, waiting on checks, waiting on authors, waiting on human review, or blocked.\n' +
    'Default behaviour includes drafts and blocked PRs.\n' +
    'Examples: "show me my maintainer inbox for ev-share and cheapskate", "what needs attention across my repos?"',
  inputSchema: z.object({
    repos: z.array(z.string()),
    includeDrafts: z.boolean().optional(),
    includeBlocked: z.boolean().optional(),
    includeReadyToMerge: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, includeDrafts, includeBlocked, includeReadyToMerge }) {
    const client = await getClient();
    const result = await maintainerInbox({ client, repos, includeDrafts, includeBlocked, includeReadyToMerge });
    return result;
  },
};

// Run a hygiene campaign across repositories and summarise actions
const githubAdminRunRepoHygiene: Tool<{
  repos: string[];
  mode?: ExecutionMode;
  branchPrefixAllowlist?: string[];
  olderThanDays?: number;
  includeMergeSafePrs?: boolean;
  includeStaleDrafts?: boolean;
  includeMergedBranchCleanup?: boolean;
}, any> = {
  name: 'github_admin_run_repo_hygiene',
  description:
    'Runs a comprehensive hygiene campaign across repositories.\n' +
    'This includes merging safe pull requests, sweeping stale branches, closing stale drafts and deleting merged branches.\n' +
    'Defaults to propose mode.\n' +
    'Examples: "run repo hygiene on ev-share and cheapskate", "clean up my repos but only propose the actions"',
  inputSchema: z.object({
    repos: z.array(z.string()),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
    branchPrefixAllowlist: z.array(z.string()).optional(),
    olderThanDays: z.number().optional(),
    includeMergeSafePrs: z.boolean().optional(),
    includeStaleDrafts: z.boolean().optional(),
    includeMergedBranchCleanup: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, mode, branchPrefixAllowlist, olderThanDays, includeMergeSafePrs, includeStaleDrafts, includeMergedBranchCleanup }) {
    // Currently the hygiene workflow does not support selective inclusion; ignore flags.
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    const result = await runRepoHygiene({ client, repos, mode: execMode, correlationId, audit });
    return result;
  },
};

// Merge pull requests ready according to the policy across repos
const githubAdminMergeReadyWork: Tool<{
  repos: string[];
  mode?: ExecutionMode;
  policyOverride?: any;
  maxActions?: number;
}, any> = {
  name: 'github_admin_merge_ready_work',
  description:
    'Merges pull requests that satisfy the merge policy across the specified repositories.\n' +
    'Defaults to propose mode, returning which PRs are ready to merge.\n' +
    'Examples: "merge any safe PRs in ev-share and cheapskate", "merge ready work in my repos"',
  inputSchema: z.object({
    repos: z.array(z.string()),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
    policyOverride: z.any().optional(),
    maxActions: z.number().int().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, mode, policyOverride, maxActions }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    return mergeReadyWork({ client, repos, mode: execMode, policy: policyOverride, maxActions, correlationId, audit });
  },
};

// Perform branch cleanup across repos
const githubAdminBranchCleanup: Tool<{
  repos: string[];
  mode?: ExecutionMode;
  branchPrefixAllowlist?: string[];
  olderThanDays?: number;
  onlyMerged?: boolean;
  onlyAbandoned?: boolean;
}, any> = {
  name: 'github_admin_branch_cleanup',
  description:
    'Inspects or deletes stale branches across repositories.\n' +
    'Use this tool to identify branches older than a threshold, optionally filtered by prefix, and determine whether they can be deleted.\n' +
    'Defaults to propose mode.\n' +
    'Examples: "show me what stale codex branches can be deleted in cheapskate", "clean up stale branches in ev-share"',
  inputSchema: z.object({
    repos: z.array(z.string()),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
    branchPrefixAllowlist: z.array(z.string()).optional(),
    olderThanDays: z.number().optional(),
    onlyMerged: z.boolean().optional(),
    onlyAbandoned: z.boolean().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repos, mode, branchPrefixAllowlist, olderThanDays, onlyMerged, onlyAbandoned }) {
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    // For each repo, call branchCleanup and collate results
    const results: any[] = [];
    for (const repo of repos) {
      const summary = await branchCleanup({ client, repos: [repo], olderThanDays, prefixAllowlist: branchPrefixAllowlist, onlyMerged, onlyAbandoned, mode: execMode, correlationId, audit });
      results.push({ repo, ...summary });
    }
    return results;
  },
};

// Compare repositories on governance, drift or hygiene
const githubAdminCompareRepos: Tool<{
  repos: string[];
  compare: 'governance' | 'drift' | 'hygiene';
}, any> = {
  name: 'github_admin_compare_repos',
  description:
    'Compares repositories across governance, drift or hygiene.\n' +
    'Use compare="governance" to compare merge strategies and default branch settings, compare="drift" to compare config drift from baseline, and compare="hygiene" to compare maintainer inbox and stale branches.\n' +
    'Examples: "compare governance between ev-share and cheapskate", "compare drift for ev-share vs thetekteam-review-defence"',
  inputSchema: z.object({
    repos: z.array(z.string()).min(2),
    compare: z.enum(['governance', 'drift', 'hygiene']),
  }),
  outputSchema: z.any(),
  async execute({ repos, compare }) {
    const client = await getClient();
    return compareRepos({ client, repos, compare });
  },
};

// Explain why a PR cannot merge or why a branch cannot be deleted
const githubAdminExplainRepoStatus: Tool<{
  repo: string;
  prNumber?: number;
  branch?: string;
  policy?: any;
}, any> = {
  name: 'github_admin_explain_repo_status',
  description:
    'Explains why a pull request is blocked or why a branch cannot be deleted.\n' +
    'Provide repo and prNumber to get merge blockers, or repo and branch to get deletion rationale.\n' +
    'Examples: "why can’t PR 46 merge in ev-share?", "why is branch feature/foo not deletable?"',
  inputSchema: z.object({
    repo: z.string(),
    prNumber: z.number().int().optional(),
    branch: z.string().optional(),
    policy: z.any().optional(),
  }),
  outputSchema: z.any(),
  async execute({ repo, prNumber, branch, policy }) {
    const client = await getClient();
    return explainRepoStatus({ client, repo, prNumber, branch, policy });
  },
};

// Validate GitHub connection and report capabilities
const githubAdminValidateConnection: Tool<undefined, any> = {
  name: 'github_admin_validate_connection',
  description:
    'Validates the GitHub token and reports the authenticated login and basic capabilities.\n' +
    'Use this tool after setup to ensure your token has the necessary scopes.\n' +
    'Example: "validate connection"',
  inputSchema: z.undefined(),
  outputSchema: z.any(),
  async execute() {
    const client = await getClient();
    const auth = await client.validateAuthentication();
    // Attempt to list repositories to check for repo scope
    let repoAccess = true;
    try {
      await client.listRepositories({ per_page: 1 });
    } catch {
      repoAccess = false;
    }
    return { login: auth.login, repositoryAccess: repoAccess };
  },
};

// Interpret free‑form instruction and execute limited supported actions
const githubAdminInterpretAndExecute: Tool<{
  instruction: string;
  mode?: ExecutionMode;
  repos?: string[];
  maxActions?: number;
  branchPrefixAllowlist?: string[];
}, any> = {
  name: 'github_admin_interpret_and_execute',
  description:
    'Interprets a plain‑English GitHub administration instruction and executes a corresponding safe action.\n' +
    'Supported intents include: merge safe PRs, close stale draft PRs, delete stale branches, compare repositories and summarise maintainer inbox.\n' +
    'If the instruction is ambiguous or unsupported, the tool will refuse and suggest using a more specific tool.\n' +
    'Examples: "merge safe PRs in ev-share", "clean up stale branches in cheapskate", "close old draft PRs across my repos", "compare governance between ev-share and cheapskate"',
  inputSchema: z.object({
    instruction: z.string(),
    mode: z.enum(['inspect', 'propose', 'apply']).optional(),
    repos: z.array(z.string()).optional(),
    maxActions: z.number().int().optional(),
    branchPrefixAllowlist: z.array(z.string()).optional(),
  }),
  outputSchema: z.any(),
  async execute({ instruction, mode, repos, maxActions, branchPrefixAllowlist }) {
    const lower = instruction.toLowerCase();
    const client = await getClient();
    const { audit, correlationId } = getAudit();
    const execMode = mode || 'propose';
    // Determine repos: if provided, use them; otherwise attempt to parse from instruction
    let targetRepos = repos && repos.length ? repos.slice() : [];
    if (targetRepos.length === 0) {
      // simple heuristic: look for patterns owner/repo or repo name
      const knownRepos = ['ev-share', 'cheapskate', 'thetekteam-review-defence', 'arc-aio-server-sunshine-steam-ollama-media-no-ip-ubuntu-24.04-'];
      for (const r of knownRepos) {
        if (lower.includes(r.toLowerCase())) {
          targetRepos.push(r);
        }
      }
    }
    if (targetRepos.length === 0) {
      // fallback: list repositories and use all? For safety, require explicit repos
      return { error: 'No repository specified in instruction or args. Please specify repos.' };
    }
    // Merge safe PRs
    if (/merge\s+(safe|ready)?\s*pr/.test(lower) || /merge\s+ready/.test(lower)) {
      return mergeReadyWork({ client, repos: targetRepos, mode: execMode, maxActions, correlationId, audit });
    }
    // Close stale drafts
    if (/close\s+(old|stale)?\s*draft/.test(lower)) {
      // Use closeStaleDrafts directly; summarise counts
      const olderThanDays = 30;
      const results: any[] = [];
      for (const repo of targetRepos) {
        const res = await closeStaleDrafts({ client, repos: [repo], olderThanDays, mode: execMode, correlationId, audit });
        const stale = res.results.filter((r: any) => r.status === 'stale_draft' || r.status === 'closed');
        results.push({ repo, staleDrafts: stale.map((s: any) => s.pr) });
      }
      const summary = results.some((r) => r.staleDrafts.length)
        ? `Found stale drafts in ${results.filter((r) => r.staleDrafts.length).length} repo(s).`
        : 'No stale drafts found.';
      return { summary, results };
    }
    // Delete stale branches
    if (/stale\s+branch|branch\s+cleanup|delete\s+branch|clean\s+branch/.test(lower)) {
      const results: any[] = [];
      for (const repo of targetRepos) {
        const summary = await branchCleanup({ client, repos: [repo], prefixAllowlist: branchPrefixAllowlist, mode: execMode, correlationId, audit });
        results.push({ repo, ...summary });
      }
      return results;
    }
    // Compare governance or drift or hygiene
    if (/compare\s+/.test(lower)) {
      let compareType: 'governance' | 'drift' | 'hygiene' | null = null;
      if (lower.includes('governance')) compareType = 'governance';
      else if (lower.includes('drift')) compareType = 'drift';
      else if (lower.includes('hygiene')) compareType = 'hygiene';
      if (compareType) {
        if (targetRepos.length < 2) {
          return { error: 'Comparison requires at least two repositories.' };
        }
        return compareRepos({ client, repos: targetRepos, compare: compareType });
      }
    }
    // Maintainer inbox
    if (/inbox|needs\s+attention|actionable/.test(lower)) {
      return maintainerInbox({ client, repos: targetRepos });
    }
    // Hygiene or cleanup
    if (/hygiene|cleanup/.test(lower)) {
      return runRepoHygiene({ client, repos: targetRepos, mode: execMode, correlationId, audit });
    }
    return { error: 'Instruction could not be interpreted. Please use a more specific prompt or tool.' };
  },
};

/**
 * Export all tools. Additional tools can be added here following the pattern above.
 */
export const tools: Tool<any, any>[] = [
  githubAdminGetAuthenticatedUser,
  githubAdminListRepos,
  githubAdminGetRepo,
  githubAdminListOpenPrs,
  githubAdminGetPr,
  githubAdminGetPrChecks,
  githubAdminGetPrReviews,
  githubAdminGetPrMergeReadiness,
  githubAdminListBranches,
  githubAdminFindStaleBranches,
  githubAdminMarkPrReadyForReview,
  githubAdminClosePr,
  githubAdminReopenPr,
  githubAdminMergePr,
  githubAdminDeleteBranch,
  githubAdminMergeSafePrs,
  githubAdminSweepOwnerRepos,
  githubAdminListPrsReadyToMerge,

  // Extended tools
  githubAdminApplyPrPolicy,
  githubAdminExplainWhyPrCannotMerge,
  githubAdminGetRepoGovernance,
  githubAdminCompareRepoGovernance,
  githubAdminCloseStaleDrafts,
  githubAdminDeleteMergedBranches,
  githubAdminRepoHygieneCampaign,
  githubAdminListActionablePrs,
  githubAdminListPrsWaitingOnChecks,
  githubAdminListPrsWaitingOnAuthor,
  githubAdminListPrsNeedingHumanAttention,
  githubAdminDetectRepoDrift,
  githubAdminPreviewRepoBaselineChanges,
  githubAdminApplyRepoBaseline,
  // Conversational operator tools
  githubAdminMaintainerInbox,
  githubAdminRunRepoHygiene,
  githubAdminMergeReadyWork,
  githubAdminBranchCleanup,
  githubAdminCompareRepos,
  githubAdminExplainRepoStatus,
  githubAdminInterpretAndExecute,
  githubAdminValidateConnection,
];