import { MergePolicyEvaluation, MergePolicy, defaultMergePolicy } from './types';
import { ToolError } from '../../types';

/**
 * Evaluate a pull request against a merge policy.
 * This implementation covers common checks: draft status, mergeable state, combined status checks,
 * requested changes, review approvals and optional forbidden phrases.
 * It can be extended to include more sophisticated checks (labels, path rules, linked issues).
 */
export function evaluateMergePolicy({
  pr,
  checks,
  reviews,
  policy = defaultMergePolicy,
}: {
  pr: any;
  checks: { status: any; checks: any };
  reviews: any[];
  policy?: MergePolicy;
}): MergePolicyEvaluation {
  const blockers: string[] = [];
  const isDraft = pr.draft === true;
  const isMergeable = pr.mergeable; // may be true/false/null
  const combinedState = checks.status?.state;
  const allChecksGreen = combinedState === 'success';
  const hasRequestedChanges = reviews?.some((r) => r.state === 'CHANGES_REQUESTED') || false;
  const approved = reviews?.some((r) => r.state === 'APPROVED');
  const reviewDecision: string | null = approved ? 'APPROVED' : null;

  if (policy.requireNotDraft && isDraft) {
    blockers.push('Pull request is marked as draft');
  }
  if (policy.requireMergeable && isMergeable === false) {
    blockers.push('Pull request is not mergeable (merge conflicts)');
  }
  if (policy.requireAllChecksGreen && !allChecksGreen) {
    blockers.push('Not all status checks are green');
  }
  if (policy.requireNoRequestedChanges && hasRequestedChanges) {
    blockers.push('There are requested changes');
  }
  if (policy.requireReviewDecisionApprovedOrNone && !approved) {
    blockers.push('No approved reviews');
  }
  // Check forbidden phrases in PR body
  const body: string = pr.body || '';
  if (policy.forbidIfPrBodyContains && Array.isArray(policy.forbidIfPrBodyContains)) {
    for (const phrase of policy.forbidIfPrBodyContains) {
      const pattern = new RegExp(phrase, 'i');
      if (pattern.test(body)) {
        blockers.push(`PR body contains forbidden phrase: "${phrase}"`);
      }
    }
  }

  // Label-based policies: forbid or require certain labels
  const labels: string[] = Array.isArray(pr.labels) ? pr.labels.map((l: any) => l.name || l) : [];
  // If the policy has forbiddenLabels, block if any of these labels are present
  if ((policy as any).forbiddenLabels && Array.isArray((policy as any).forbiddenLabels)) {
    for (const forbidden of (policy as any).forbiddenLabels) {
      if (labels.includes(forbidden)) {
        blockers.push(`PR has forbidden label: ${forbidden}`);
      }
    }
  }
  // If the policy has requiredLabels, ensure all are present
  if ((policy as any).requiredLabels && Array.isArray((policy as any).requiredLabels)) {
    for (const required of (policy as any).requiredLabels) {
      if (!labels.includes(required)) {
        blockers.push(`PR missing required label: ${required}`);
      }
    }
  }
  // TODO: Extend with label-based and path-based policies
  const policyPass = blockers.length === 0;
  return {
    isDraft,
    isMergeable,
    allChecksGreen,
    hasRequestedChanges,
    reviewDecision,
    policyPass,
    blockers,
  };
}