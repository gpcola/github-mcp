import { describe, it, expect } from 'vitest';
import { evaluateMergePolicy } from '../src/core/policy/merge';
import { defaultMergePolicy } from '../src/core/policy';

describe('evaluateMergePolicy', () => {
  it('passes when all conditions met', () => {
    const pr = { draft: false, mergeable: true, body: 'Ready' };
    const checks = { status: { state: 'success' }, checks: {} };
    const reviews: any[] = [{ state: 'APPROVED' }];
    const result = evaluateMergePolicy({ pr, checks, reviews, policy: defaultMergePolicy });
    expect(result.policyPass).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });
  it('blocks draft PR', () => {
    const pr = { draft: true, mergeable: true, body: 'Ready' };
    const checks = { status: { state: 'success' }, checks: {} };
    const reviews: any[] = [{ state: 'APPROVED' }];
    const result = evaluateMergePolicy({ pr, checks, reviews, policy: defaultMergePolicy });
    expect(result.policyPass).toBe(false);
    expect(result.blockers).toContain('Pull request is marked as draft');
  });
});