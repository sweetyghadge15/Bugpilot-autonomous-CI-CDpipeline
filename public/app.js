const $ = (s) => document.querySelector(s);
const state = { findings: [], filter: "all", authenticated: false, busy: false };
let toastTimer;
function toast(message) {
  const el = $("#toast"); el.textContent = message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove("show"), 3500);
}
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c])); }
function severityClass(s) { return ["high","medium","low","info"].includes(s) ? s : "info"; }
function renderFindings() {
  const filtered = state.findings.filter(f => state.filter === "all" ||
    (state.filter === "low" ? ["low","info"].includes(f.severity) : f.severity === state.filter));
  $("#sidebar-count").textContent = state.findings.length;
  $("#all-count").textContent = state.findings.length;
  $("#findings-value").textContent = state.findings.length;
  document.querySelectorAll(".tab").forEach(t => t.classList.toggle("active", t.dataset.filter === state.filter));
  if (!filtered.length) {
    $("#findings-list").innerHTML = `<div class="empty-state"><div class="empty-graphic"><span>✓</span></div><h3>${state.findings.length ? "No findings in this filter" : "No findings yet"}</h3><p>${state.findings.length ? "Choose another severity filter to view other results." : "Analyze a repository or load sample results to see the findings view."}</p></div>`;
    return;
  }
  $("#findings-list").innerHTML = filtered.map(f => {
    const sev = severityClass(f.severity);
    return `<article class="finding"><div class="finding-main"><span class="severity-mark sev-${sev}"></span><div class="finding-content"><div class="finding-title-row"><span class="finding-title">${esc(f.title)}</span><span class="severity-label ${sev}">${esc(sev)}</span></div><div class="file-path">${esc(f.file)} <b>· line ${Number(f.line)||"?"}</b></div><p class="finding-explanation">${esc(f.explanation)}</p>${f.evidence ? `<div class="code-evidence">${esc(f.evidence)}</div>` : ""}</div></div><div class="fix-row"><strong>Suggested next step</strong><span>${esc(f.suggestedFix || "Review the affected code and add a regression test before changing it.")}</span></div></article>`;
  }).join("");
}
async function loadStatus() {
  try {
    const r = await fetch("/api/status"); const d = await r.json();
    state.authenticated = d.authenticated;
    if (d.authenticated && d.user) {
      $("#user-name").textContent = d.user.login;
      $("#user-state").textContent = "GitHub connected";
      $("#avatar").textContent = d.user.login.slice(0,1).toUpperCase();
      $("#auth-title").textContent = `Connected as @${d.user.login}`;
      $("#auth-description").textContent = "You can analyze repositories accessible to this GitHub account.";
      $("#github-login").textContent = "Connected ✓"; $("#github-login").removeAttribute("href");
      $("#github-login").classList.add("button-outline");
      $("#logout").classList.remove("hidden");
      $("#connection-status").textContent = "GitHub connected";
      $("#connection-status").previousElementSibling.style.background = "#20b779";
    } else {
      $("#connection-status").textContent = "Demo mode";
    }
    if (d.dockerRunnerEnabled) {
      $("#docker-status").textContent = "Runner enabled — verify isolation";
      $("#docker-status").className = "status-pill status-pending";
    }
  } catch {}
}
$("#analyze-form").addEventListener("submit", async e => {
  e.preventDefault();
  const repoUrl = $("#repo-url").value.trim();
  if (!/^https:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/.test(repoUrl)) return toast("Enter a valid HTTPS GitHub repository URL.");
  if (!state.authenticated) return toast("Please sign in with GitHub before analyzing a repository.");
  if (state.busy) return;
  state.busy = true;
  const btn = $("#analyze-button"); btn.disabled = true; btn.textContent = "Analyzing…";
  $("#repair-value").textContent = "Scanning";
  try {
    const r = await fetch("/api/analyze", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({repoUrl}) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || "Analysis failed.");
    state.findings = d.findings || []; state.filter = "all";
    $("#files-value").textContent = d.scannedFiles ?? "—";
    $("#results-subtitle").textContent = `${d.repository} · branch ${d.defaultBranch} · ${d.scannedFiles} source files scanned`;
    $("#repair-value").textContent = "Review";
    $("#analysis-note").innerHTML = `<span>ⓘ</span><span>${esc(d.note || "Review all findings before changing code.")}${d.truncated ? " File scan was capped; not all source files were inspected." : ""}</span>`;
    renderFindings(); toast(`Analysis complete: ${state.findings.length} finding(s) to review.`);
    $("#findings").scrollIntoView({behavior:"smooth", block:"start"});
  } catch (err) { $("#repair-value").textContent = "Ready"; toast(err.message); }
  finally { state.busy = false; btn.disabled = false; btn.innerHTML = "<span>⌕</span> Analyze repository"; }
});
$("#demo-button").addEventListener("click", async () => {
  const r = await fetch("/api/findings-demo"); const d = await r.json();
  state.findings = d.findings || []; state.filter = "all";
  $("#files-value").textContent = "24"; $("#results-subtitle").textContent = "Sample repository · demonstration data only";
  $("#repair-value").textContent = "Review"; $("#analysis-note").innerHTML = "<span>ⓘ</span><span>These are illustrative findings. They were not discovered in your repository and no code was executed or changed.</span>";
  renderFindings(); toast("Loaded sample results. No repository was accessed.");
});
document.querySelectorAll(".tab").forEach(t => t.addEventListener("click", () => { state.filter = t.dataset.filter; renderFindings(); }));
$("#logout").addEventListener("click", async () => { await fetch("/auth/logout", {method:"POST"}); location.reload(); });
$("#repair-info").addEventListener("click", () => toast("Next stage: generate a small patch, show a diff, and require user approval."));
$("#docker-info").addEventListener("click", () => toast("Use a disposable worker container with CPU, memory, time, process, filesystem, and network limits. Never expose host secrets or the Docker socket."));
$("#pr-info").addEventListener("click", () => toast("Next stage: create a branch, show the final diff and passing test evidence, then ask the user to approve the pull request."));
loadStatus();