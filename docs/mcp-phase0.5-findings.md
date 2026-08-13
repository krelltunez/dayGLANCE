# dayGLANCE MCP Server: Phase 0.5 Findings — TCC Container Protection

**Date:** 2026-08-13
**Spec:** `docs/mcp-server-spec.md` (revision 6 applies these findings; the experiment ran against revision 5)
**Scope:** the Phase 0.5 hardware experiment from §10. Findings only — no implementation. The probe tool is `scripts/tcc-container-probe.mjs` (PR #1369), run exactly per its header.

---

## Method and environment

- **Hardware/OS:** macOS **26.6.1**. (The spec's §10 method named macOS 15 or 26; container protection applies to both.)
- **Build:** TestFlight-installed MAS build — sandboxed, container present at `~/Library/Containers/com.dayglance/`. (The method's `mas-dev` build was sufficient but not required; a TestFlight install exercises the identical sandbox/container path.)
- **Discovery file:** a test `mcp.json` placed at the §3.4 userData path inside the container, `~/Library/Containers/com.dayglance/Data/Library/Application Support/dayGLANCE/mcp.json`.
- **Reader:** `scripts/tcc-container-probe.mjs` configured as a Claude Desktop stdio entry — a node MCP server spawned by Claude Desktop, reproducing the exact responsible-process chain the real bridge would have.

## Observed

1. **A TCC consent prompt fired on first access — attributed to `node`.** Not to Claude Desktop, and not to dayGLANCE. Wording: **"node would like to access data from other apps."** The prompt appeared **twice**.
2. **Allow → the read succeeded.** Every ancestor from the container root down was traversable and the file parsed (probe result `ok: true`). The verbatim probe JSON was not retained; the probe's output fields (`ancestors`, `ok`, `content.parsed`) all reported success as described.
3. **No revocation surface.** No corresponding toggle appears anywhere in System Settings under Privacy & Security. Claude has no Files & Folders entry. The only re-trigger found was `tccutil reset SystemPolicyAppData`, which is **system-wide** (it resets the consent state for every app on the machine) and **crashed the machine once** during the experiment. That is not a safe revocation or troubleshooting path to document for users.
4. **Deny was not tested.** The sticky-denial behavior §3.4 (r5) predicted remains unverified — and is moot given the decision below.

## The prediction was wrong, in the worse direction

Revision 5's §3.4 predicted the prompt would be **attributed to Claude Desktop** — bad enough, since the user would see Claude Desktop asking about dayGLANCE's data with no context. The observed behavior is worse: attribution followed the spawned runtime binary, so the user sees **"node"** — a name that means nothing to most users, mentions neither Claude nor dayGLANCE, and gives no hint of what data is being requested or why. It fired twice, and once answered there is no visible switch to find, review, or reverse the decision.

## Decision: container discovery is DROPPED for MAS builds

Not retained as best-effort. MAS uses **manual token configuration only**.

The reasoning, recorded for posterity: the happy path requires the user to allow a prompt from an unnamed runtime with no mention of Claude or dayGLANCE — a prompt that a security-conscious user **correctly denies**. And the resulting failure is confusing rather than clean: the bridge cannot distinguish "denied" from "broken," there is no System Settings toggle to point the user at, and the only reset we found is system-wide and crashed the machine once. **A feature that fails this way is worse than an honestly manual one.** Manual token configuration is one copy-paste in a setup flow that is already manual on MAS (the bridge setup path is compiled out of the MAS binary for Guideline 2.5.2, so MAS users install the bridge by hand regardless).

Discovery is **retained** for direct-download macOS, Windows, and Linux: those builds are unsandboxed, their discovery paths live outside any app container, and no TCC container-protection path is hit at all.

## Spec changes applied (revision 6)

- **§3.4:** the MAS discovery entry and the "best-effort" paragraph replaced — no discovery file is written on MAS; manual token configuration is the only MAS path, with the reasoning above.
- **§7:** platform matrix MAS row updated (discovery: none, manual token only); the MAS-builds paragraph notes that one copy-paste is a small addition to an already manual setup.
- **§10:** Phase 0.5 marked done, pointing here.
- **§11:** the container-discovery risk row rewritten from an open contingency to a resolved outcome.

## What Phase 6 inherits

The bridge makes **no container-discovery attempt on MAS** — no read, no prompt, no code path. Discovery file reading remains in the bridge for the three unsandboxed platforms. The Phase 7 MAS documentation leads with the token copy-paste and never mentions container paths.
