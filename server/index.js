require("dotenv").config();
const express = require("express");
const session = require("express-session");
const helmet = require("helmet");
const path = require("path");
const crypto = require("crypto");
const { Octokit } = require("@octokit/rest");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const publicDir = path.join(__dirname, "..", "public");

app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false })); // Configure a strict CSP before production.
app.use(express.json({ limit: "100kb" }));
app.use(session({
  name: "bugpilot.sid",
  secret: process.env.SESSION_SECRET || "local-development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    maxAge: 1000 * 60 * 60
  }
}));

const oauthStates = new Map();

function requireUser(req, res, next) {
  if (!req.session.githubUser || !req.session.githubToken) {
    return res.status(401).json({ error: "Sign in with GitHub before analyzing a repository." });
  }
  next();
}

function parseGitHubRepo(input) {
  try {
    const url = new URL(String(input || "").trim());
    if (url.protocol !== "https:" || !["github.com", "www.github.com"].includes(url.hostname.toLowerCase())) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0];
    const repo = parts[1].replace(/\.git$/i, "");
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)) return null;
    return { owner, repo };
  } catch { return null; }
}

app.get("/api/status", (req, res) => {
  res.json({
    ok: true,
    authenticated: Boolean(req.session.githubUser),
    user: req.session.githubUser ? { login: req.session.githubUser.login, avatar_url: req.session.githubUser.avatar_url } : null,
    dockerRunnerEnabled: process.env.ENABLE_DOCKER_RUNNER === "true"
  });
});

app.get("/auth/github", (req, res) => {
  const { GITHUB_CLIENT_ID, GITHUB_CALLBACK_URL } = process.env;
  if (!GITHUB_CLIENT_ID || !GITHUB_CALLBACK_URL) {
    return res.status(503).send("GitHub OAuth is not configured. Copy .env.example to .env and add your GitHub OAuth App credentials.");
  }
  const state = crypto.randomBytes(24).toString("hex");
  oauthStates.set(state, Date.now());
  for (const [key, created] of oauthStates) if (Date.now() - created > 10 * 60 * 1000) oauthStates.delete(key);
  const params = new URLSearchParams({
    client_id: GITHUB_CLIENT_ID,
    redirect_uri: GITHUB_CALLBACK_URL,
    scope: "read:user public_repo",
    state
  });
  res.redirect("https://github.com/login/oauth/authorize?" + params.toString());
});

