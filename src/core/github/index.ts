import { ToolError } from '../../types';

/**
 * Minimal GitHub REST client using the native fetch API. Provides wrappers for common operations.
 * The client reads a personal access token from the GITHUB_TOKEN environment variable on construction.
 */
export class GitHubClient {
  private readonly token: string;
  private readonly baseUrl: string = 'https://api.github.com';

  constructor() {
    const envToken = process.env.GITHUB_TOKEN;
    if (!envToken) {
      throw new ToolError(
        'GITHUB_TOKEN environment variable is missing. Set a Personal Access Token with repo administration scopes.',
      );
    }
    this.token = envToken;
  }

  /**
   * Generic request helper. Wraps fetch with authentication and basic error handling.
   */
  private async request<T>(method: string, path: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${this.token}`,
      'User-Agent': 'github-admin-mcp/0.2',
    };
    const res = await fetch(url, {
      method,
      headers: { ...headers, ...(init.headers || {}) },
      body: init.body ? init.body : undefined,
    });
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      try {
        const data = await res.json();
        if (data && data.message) {
          message = `${message}: ${data.message}`;
        }
      } catch {
        // ignore
      }
      throw new ToolError(message);
    }
    if (res.status === 204) {
      return undefined as unknown as T;
    }
    const data = (await res.json()) as T;
    return data;
  }

  /**
   * Validate the current token by calling the /user endpoint. Returns login and scopes if available.
   */
  async validateAuthentication(): Promise<{ login: string; scopes: string[] }> {
    const res = await fetch(`${this.baseUrl}/user`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${this.token}`,
        'User-Agent': 'github-admin-mcp/0.2',
      },
    });
    if (!res.ok) {
      throw new ToolError(`Failed to authenticate with GitHub: ${res.status} ${res.statusText}`);
    }
    const loginData = (await res.json()) as { login: string };
    const scopesHeader = res.headers.get('x-oauth-scopes') || res.headers.get('X-OAuth-Scopes');
    const scopes = scopesHeader ? scopesHeader.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return { login: loginData.login, scopes };
  }

  // ======= USER AND REPOSITORY ENDPOINTS =======

  async getAuthenticatedUser() {
    return this.request<any>('GET', '/user');
  }

  async listRepositories(params: {
    owner?: string;
    visibility?: 'all' | 'public' | 'private';
    affiliation?: string;
    archived?: boolean;
    per_page?: number;
    page?: number;
  } = {}) {
    const query: Record<string, string> = {};
    if (params.visibility) query.visibility = params.visibility;
    if (params.affiliation) query.affiliation = params.affiliation;
    if (typeof params.archived === 'boolean') query.archived = String(params.archived);
    if (params.per_page) query.per_page = String(params.per_page);
    if (params.page) query.page = String(params.page);
    const qs = Object.keys(query).length > 0
      ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    if (params.owner) {
      return this.request<any[]>('GET', `/users/${encodeURIComponent(params.owner)}/repos${qs}`);
    }
    return this.request<any[]>('GET', `/user/repos${qs}`);
  }

  async getRepo(fullName: string) {
    const [owner, repo] = fullName.split('/');
    return this.request<any>('GET', `/repos/${owner}/${repo}`);
  }

  async listPulls(params: {
    repoFullName: string;
    state?: 'open' | 'closed' | 'all';
    base?: string;
    head?: string;
    draft?: boolean;
    author?: string;
    per_page?: number;
    page?: number;
  }) {
    const [owner, repo] = params.repoFullName.split('/');
    const query: Record<string, string> = { state: params.state || 'open' };
    if (params.base) query.base = params.base;
    if (params.head) query.head = params.head;
    if (typeof params.draft === 'boolean') query.draft = String(params.draft);
    if (params.author) query.author = params.author;
    if (params.per_page) query.per_page = String(params.per_page);
    if (params.page) query.page = String(params.page);
    const qs = Object.keys(query).length > 0
      ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return this.request<any[]>(
      'GET',
      `/repos/${owner}/${repo}/pulls${qs}`,
    );
  }

  async getPull(params: { repoFullName: string; number: number }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>('GET', `/repos/${owner}/${repo}/pulls/${params.number}`);
  }

  async getPullReviews(params: { repoFullName: string; number: number }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any[]>(
      'GET',
      `/repos/${owner}/${repo}/pulls/${params.number}/reviews`,
    );
  }

  async getCommitChecks(params: { repoFullName: string; sha: string }) {
    const [owner, repo] = params.repoFullName.split('/');
    const statusPromise = this.request<any>('GET', `/repos/${owner}/${repo}/commits/${params.sha}/status`);
    const checksPromise = this.request<any>(
      'GET',
      `/repos/${owner}/${repo}/commits/${params.sha}/check-runs`,
    );
    const [status, checks] = await Promise.all([statusPromise, checksPromise]);
    return { status, checks };
  }

  async listBranches(params: { repoFullName: string; per_page?: number; page?: number }) {
    const [owner, repo] = params.repoFullName.split('/');
    const query: Record<string, string> = {};
    if (params.per_page) query.per_page = String(params.per_page);
    if (params.page) query.page = String(params.page);
    const qs = Object.keys(query).length > 0
      ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return this.request<any[]>(
      'GET',
      `/repos/${owner}/${repo}/branches${qs}`,
    );
  }

  async getBranch(params: { repoFullName: string; branch: string }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>(
      'GET',
      `/repos/${owner}/${repo}/branches/${encodeURIComponent(params.branch)}`,
    );
  }

  async deleteBranch(params: { repoFullName: string; branch: string }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>(
      'DELETE',
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(params.branch)}`,
    );
  }

  /**
   * Get branch protection settings for a given branch. Returns undefined if protections are not enabled or
   * the authenticated token lacks permission.
   */
  async getBranchProtection(params: { repoFullName: string; branch: string }): Promise<any | undefined> {
    const [owner, repo] = params.repoFullName.split('/');
    try {
      return await this.request<any>('GET', `/repos/${owner}/${repo}/branches/${encodeURIComponent(params.branch)}/protection`);
    } catch (err) {
      // If protections not enabled or access denied, return undefined
      return undefined;
    }
  }

  /**
   * List files changed in a pull request. Returns an array of objects including filename and status.
   */
  async listPrFiles(params: { repoFullName: string; number: number; per_page?: number; page?: number }): Promise<any[]> {
    const [owner, repo] = params.repoFullName.split('/');
    const query: Record<string, string> = {};
    if (params.per_page) query.per_page = String(params.per_page);
    if (params.page) query.page = String(params.page);
    const qs = Object.keys(query).length > 0
      ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return this.request<any[]>(
      'GET',
      `/repos/${owner}/${repo}/pulls/${params.number}/files${qs}`,
    );
  }

  /**
   * List workflow runs for a repository. Accepts optional status and branch filters.
   */
  async listWorkflowRuns(params: { repoFullName: string; status?: string; branch?: string; per_page?: number; page?: number }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    const query: Record<string, string> = {};
    if (params.status) query.status = params.status;
    if (params.branch) query.branch = params.branch;
    if (params.per_page) query.per_page = String(params.per_page);
    if (params.page) query.page = String(params.page);
    const qs = Object.keys(query).length > 0
      ? '?' + Object.entries(query).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';
    return this.request<any>('GET', `/repos/${owner}/${repo}/actions/runs${qs}`);
  }

  /**
   * Get details about a single workflow run.
   */
  async getWorkflowRun(params: { repoFullName: string; runId: number }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>('GET', `/repos/${owner}/${repo}/actions/runs/${params.runId}`);
  }

  /**
   * Rerun a failed workflow run.
   */
  async rerunWorkflowRun(params: { repoFullName: string; runId: number }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>('POST', `/repos/${owner}/${repo}/actions/runs/${params.runId}/rerun`);
  }

  /**
   * Cancel a workflow run.
   */
  async cancelWorkflowRun(params: { repoFullName: string; runId: number }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>('POST', `/repos/${owner}/${repo}/actions/runs/${params.runId}/cancel`);
  }

  /**
   * Dispatch a workflow. Accepts workflow_id or file name and ref (branch or tag) along with inputs.
   */
  async dispatchWorkflow(params: { repoFullName: string; workflowId: string | number; ref: string; inputs?: Record<string, any> }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    const body: any = { ref: params.ref };
    if (params.inputs) body.inputs = params.inputs;
    return this.request<any>('POST', `/repos/${owner}/${repo}/actions/workflows/${params.workflowId}/dispatches`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  /**
   * Update repository settings. Accepts a partial object of settings to patch.
   */
  async updateRepoSettings(params: { repoFullName: string; settings: Record<string, any> }): Promise<any> {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>('PATCH', `/repos/${owner}/${repo}`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.settings),
    });
  }

  async markPrReadyForReview(params: { repoFullName: string; number: number }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>(
      'POST',
      `/repos/${owner}/${repo}/pulls/${params.number}/ready_for_review`,
    );
  }

  async updatePullState(params: { repoFullName: string; number: number; state: 'open' | 'closed' }) {
    const [owner, repo] = params.repoFullName.split('/');
    return this.request<any>(
      'PATCH',
      `/repos/${owner}/${repo}/pulls/${params.number}`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: params.state }),
      },
    );
  }

  async mergePullRequest(params: {
    repoFullName: string;
    number: number;
    mergeMethod?: 'merge' | 'squash' | 'rebase';
    commitTitle?: string;
    commitMessage?: string;
  }) {
    const [owner, repo] = params.repoFullName.split('/');
    const body: any = {};
    if (params.mergeMethod) body.merge_method = params.mergeMethod;
    if (params.commitTitle) body.commit_title = params.commitTitle;
    if (params.commitMessage) body.commit_message = params.commitMessage;
    return this.request<any>(
      'PUT',
      `/repos/${owner}/${repo}/pulls/${params.number}/merge`,
      {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
    );
  }

  async enableAutoMerge(params: { repoFullName: string; number: number }) {
    // GitHub API for enabling auto-merge is currently in GraphQL; we attempt using REST for limited support
    // Note: This may not work for all repos; catch errors gracefully.
    const [owner, repo] = params.repoFullName.split('/');
    try {
      return await this.request<any>(
        'PUT',
        `/repos/${owner}/${repo}/pulls/${params.number}/merge?auto_merge=true`,
      );
    } catch (err) {
      throw new ToolError('Auto-merge enabling is not supported or failed');
    }
  }
}