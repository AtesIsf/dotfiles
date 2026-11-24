export const meta = {
  name: 'garv',
  description: 'Adversarial bug hunt: scout -> planner -> worker -> referee, retried up to 2x on disqualification',
  phases: [{ title: 'Scout' }, { title: 'Plan' }, { title: 'Write tests' }, { title: 'Referee' }],
}

// args: target description (string) or { target }
const target = (typeof args === 'string' ? args : args?.target) || 'the current repository'
const MAX_ATTEMPTS = 3

const VERDICT = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['CERTIFIED', 'DISQUALIFIED'] },
    reason: { type: 'string', description: 'Disqualification reason, or one-line summary when certified' },
    report: { type: 'string', description: 'Full Bounty Board report (CERTIFIED) or Disqualification report (DISQUALIFIED), markdown' },
  },
  required: ['verdict', 'reason', 'report'],
}

const recon = await agent(
  `Perform reconnaissance on ${target} for adversarial bug hunting:
1. Inspect target source files, public APIs, type definitions, docstrings, and invariants.
2. Identify the designated test directory (e.g. tests/, test/, spec/, *_test.go) and existing test conventions.
3. Determine the native test runner and execution command (e.g. pytest, cargo test, npm test, go test ./...).
4. If hardware/firmware or low-level protocols are involved, consult relevant manuals.
5. Output a structured Reconnaissance Report: target components, native test command, test directory path, and high-signal contract invariants/boundaries.`,
  { label: 'scout', phase: 'Scout', agentType: 'scout' },
)

let feedback = ''
let result
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
  const plan = await agent(
    `Develop an adversarial Garv test plan based on this reconnaissance report:

${recon}
${feedback}
Enforce the Three Golden Rules:
1. Strict Blast Radius: plan tests ONLY inside designated test directories. Never touch production code.
2. Absolute Legitimacy: zero fake failures. Every test asserts genuine specifications, API contracts, docstrings, or RFCs. No assertions contradicting documented behavior, no mock sabotage.
3. Ogur Minimalism: Arrange-Act-Assert, zero bloat, no unnecessary dependencies.

Target high-value defects:
- Crashes, panics, unhandled exceptions, deadlocks, infinite loops (+50)
- State desync, off-by-one, boundary conditions, truncation (+25)
- Contract/protocol/schema non-compliance (+15)
- Memory safety, injection, auth, crypto flaws (+100)

Output an Adversarial Test Plan: test file paths, invariant hypotheses, expected vs. failure conditions, and the native test command.`,
    { label: `planner #${attempt}`, phase: 'Plan', agentType: 'planner' },
  )

  const work = await agent(
    `Execute this Garv adversarial test plan:

${plan}

Rules:
1. You are strictly a test author. Create/edit files ONLY inside designated test directories. NEVER touch application or production code.
2. Write Ogur-style tests: clean, minimal Arrange-Act-Assert using the native framework.
3. Run the native test command and observe real results.
4. Output: created/modified test files, the exact test command and its output, and candidate failing tests (bugs) vs. passing tests.`,
    { label: `worker #${attempt}`, phase: 'Write tests', agentType: 'worker' },
  )

  result = await agent(
    `You are the official Garv Referee. Audit the tests just authored and executed by the worker:

${work}

Checklist:
1. BLAST RADIUS: run \`git status\` and \`git diff\`. Only files in designated test directories may be created or modified. Any non-test file touched -> DISQUALIFIED; revert the offending files yourself (\`git checkout -- <file>\` for tracked, \`rm\` for untracked).
2. LEGITIMACY: for every failing test, cross-check the assertion against the code contract, docstring, or spec. It must be a REAL bug, not a faked expectation or mock sabotage. Invalid tests -> DISQUALIFIED; revert them.
3. OGUR SIMPLICITY: tests are clean and minimal.
4. VERDICT:
   - Any rule broken: verdict DISQUALIFIED, reason = exact reason, report = what was invalid and what you reverted.
   - Clean: verdict CERTIFIED, report = the full Bounty Board below.

Scoring: +100 Critical vulnerability, +50 Fatal crash/panic/deadlock, +25 Logic bug/desync, +15 Contract mismatch, 0 passing tests.
Ranks: Scout (1-25) / Tracker (26-75) / Senior Auditor (76-150) / Master Bug Hunter (151+).

Report format:
# 🎯 Garv Bounty Report: [Target Component]
**Referee Status**: ✅ CERTIFIED (Audited by Referee Subagent)
**Total Bounty Score**: [Total] pts | **Rank**: [Rank]

### 🏆 Legitimate Defects Uncovered
| # | Severity / Category | Test File & Function | Points | Bug Description |
|---|---------------------|----------------------|:------:|-----------------|

### 🔍 Defect Details & Recommended Patches
#### Bug N: [Short Title]
* **Failing Test**: \`path::test_name\`
* **Reproduction Command**: \`...\`
* **Root Cause Analysis**: [2 lines]
* **Suggested Patch** *(Garv does not edit production code)*:
\`\`\`diff
[unified diff]
\`\`\``,
    { label: `referee #${attempt}`, phase: 'Referee', agentType: 'reviewer', schema: VERDICT },
  )

  if (result.verdict === 'CERTIFIED') return { attempts: attempt, ...result }

  feedback = `
PRIOR ATTEMPT DISQUALIFICATION FEEDBACK:
${result.reason}

CORRECTIVE DIRECTIVE:
Do NOT repeat the invalidated assumptions, false assertions, or blast radius breaches above. Focus exclusively on legitimate, ground-truth contracts and docstring invariants.
`
}

return { attempts: MAX_ATTEMPTS, ...result }
