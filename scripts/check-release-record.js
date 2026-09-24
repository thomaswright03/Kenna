// Checks, for a pull request into the published branch, that the iPhone
// checklist (RELEASE-CHECKLIST.md) was gone through for exactly what is
// being merged: its Record table has a "Before merging" row naming a
// commit that is part of this branch, after which nothing but the
// checklist itself changed, and whose result gives every step of the
// "Before merging" list by number ("1 passed; 2 passed; …; 13 passed").
//
// The row can't name the commit that adds it, so it names the commit
// tested, and the row is added on top of it in a commit that changes only
// RELEASE-CHECKLIST.md.
//
//   node scripts/check-release-record.js      checks HEAD of the repository it's
//                                             run in; exits 1 if not recorded
'use strict';

const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

const CHECKLIST = 'RELEASE-CHECKLIST.md';

/**
 * The numbered steps of the "Before merging" list.
 * @param {string} text the checklist
 * @returns {number[]}
 */
function beforeMergingSteps(text) {
  const section = /^## Before merging\n([\s\S]*?)^## /m.exec(text);
  if (!section) return [];
  return [...section[1].matchAll(/^(\d+)\. /gm)].map((m) => Number(m[1]));
}

/**
 * The Record table's rows.
 * @param {string} text
 * @returns {{ date: string, device: string, commit: string, part: string, result: string }[]}
 */
function recordRows(text) {
  const record = /^## Record\n([\s\S]*)$/m.exec(text);
  if (!record) return [];
  const rows = [];
  for (const line of record[1].split('\n')) {
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5 || cells[0] === 'Date' || /^-+$/.test(cells[0])) continue;
    const [date, device, commit, part, result] = cells;
    rows.push({ date, device, commit, part, result });
  }
  return rows;
}

/**
 * The steps a row's result doesn't give by number, as passed or failed.
 * @param {string} result
 * @param {number[]} steps
 */
function stepsMissing(result, steps) {
  return steps.filter((n) => !new RegExp(`(^|[^\\d])${n} (passed|failed)\\b`).test(result));
}

/**
 * @typedef {object} Git
 * @property {(ref: string) => string | null} resolve the full commit, or null when there's none
 * @property {(commit: string) => boolean} isAncestorOfHead
 * @property {(commit: string) => string[]} changedSince the files changed between `commit` and HEAD
 */

/**
 * Whether the checklist records this change, and if not, why not.
 * @param {string} text the checklist at HEAD
 * @param {Git} git
 * @returns {{ ok: true, row: ReturnType<typeof recordRows>[number] } | { ok: false, problems: string[] }}
 */
function checkRecord(text, git) {
  const steps = beforeMergingSteps(text);
  if (steps.length === 0) return { ok: false, problems: [`${CHECKLIST} has no numbered "Before merging" steps.`] };
  const rows = recordRows(text).filter((r) => /^before merging$/i.test(r.part));
  const problems = [];
  for (const row of rows.reverse()) {
    const short = (/^[0-9a-f]{7,40}\b/.exec(row.commit) || [''])[0];
    const commit = short ? git.resolve(short) : null;
    const name = `The row for ${row.commit || '(no commit)'} (${row.date})`;
    if (!commit) {
      problems.push(`${name}: that commit isn't in this repository.`);
      continue;
    }
    if (!git.isAncestorOfHead(commit)) {
      problems.push(`${name}: that commit isn't part of this pull request's branch.`);
      continue;
    }
    const changed = git.changedSince(commit).filter((f) => f !== CHECKLIST);
    if (changed.length) {
      problems.push(`${name}: the branch has changed since that commit (${changed.slice(0, 5).join(', ')}${changed.length > 5 ? ', …' : ''}), so it isn't what was tested.`);
      continue;
    }
    const missing = stepsMissing(row.result, steps);
    if (missing.length) {
      problems.push(`${name}: its result doesn't say whether step${missing.length === 1 ? '' : 's'} ${missing.join(', ')} passed or failed (write each as "3 passed" or "3 failed: why").`);
      continue;
    }
    return { ok: true, row };
  }
  if (rows.length === 0) problems.push(`${CHECKLIST} has no "Before merging" row.`);
  return { ok: false, problems };
}

/** @param {string[]} args */
function gitRun(args) {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/** @type {Git} */
const realGit = {
  resolve(ref) {
    try {
      return gitRun(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || null;
    } catch {
      return null;
    }
  },
  isAncestorOfHead(commit) {
    try {
      gitRun(['merge-base', '--is-ancestor', commit, 'HEAD']);
      return true;
    } catch {
      return false;
    }
  },
  changedSince(commit) {
    return gitRun(['diff', '--name-only', commit, 'HEAD']).split('\n').filter(Boolean);
  },
};

if (require.main === module) {
  const text = fs.readFileSync(CHECKLIST, 'utf8');
  const result = checkRecord(text, realGit);
  if (result.ok) {
    console.log(`Recorded: ${result.row.date}, ${result.row.device}, commit ${result.row.commit}: ${result.row.result}`);
  } else {
    console.error(`The iPhone checklist isn't recorded for what this pull request merges.\n- ${result.problems.join('\n- ')}`);
    console.error(`Go through "Before merging" in ${CHECKLIST} on this branch's last commit, then add its row (every step by number) in a commit that changes only ${CHECKLIST}.`);
    process.exitCode = 1;
  }
}

module.exports = { beforeMergingSteps, recordRows, stepsMissing, checkRecord };
