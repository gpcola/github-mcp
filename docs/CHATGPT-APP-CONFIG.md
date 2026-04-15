# Configuring github-admin-mcp for ChatGPT

You can integrate `github-admin-mcp` into ChatGPT web via the Apps feature. Follow these steps:

1. **Start the MCP server**

   Build and run the server locally, ensuring that the `GITHUB_TOKEN` environment variable is set or that a `.env` file exists:

   ```bash
   pnpm install
   pnpm run build
   node dist/mcp/index.js
   ```

2. **Open ChatGPT settings**

   In ChatGPT web, click your name in the bottom‑left corner and choose **Settings → Apps**. Click **Create a new app**. Select **Custom MCP** as the type.

3. **Configure the MCP app**

   Provide a name (e.g. “GitHub Admin MCP”). For the command, use the same command you used to run the MCP in your terminal. If the MCP is listening on stdio (the default), leave the transport type as **Stdio**. Set the environment variables section to include `GITHUB_TOKEN=YOUR_PAT`.

   If you have added an HTTP transport to the MCP, you can instead choose **HTTP** and provide the URL.

4. **Enable and use the app**

   Save the app and enable it in your chat session. The new operator tools—maintainer inbox, run repo hygiene, merge ready work, branch cleanup, compare repos, explain repo status, interpret and execute, validate connection—will appear in the tool picker. You can now type prompts such as “Close old draft PRs across my repos” or “Why can’t PR 46 merge in ev-share?” and ChatGPT will automatically call the appropriate tool.

Refer to the Chat Prompt Examples for more ideas.