app.get("/auth/github/callback", async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || !oauthStates.has(state)) return res.status(400).send("Invalid or expired OAuth state. Please try signing in again.");
  oauthStates.delete(state);
  try {
    const tokenResponse = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code
      })
    });
    const tokenData = await tokenResponse.json();
    if (!tokenData.access_token) return res.status(401).send("GitHub sign-in failed. Check OAuth app settings.");
    const octokit = new Octokit({ auth: tokenData.access_token });
    const { data: user } = await octokit.rest.users.getAuthenticated();
    req.session.githubToken = tokenData.access_token;
    req.session.githubUser = { login: user.login, avatar_url: user.avatar_url };
    res.redirect("/");
  } catch (e) {
    console.error("OAuth callback error:", e.message);
    res.status(500).send("GitHub sign-in failed. Please try again.");
  }
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// Analyze a repository using GitHub's API rather than executing or cloning untrusted code.
app.post("/api/analyze", requireUser, async (req, res) => {
  const parsed = parseGitHubRepo(req.body?.repoUrl);
  if (!parsed) return res.status(400).json({ error: "Enter a valid HTTPS GitHub repository URL, for example https://github.com/owner/repository." });

  try {
    const octokit = new Octokit({ auth: req.session.githubToken });
    const { data: repo } = await octokit.rest.repos.get({ owner: parsed.owner, repo: parsed.repo });
    if (repo.disabled || repo.archived) return res.status(400).json({ error: "This repository is archived or disabled." });
    const { data: tree } = await octokit.rest.git.getTree({
      owner: parsed.owner, repo: parsed.repo, tree_sha: repo.default_branch, recursive: "true"
    });
    const candidates = tree.tree
      .filter(x => x.type === "blob" && x.size <= 250000)
      .filter(x => /\.(js|jsx|ts|tsx|mjs|cjs|py|java|go|php|rb)$/i.test(x.path))
      .filter(x => !/(^|\/)(node_modules|vendor|dist|build|coverage|\.git)\//i.test(x.path))
      .slice(0, 80);

    const findings = [];
    let scannedFiles = 0;
    for (const item of candidates) {
      try {
        const { data: file } = await octokit.rest.repos.getContent({ owner: parsed.owner, repo: parsed.repo, path: item.path, ref: repo.default_branch });
        if (Array.isArray(file) || file.encoding !== "base64" || !file.content) continue;
        const source = Buffer.from(file.content, "base64").toString("utf8");
        scannedFiles++;
        source.split(/\r?\n/).forEach((line, idx) => {
          const checks = [
            { re: /\bdebugger\s*;?/, rule: "DEBUGGER_STATEMENT", severity: "low", title: "Debugger statement left in code", explanation: "A debugger statement can pause execution when developer tools are open.", fix: "Remove the debugger statement or guard it behind a development-only workflow." },
            { re: /\bTODO\b|\bFIXME\b/, rule: "UNRESOLVED_NOTE", severity: "info", title: "Unresolved TODO/FIXME note", explanation: "This line marks work that may be incomplete. It is a review hint, not proof of a runtime bug.", fix: "Confirm whether the work is still needed and add a tracked issue or implement the missing behavior." },
            { re: /console\.log\s*\(/, rule: "CONSOLE_LOG", severity: "info", title: "Console logging in source", explanation: "Debug logging may expose internal information or clutter production logs.", fix: "Use the project's logger and remove sensitive values from logs." },
            { re: /==\s*null|null\s*==/, rule: "LOOSE_NULL_CHECK", severity: "low", title: "Loose null comparison", explanation: "Loose null checks intentionally match both null and undefined; verify that this behavior is intended.", fix: "Keep it if matching both values is intended; otherwise use an explicit strict comparison." }
          ];
          for (const c of checks) if (c.re.test(line)) findings.push({
            id: `${item.path}:${idx + 1}:${c.rule}`, file: item.path, line: idx + 1,
            rule: c.rule, severity: c.severity, title: c.title,
            explanation: c.explanation, suggestedFix: c.fix,
            evidence: line.trim().slice(0, 240), status: "needs-review"
          });
        });
      } catch (e) {
        // Some files may be unavailable because of permissions or API limits.
      }
    }
    res.json({
      repository: `${parsed.owner}/${parsed.repo}`,
      defaultBranch: repo.default_branch,
      scannedFiles,
      truncated: candidates.length >= 80,
      findings: findings.slice(0, 200),
      summary: {
        total: findings.length,
        high: findings.filter(x => x.severity === "high").length,
        medium: findings.filter(x => x.severity === "medium").length,
        low: findings.filter(x => x.severity === "low").length,
        info: findings.filter(x => x.severity === "info").length
      },
      note: "Starter static checks only. Findings are review hints, not proof of bugs. No code was executed or changed."
    });
  } catch (e) {
    const status = e.status === 404 ? 404 : e.status === 403 ? 403 : 500;
    res.status(status).json({ error: status === 404 ? "Repository not found or your GitHub account cannot access it." : status === 403 ? "GitHub rate limit or permission limit reached." : "Repository analysis failed. Check the URL and repository permissions." });
  }
});

app.get("/api/findings-demo", (req, res) => {
  res.json({ findings: [
    { id:"src/app.js:12:DEBUGGER_STATEMENT", file:"src/app.js", line:12, severity:"low", title:"Debugger statement left in code", explanation:"Execution can pause when developer tools are open.", suggestedFix:"Remove the debugger statement.", evidence:"debugger;", status:"needs-review" },
    { id:"src/auth.js:44:CONSOLE_LOG", file:"src/auth.js", line:44, severity:"info", title:"Console logging in source", explanation:"Review whether this log could expose internal values.", suggestedFix:"Use a structured logger and never log secrets.", evidence:"console.log(user);", status:"needs-review" }
  ]});
});

app.use(express.static(publicDir));
app.get("*", (_req, res) => res.sendFile(path.join(publicDir, "index.html")));

app.listen(PORT, () => console.log(`BugPilot running at http://localhost:${PORT}`));
