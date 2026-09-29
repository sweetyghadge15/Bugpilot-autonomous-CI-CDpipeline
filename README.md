# BugPilot — Autonomous Code Repair (MVP starter)

BugPilot is a starter web app for the project described: a user signs in with GitHub, submits a repository URL, sees detected issues, reviews suggested fixes, and eventually opens a pull request.

## What works in this starter
- Website dashboard (not a task-manager-only UI) with repository submission and analysis results.
- GitHub OAuth flow scaffold using environment variables.
- Repository URL validation and safe, allowlisted repository fetching through GitHub's API.
- Starter static checks for JavaScript/TypeScript-like source text: `debugger` statements, `console.log`, `TODO/FIXME`, and simple suspicious patterns.
- Clear findings with file names, line numbers, severity, and explanation.
- Secure-by-default: Docker execution and PR creation are not enabled as automatic actions.

## What is not production-ready yet
- Static checks are demonstrations, not a complete AI bug detector.
- No autonomous patch generation is claimed. The UI presents a proposed repair plan for each rule-based finding.
- Docker execution must be implemented in a separate isolated worker with CPU, memory, time, filesystem, network, and process limits. Do not run untrusted repositories on the web server.
- Pull-request creation requires an explicit user review/approval step and GitHub permissions. This starter does not push code automatically.
- Add a persistent database, job queue, rate limiting, audit logs, CSRF protection, monitoring, and production secret management before deployment.

## Run locally
1. Install Node.js 20+ and Git.
2. Copy `.env.example` to `.env` and set a long random `SESSION_SECRET`.
3. Create a GitHub OAuth App. Set callback URL to `http://localhost:3000/auth/github/callback`, then set the client ID and secret in `.env`.
4. Install and start:
   ```bash
   npm install
   npm start
   ```
5. Open `http://localhost:3000`.

Without GitHub credentials, the dashboard still loads; the GitHub sign-in button will show an authentication setup error.

## Suggested GitHub OAuth permissions
Use the minimum scopes needed for the MVP. Reading public repositories can be done without write permissions. Add private repository access only when necessary. For later PR creation, request repository contents and pull-request write permissions through a GitHub App installation flow where possible. Explain requested access clearly to users.

## Recommended implementation stages
1. **MVP UI + repository checks** (this starter).
2. GitHub App auth and secure private-repo access.
3. Worker queue and isolated Docker runner; clone only an authorized repository into a disposable workspace.
4. Run project-specific tests/lint/build in a container with strict limits and no secrets.
5. Generate a patch from deterministic rules first; later add a pluggable model/provider if allowed.
6. Re-run tests and compare baseline vs patched results.
7. Show diff and evidence; require human approval.
8. Create a branch and pull request using narrowly scoped GitHub permissions.

## Safety architecture
Never pass user-supplied shell commands to a host shell. Do not mount the Docker socket into application containers. Treat repository code, filenames, logs, and test output as untrusted data. Disable network access by default for test containers. Use disposable containers and remove them after every job.
