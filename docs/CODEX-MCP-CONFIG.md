# Configuring github-admin-mcp for Codex

Codex can connect to local MCP servers via its configuration file. Follow these steps to register `github-admin-mcp`:

1. **Build and start the server**

   ```bash
   pnpm install
   pnpm run build
   node dist/mcp/index.js
   ```

2. **Add the MCP server in Codex**

   Run the Codex CLI command to register the MCP with a name. Replace `/path/to/github-admin-mcp` with the absolute path to your clone and provide your GitHub PAT:

   ```bash
   codex mcp add github-admin \
     --env GITHUB_TOKEN=YOUR_PAT \
     -- node /path/to/github-admin-mcp/dist/mcp/index.js
   ```

   Codex stores the configuration in `~/.codex/config.toml`【640636928422806†L616-L663】. You can also edit the TOML file manually by adding a `[mcp_servers.github-admin]` section with `command`, `args` and `env` fields if you prefer.

3. **Use natural language in Codex**

   Once added, the MCP is available in Codex sessions. You can now type prompts such as:

   - “Merge any safe PRs in ev-share.”
   - “Run repo hygiene on cheapskate and ev-share, but only propose the actions.”
   - “Compare governance between ev-share and cheapskate.”

   Codex will call the appropriate operator tool through the MCP.

4. **Removing the MCP**

   If you no longer need the MCP, remove it using:

   ```bash
   codex mcp remove github-admin
   ```

See [Codex documentation](https://developers.openai.com/codex/cli/reference) for further details.