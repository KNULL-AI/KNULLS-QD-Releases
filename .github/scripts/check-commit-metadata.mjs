import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Public repository policy only. No application source, credentials or user data.
const allowedEmail = (value) => {
  const email = String(value || '').trim().toLowerCase();
  return email === 'dev@knull.local' || email === 'noreply@github.com'
    || /^(?:\d+\+)?[a-z0-9][a-z0-9-]*(?:\[bot\])?@users\.noreply\.github\.com$/.test(email);
};
const oid = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
const findings = [];
let count = 0;
const git = (args, input) => {
  try {
    return execFileSync('git', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).trim();
  } catch { throw new Error('git-history-unavailable'); }
};
function identity(raw, role, object) {
  const match = /^([^<>\r\n]+) <([^<>\r\n]+)>\s+\d+\s+[+-]\d{4}$/.exec(String(raw));
  if (!match || !allowedEmail(match[2])) findings.push({ object, role });
  if (match && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(match[1])) findings.push({ object, role: `${role}-name` });
}
function peel(object) {
  if (!oid(object) || /^0+$/.test(object)) throw new Error('invalid-history-boundary');
  const commit = git(['rev-parse', '--verify', `${object}^{commit}`]);
  if (!oid(commit)) throw new Error('invalid-history-boundary');
  return commit;
}
function check(head, base) {
  const tip = peel(head);
  const from = base && !/^0+$/.test(base) ? peel(base) : null;
  const objects = git(['rev-list', '--stdin'], [tip, ...(from ? [`^${from}`] : [])].join('\n') + '\n');
  for (const object of objects.split('\n').filter(Boolean)) {
    if (!oid(object)) throw new Error('invalid-history-object');
    const header = git(['cat-file', '-p', object]).split(/\r?\n\r?\n/, 1)[0];
    identity(/^author (.+)$/m.exec(header)?.[1], 'author', object);
    identity(/^committer (.+)$/m.exec(header)?.[1], 'committer', object);
    count++;
  }
  let object = head;
  const seen = new Set();
  while (git(['cat-file', '-t', object]) === 'tag') {
    if (seen.has(object) || seen.size >= 32) throw new Error('invalid-tag-chain');
    seen.add(object);
    const header = git(['cat-file', '-p', object]).split(/\r?\n\r?\n/, 1)[0];
    identity(/^tagger (.+)$/m.exec(header)?.[1], 'tagger', object);
    object = /^object ([a-f0-9]+)$/m.exec(header)?.[1];
    if (!oid(object)) throw new Error('invalid-tag-chain');
  }
}
try {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
    check(event.pull_request.head.sha, event.pull_request.base.sha);
  } else if (process.env.GITHUB_EVENT_NAME === 'push') {
    if (!event.deleted) check(event.after, event.before);
  } else throw new Error('unsupported-event');
  if (findings.length) {
    console.error('Commit metadata privacy failed. Replace personal identities in affected commits before publishing.');
    for (const { object, role } of findings.slice(0, 25)) console.error(`  ${object.slice(0, 12)}: ${role} email`);
    if (findings.length > 25) console.error(`  ${findings.length - 25} additional findings`);
    console.error('Values redacted. Use your own GitHub noreply identity for both author and committer.');
    process.exitCode = 1;
  } else console.log(`Commit metadata privacy passed: ${count} commits checked.`);
} catch (error) {
  const reason = /^(?:git-history-unavailable|invalid-history-boundary|invalid-history-object|invalid-tag-chain|unsupported-event)$/.test(error?.message || '') ? error.message : 'check-unavailable';
  console.error(`Commit metadata privacy failed: ${reason}. No unverified history is considered clean.`);
  process.exitCode = 1;
}
