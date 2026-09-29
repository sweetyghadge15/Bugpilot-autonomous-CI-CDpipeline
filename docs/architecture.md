# Architecture and implementation roadmap

## MVP data flow
Browser UI → Express session → GitHub OAuth → GitHub API → bounded source-file scan → findings with path, line, evidence, explanation, suggested next step.

## Target production data flow
1. GitHub App authentication and installation permissions.
2. API validates repository access and creates an analysis job.
3. Queue dispatches to a disposable analysis worker.
4. Worker checks out the selected commit SHA and records the exact revision.
5. Static analysis and project tests run in an isolated sandbox.
6. Repair engine proposes a minimal patch and creates/updates a regression test.
7. Sandbox runs tests again; system compares baseline and patched outcomes.
8. UI presents diff, test logs, risks, and confidence evidence.
9. User explicitly approves; publisher creates a branch and pull request.
10. Audit record links repository, commit SHA, patch, tests, user approval, and PR URL.

## Suggested later data model
- User: GitHub identity and encrypted provider token reference.
- Repository: provider ID, owner/name, installation ID, selected default branch.
- AnalysisJob: repository ID, commit SHA, state, createdAt, completedAt.
- Finding: job ID, rule/model, file, line range, severity, explanation, evidence.
- Patch: job ID, unified diff, test result, approval status.
- PullRequest: patch ID, branch, PR number/URL, status.

## Status states
Queued → Fetching → Analyzing → Repair proposed → Testing → Needs review → Approved → PR opened.
Failure states should include a clear reason and allow safe retry.
