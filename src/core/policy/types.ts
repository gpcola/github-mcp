/**
 * Definition of a merge policy. Each field indicates a condition required for a pull request to be merged.
 */
export interface MergePolicy {
  requireNotDraft?: boolean;
  requireMergeable?: boolean;
  requireAllChecksGreen?: boolean;
  requireNoRequestedChanges?: boolean;
  requireReviewDecisionApprovedOrNone?: boolean;
  forbidIfPrBodyContains?: string[];

  /**
   * Labels that, if present on a PR, will block merging. Optional.
   */
  forbiddenLabels?: string[];
  /**
   * Labels required to be present on a PR for merging. Optional.
   */
  requiredLabels?: string[];
}

/**
 * Result of evaluating a pull request against a merge policy.
 */
export interface MergePolicyEvaluation {
  isDraft: boolean;
  isMergeable: boolean | null;
  allChecksGreen: boolean;
  hasRequestedChanges: boolean;
  reviewDecision: string | null;
  policyPass: boolean;
  blockers: string[];
}

/**
 * Default merge policy used when no custom policy is supplied. This should be conservative for safety.
 */
export const defaultMergePolicy: MergePolicy = {
  requireNotDraft: true,
  requireMergeable: true,
  requireAllChecksGreen: true,
  requireNoRequestedChanges: true,
  requireReviewDecisionApprovedOrNone: false,
  forbidIfPrBodyContains: [
    'do not merge',
    'blocked',
    'needs integrated verification',
    'not ready',
    'wip',
  ],
};