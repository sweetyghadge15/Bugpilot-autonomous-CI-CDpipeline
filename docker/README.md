# Docker sandbox design notes

Do not run arbitrary repository code inside the Express web process. Implement this as a separate worker service.

Minimum controls for a future worker:
- Run as a non-root user, with no Docker socket mounted inside the workload.
- Use a disposable container and a read-only base image where possible.
- Apply strict CPU, memory, process-count, and wall-clock limits.
- Disable network access by default; allow only specific package mirrors if required.
- Do not pass GitHub tokens, session cookies, environment secrets, or cloud credentials into the test container.
- Mount only the job workspace, with controlled permissions.
- Set a restrictive seccomp/AppArmor profile and drop Linux capabilities.
- Cap logs and artifact sizes; remove container and workspace after the job.
- Treat package install scripts and test code as untrusted.
- Record the command template and test exit status. Never execute shell commands supplied by a repository or user without a strict allowlist.

The MVP intentionally does not launch Docker containers. Setting ENABLE_DOCKER_RUNNER=true only changes the UI status; it does not make sandbox execution implemented or safe.
