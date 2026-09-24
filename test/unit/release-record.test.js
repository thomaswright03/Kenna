// scripts/check-release-record.js: a pull request into the published
// branch needs a "Before merging" row in RELEASE-CHECKLIST.md for exactly
// what it merges, with every step's result.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { beforeMergingSteps, recordRows, stepsMissing, checkRecord } = require('../../scripts/check-release-record.js');

const root = path.join(__dirname, '..', '..');
const checklist = fs.readFileSync(path.join(root, 'RELEASE-CHECKLIST.md'), 'utf8');
const every = (steps, word = 'passed') => steps.map((n) => `${n} ${word}`).join('; ');

/** The checklist with one more row in its Record table. */
const withRow = (commit, result, part = 'Before merging') => `${checklist.trimEnd()}\n| 2026-10-01 | iPhone 14, iOS 18.7.2 | ${commit} | ${part} | ${result} |\n`;

test("the checklist's Before merging steps and Record rows are read", () => {
  const steps = beforeMergingSteps(checklist);
  assert.ok(steps.length >= 10);
  assert.deepEqual(steps, steps.map((_, i) => i + 1), 'numbered 1, 2, 3…');
  const rows = recordRows(checklist);
  assert.ok(rows.length >= 1);
  for (const r of rows) assert.match(r.part, /^(Before merging|After deploy)$/);
  assert.deepEqual(stepsMissing('1 passed; 2 failed: the sheet froze; 3 passed', [1, 2, 3, 4]), [4]);
  assert.deepEqual(stepsMissing('11 passed', [1, 11]), [1], '"11" is not step 1');
  assert.deepEqual(stepsMissing('All passed', [1, 2]), [1, 2], 'not itemised');
});

// Stands in for git: `commits` maps each known commit to the files changed
// between it and HEAD; `outside` are commits that aren't on the branch.
const fakeGit = (commits, outside = []) => ({
  resolve: (ref) => Object.keys(commits).concat(outside).find((c) => c.startsWith(ref)) || null,
  isAncestorOfHead: (c) => !outside.includes(c),
  changedSince: (c) => commits[c] || [],
});

test('a row for the commit tested, followed only by the checklist, with every step, passes', () => {
  const steps = beforeMergingSteps(checklist);
  const git = fakeGit({ abcdef1234567890: ['RELEASE-CHECKLIST.md'] });
  const result = checkRecord(withRow('abcdef1', every(steps)), git);
  assert.equal(result.ok, true);
  const failed = checkRecord(withRow('abcdef1', `${every(steps.slice(0, -1))}; ${steps.length} failed: no photo library access, fixed in Settings`), git);
  assert.equal(failed.ok, true, 'a failed step, itemised, is recorded too');
});

test('a row that is missing, not itemised, stale or from elsewhere fails, saying why', () => {
  const steps = beforeMergingSteps(checklist);
  const git = fakeGit({ abcdef1234567890: ['RELEASE-CHECKLIST.md', 'docs/app.js'], '1234567abcdef': [] }, ['9999999aaaa']);
  const problems = (text) => {
    const result = checkRecord(text, git);
    assert.equal(result.ok, false);
    return result.problems.join('\n');
  };
  assert.match(problems(withRow('1234567', 'All passed')), /doesn't say whether steps 1, 2, .* passed or failed/);
  assert.match(problems(withRow('abcdef1', every(steps))), /has changed since that commit \(docs\/app\.js\)/);
  assert.match(problems(withRow('9999999', every(steps))), /isn't part of this pull request's branch/);
  assert.match(problems(withRow('fedcba9', every(steps))), /isn't in this repository/);
  assert.match(problems(withRow('1234567', every(steps), 'After deploy')), /no "Before merging" row|isn't in this repository|changed since/);
});

test('against a real repository, the row must follow the commit it names with only the checklist changed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kenna-release-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const script = path.join(root, 'scripts', 'check-release-record.js');
  const run = () => {
    try {
      execFileSync(process.execPath, [script], { cwd: dir, stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  };
  try {
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'Test');
    fs.writeFileSync(path.join(dir, 'RELEASE-CHECKLIST.md'), checklist);
    fs.writeFileSync(path.join(dir, 'app.js'), 'one');
    git('add', '.');
    git('commit', '-q', '-m', 'the change');
    const tested = git('rev-parse', '--short=7', 'HEAD');
    assert.equal(run(), false, 'no row for it yet');
    fs.writeFileSync(path.join(dir, 'RELEASE-CHECKLIST.md'), withRow(tested, every(beforeMergingSteps(checklist))));
    git('commit', '-q', '-am', 'record the iPhone run');
    assert.equal(run(), true);
    fs.writeFileSync(path.join(dir, 'app.js'), 'two');
    git('commit', '-q', '-am', 'a change after the run');
    assert.equal(run(), false, 'what is merged is no longer what was tested');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
