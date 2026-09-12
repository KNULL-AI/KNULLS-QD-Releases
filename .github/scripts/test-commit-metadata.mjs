import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createMetadataInspector, isPrivateCommitEmail } from './commitMetadataPrivacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'commit-metadata-privacy-'));
const repo = path.join(temporary, 'work');
const remote = path.join(temporary, 'remote.git');
const cli = path.join(root, '.github/scripts/check-commit-metadata.mjs');
const syntheticMailbox = ['fixture', 'person'].join('.') + '@' + ['example', 'org'].join('.');
const safe = ['dev', 'knull.local'].join('@');
const privateEmail = (local) => [local, 'users.noreply.github.com'].join('@');
const inherited = { ...process.env };
for (const key of Object.keys(inherited)) {
  if (/^GIT_(?:DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|AUTHOR_|COMMITTER_)/.test(key)) delete inherited[key];
}
const env = { ...inherited, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Fixture Author', GIT_AUTHOR_EMAIL: safe, GIT_COMMITTER_NAME: 'Fixture Committer', GIT_COMMITTER_EMAIL: safe };
function git(args, options = {}) {
  return execFileSync('git', ['-c', 'core.hooksPath=', '-c', 'commit.gpgSign=false', ...args],
    { cwd: repo, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim();
}
function commit(parent, author = safe, committer = safe, extraParent = null) {
  return git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), ...(extraParent ? ['-p', extraParent] : []), '-m', 'Synthetic metadata fixture'],
    { env: { ...env, GIT_AUTHOR_EMAIL: author, GIT_COMMITTER_EMAIL: committer } });
}
const inspect = () => createMetadataInspector({ cwd: repo, env });
const zero = '0'.repeat(40);
let checks = 0;
const ok = (label) => { checks++; console.log(`  ok ${label}`); };
let tree;
try {
  fs.mkdirSync(repo);
  git(['init', '-q']); git(['init', '-q', '--bare', remote]);
  tree = git(['mktree'], { input: '' });
  assert(isPrivateCommitEmail(safe));
  assert(isPrivateCommitEmail(['noreply', 'github.com'].join('@')));
  assert(isPrivateCommitEmail(privateEmail('12345+fixture-contributor')));
  assert(isPrivateCommitEmail(privateEmail('fixture-contributor')));
  assert(isPrivateCommitEmail(privateEmail('41898282+github-actions[bot]')));
  for (const value of [syntheticMailbox, '', `${safe}.invalid`, `${privateEmail('a')}.invalid`, privateEmail('a+b'), ['other', 'github.com'].join('@')]) {
    assert.equal(isPrivateCommitEmail(value), false);
  }
  ok('narrow non-personal identities, including individual GitHub attribution');

  const cleanCurrent = inspect(); cleanCurrent.current(); assert(cleanCurrent.result().ok);
  for (const role of ['AUTHOR', 'COMMITTER']) {
    const current = createMetadataInspector({ cwd: repo, env: { ...env, [`GIT_${role}_EMAIL`]: syntheticMailbox } });
    current.current(); assert.deepEqual(current.result().findings.map((finding) => finding.field), [role.toLowerCase()]);
  }
  const nameMailbox = createMetadataInspector({ cwd: repo, env: { ...env, GIT_AUTHOR_NAME: syntheticMailbox } });
  nameMailbox.current(); assert.deepEqual(nameMailbox.result().findings.map((finding) => finding.field), ['author-name']);
  const webFlow = createMetadataInspector({ cwd: repo, env: { ...env, GIT_COMMITTER_EMAIL: ['noreply', 'github.com'].join('@') } });
  webFlow.current(); assert(webFlow.result().ok);
  ok('resolved pending author and committer are independently checked');

  const oldPrivate = commit(null, syntheticMailbox);
  const firstClean = commit(oldPrivate);
  const middlePrivate = commit(firstClean, syntheticMailbox);
  const tipClean = commit(middlePrivate);
  const middle = inspect(); middle.range([tipClean], [oldPrivate]);
  assert.equal(middle.result().commits, 3);
  assert.deepEqual(middle.result().findings, [{ object: middlePrivate, field: 'author' }]);
  const existing = inspect(); existing.range([firstClean], [oldPrivate]); assert(existing.result().ok);
  ok('all newly exposed commits checked, while already-published ancestry remains outside a normal push');

  const badCommitter = commit(firstClean, safe, syntheticMailbox);
  const committer = inspect(); committer.range([badCommitter], [firstClean]);
  assert.deepEqual(committer.result().findings, [{ object: badCommitter, field: 'committer' }]);
  const merged = commit(firstClean, safe, safe, middlePrivate);
  const merge = inspect(); merge.range([merged], [firstClean]);
  assert(merge.result().findings.some((finding) => finding.object === middlePrivate));
  fs.writeFileSync(path.join(repo, '.mailmap'), `Fixture <${safe}> <${syntheticMailbox}>\n`);
  const raw = inspect(); raw.range([tipClean], [oldPrivate]); assert.equal(raw.result().findings.length, 1);
  ok('committer-only, merged side-branch and mailmap-masked metadata cannot pass');

  git(['update-ref', 'refs/heads/main', oldPrivate]);
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-q', 'origin', 'main']);
  const newBranch = inspect();
  newBranch.push(`refs/heads/new ${firstClean} refs/heads/new ${zero}\n`, 'origin');
  assert.equal(newBranch.result().commits, 1); assert(newBranch.result().ok);
  // A stale remote-tracking tip must not hide the private middle commit.
  git(['update-ref', 'refs/remotes/origin/stale', tipClean]);
  const newBadBranch = inspect();
  newBadBranch.push(`refs/heads/new ${tipClean} refs/heads/new ${zero}\n`, 'origin');
  assert.equal(newBadBranch.result().findings.length, 1);
  const emptyRemote = path.join(temporary, 'empty.git'); git(['init', '-q', '--bare', emptyRemote]);
  const emptyPush = inspect(); emptyPush.push(`refs/heads/new ${firstClean} refs/heads/new ${zero}\n`, emptyRemote);
  assert(emptyPush.result().findings.some((finding) => finding.object === oldPrivate));
  ok('new branches consult actual remote ancestry; an empty remote receives no legacy exemption');

  const multiple = inspect();
  multiple.push(`refs/heads/a ${firstClean} refs/heads/a ${oldPrivate}\nrefs/heads/b ${tipClean} refs/heads/b ${firstClean}\n`, 'origin');
  assert.equal(multiple.result().findings.length, 1);
  const rewritten = commit(oldPrivate, safe, syntheticMailbox);
  const force = inspect(); force.push(`refs/heads/main ${rewritten} refs/heads/main ${firstClean}\n`, 'origin');
  assert.equal(force.result().findings[0].field, 'committer');
  const deletion = inspect(); deletion.push(`(delete) ${zero} refs/heads/main ${tipClean}\n`, 'unconfigured'); assert(deletion.result().ok);
  assert.throws(() => inspect().range(['a'.repeat(40)], [firstClean]), /metadata-object-unavailable/);
  assert.throws(() => inspect().range([firstClean], ['b'.repeat(40)]), /metadata-object-unavailable/);
  assert.throws(() => inspect().push('malformed input', 'origin'), /metadata-invalid-push-input/);
  const missingAuthor = git(['hash-object', '--literally', '-t', 'commit', '-w', '--stdin'], { input: `tree ${tree}\ncommitter Fixture <${safe}> 1000000000 +0000\n\nMissing author fixture\n` });
  const missing = inspect(); missing.range([missingAuthor]);
  assert(missing.result().findings.some((finding) => finding.field === 'author'));
  ok('multi-ref and force pushes checked; deletions allowed; unavailable history fails closed');

  const tag = git(['mktag'], { input: `object ${firstClean}\ntype commit\ntag fixture-tag\ntagger Fixture <${syntheticMailbox}> 1000000000 +0000\n\nSynthetic tag\n` });
  const annotated = inspect(); annotated.range([tag], [firstClean]);
  assert.deepEqual(annotated.result().findings, [{ object: tag, field: 'tagger' }]);
  assert.equal(annotated.result().commits, 0); assert.equal(annotated.result().tags, 1);
  ok('annotated tagger checked even when the target commit is already published');

  const declined = spawnSync(process.execPath, [cli, '--range', firstClean, tipClean], { cwd: repo, env, encoding: 'utf8' });
  assert.equal(declined.status, 1);
  assert.match(declined.stderr, /author email/);
  assert(!`${declined.stdout}${declined.stderr}`.includes(syntheticMailbox));
  assert(!`${declined.stdout}${declined.stderr}`.includes('Fixture Author'));
  const pipedPush = spawnSync(process.execPath, [cli, '--pre-push', 'origin'], { cwd: repo, env, encoding: 'utf8',
    input: `refs/heads/main ${firstClean} refs/heads/main ${oldPrivate}\nrefs/heads/new ${tipClean} refs/heads/new ${zero}\n` });
  assert.equal(pipedPush.status, 1); assert(!pipedPush.stderr.includes(syntheticMailbox));
  const pipedDeletion = spawnSync(process.execPath, [cli, '--pre-push', 'unconfigured'], { cwd: repo, env, encoding: 'utf8',
    input: `(delete) ${zero} refs/heads/main ${tipClean}\n` });
  assert.equal(pipedDeletion.status, 0);
  const eventPath = path.join(temporary, 'event.json');
  fs.writeFileSync(eventPath, JSON.stringify({ before: oldPrivate, after: tipClean, deleted: false }));
  const ci = spawnSync(process.execPath, [cli, '--ci'], { cwd: repo, env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push' }, encoding: 'utf8' });
  assert.equal(ci.status, 1); assert(!ci.stderr.includes(syntheticMailbox));
  fs.writeFileSync(eventPath, JSON.stringify({ before: oldPrivate, after: firstClean, deleted: false }));
  const safeCi = spawnSync(process.execPath, [cli, '--ci'], { cwd: repo, env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push' }, encoding: 'utf8' });
  assert.equal(safeCi.status, 0, 'an ordinary CI push does not require rewriting already-published ancestry');
  fs.writeFileSync(eventPath, JSON.stringify({ before: zero, after: firstClean, deleted: false }));
  const initialCi = spawnSync(process.execPath, [cli, '--ci'], { cwd: repo, env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push' }, encoding: 'utf8' });
  assert.equal(initialCi.status, 1, 'new CI refs without a trusted boundary check the complete ancestry');
  fs.writeFileSync(eventPath, JSON.stringify({ pull_request: { base: { sha: firstClean }, head: { sha: tipClean } } }));
  const pr = spawnSync(process.execPath, [cli, '--ci'], { cwd: repo, env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'pull_request' }, encoding: 'utf8' });
  assert.equal(pr.status, 1);
  ok('real CLI and CI inspect non-tip commits without printing private values or names');

  const rewrittenGood = git(['commit-tree', tree, '-m', 'Entirely new clean history']);
  const rewrittenBad = commit(rewrittenGood, syntheticMailbox);
  const rewrittenBadTip = commit(rewrittenBad);
  git(['update-ref', 'refs/heads/rewritten-clean', rewrittenGood]);
  git(['update-ref', 'refs/heads/rewritten-bad', rewrittenBadTip]);
  const freshClean = path.join(temporary, 'fresh-clean');
  const freshBad = path.join(temporary, 'fresh-bad');
  for (const [branch, destination] of [['rewritten-clean', freshClean], ['rewritten-bad', freshBad]]) {
    git(['clone', '-q', '--no-local', '--single-branch', '--no-tags', '--branch', branch, repo, destination]);
    const missingOld = spawnSync('git', ['cat-file', '-e', oldPrivate], { cwd: destination, env, encoding: 'utf8' });
    assert.notEqual(missingOld.status, 0, 'fresh rewritten checkout must demonstrably lack the old before-object');
  }
  function forcedCi(cwd, event) {
    fs.writeFileSync(eventPath, JSON.stringify(event));
    const result = spawnSync(process.execPath, [cli, '--ci'], { cwd, env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push' }, encoding: 'utf8' });
    assert(!`${result.stdout}${result.stderr}`.includes(syntheticMailbox));
    return result;
  }
  assert.equal(forcedCi(freshClean, { before: oldPrivate, after: rewrittenGood, forced: true, deleted: false }).status, 0);
  const rejectedAncestor = forcedCi(freshBad, { before: oldPrivate, after: rewrittenBadTip, forced: true, deleted: false });
  assert.equal(rejectedAncestor.status, 1); assert.match(rejectedAncestor.stderr, /author email/);
  const absentNormal = forcedCi(freshClean, { before: oldPrivate, after: rewrittenGood, forced: false, deleted: false });
  assert.equal(absentNormal.status, 1); assert.match(absentNormal.stderr, /metadata-object-unavailable/);
  const absentAfter = forcedCi(freshClean, { before: oldPrivate, after: 'f'.repeat(40), forced: true, deleted: false });
  assert.equal(absentAfter.status, 1); assert.match(absentAfter.stderr, /metadata-object-unavailable/);
  for (const invalidBefore of [null, '', 'not-an-object-id', 17]) {
    const malformed = forcedCi(freshClean, { before: invalidBefore, after: rewrittenGood, forced: true, deleted: false });
    assert.equal(malformed.status, 1); assert.match(malformed.stderr, /metadata-invalid-ci-event/);
  }
  assert.equal(forcedCi(freshClean, { before: oldPrivate, after: rewrittenGood, forced: 'true', deleted: false }).status, 1);
  ok('fresh forced-push checkout scans whole incoming ancestry while malformed events and ordinary missing boundaries fail');

  const manualClean = spawnSync(process.execPath, [cli, '--all-reachable', 'HEAD'], { cwd: freshClean, env, encoding: 'utf8' });
  assert.equal(manualClean.status, 0, manualClean.stderr);
  fs.writeFileSync(eventPath, JSON.stringify({ before: zero, after: rewrittenGood, forced: true, deleted: false }));
  const legacyAdapter = spawnSync(process.execPath, [cli], { cwd: freshClean,
    env: { ...env, GITHUB_EVENT_PATH: eventPath, GITHUB_EVENT_NAME: 'push' }, encoding: 'utf8' });
  assert.equal(legacyAdapter.status, 0, 'the inactive no-argument workflow adapter remains compatible');
  const manualBad = spawnSync(process.execPath, [cli, '--all-reachable', 'HEAD'], { cwd: freshBad, env, encoding: 'utf8' });
  assert.equal(manualBad.status, 1);
  const namedRange = spawnSync(process.execPath, [cli, '--range', 'HEAD~1', 'HEAD'], { cwd: freshBad, env, encoding: 'utf8' });
  assert.equal(namedRange.status, 0, 'a named manual range excludes its chosen published boundary');
  const invalidRevision = spawnSync(process.execPath, [cli, '--all-reachable', '--help'], { cwd: freshClean, env, encoding: 'utf8' });
  assert.equal(invalidRevision.status, 1);
  assert(!`${manualBad.stdout}${manualBad.stderr}`.includes(syntheticMailbox));
  ok('manual HEAD and named ranges work without GitHub event input; option-like revisions fail closed');

  const hookRepo = path.join(temporary, 'hook-work');
  const hookRemote = path.join(temporary, 'hook-remote.git');
  fs.mkdirSync(path.join(hookRepo, '.githooks'), { recursive: true });
  fs.mkdirSync(path.join(hookRepo, '.github/scripts'), { recursive: true });
  for (const filename of ['pre-commit', 'pre-push']) {
    const target = path.join(hookRepo, '.githooks', filename);
    fs.copyFileSync(path.join(root, '.githooks', filename), target);
    fs.chmodSync(target, 0o755);
  }
  for (const filename of ['check-commit-metadata.mjs', 'commitMetadataPrivacy.mjs']) {
    fs.copyFileSync(path.join(root, '.github/scripts', filename), path.join(hookRepo, '.github/scripts', filename));
  }
  const hookGit = (args, options = {}) => spawnSync('git', ['-c', 'commit.gpgSign=false', ...args],
    { cwd: hookRepo, env, encoding: 'utf8', ...options });
  const mustGit = (args, options = {}) => {
    const result = hookGit(args, options);
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  mustGit(['init', '-q', '-b', 'main']);
  mustGit(['init', '-q', '--bare', hookRemote]);
  mustGit(['config', 'core.hooksPath', '.githooks']);
  mustGit(['remote', 'add', 'origin', hookRemote]);
  mustGit(['commit', '--allow-empty', '-m', 'Synthetic clean hook commit']);
  const hookSafe = mustGit(['rev-parse', 'HEAD']);
  for (const role of ['AUTHOR', 'COMMITTER']) {
    const blockedCommit = hookGit(['commit', '--allow-empty', '-m', 'Synthetic rejected hook commit'],
      { env: { ...env, [`GIT_${role}_EMAIL`]: syntheticMailbox } });
    assert.notEqual(blockedCommit.status, 0);
    assert.match(blockedCommit.stderr, new RegExp(`${role.toLowerCase()} email`));
    assert(!`${blockedCommit.stdout}${blockedCommit.stderr}`.includes(syntheticMailbox));
    assert.equal(mustGit(['rev-parse', 'HEAD']), hookSafe);
  }
  mustGit(['push', '-q', 'origin', 'main']);
  const hookTree = mustGit(['mktree'], { input: '' });
  const hookBad = mustGit(['commit-tree', hookTree, '-p', hookSafe, '-m', 'Synthetic private ancestor'],
    { env: { ...env, GIT_AUTHOR_EMAIL: syntheticMailbox } });
  const hookBadTip = mustGit(['commit-tree', hookTree, '-p', hookBad, '-m', 'Synthetic clean tip']);
  mustGit(['update-ref', 'refs/heads/main', hookBadTip]);
  const blockedPush = hookGit(['push', 'origin', 'main']);
  assert.notEqual(blockedPush.status, 0);
  assert.match(blockedPush.stderr, /author email/);
  assert(!`${blockedPush.stdout}${blockedPush.stderr}`.includes(syntheticMailbox));
  const remoteMain = execFileSync('git', ['--git-dir', hookRemote, 'rev-parse', 'refs/heads/main'], { env, encoding: 'utf8' }).trim();
  assert.equal(remoteMain, hookSafe, 'a rejected actual pre-push hook leaves the local-only remote unchanged');
  ok('installed hooks permit clean commit/push and reject pending identities and a private non-tip ancestor');

  const gitExecutable = process.platform === 'win32'
    ? execFileSync('where.exe', ['git'], { env, encoding: 'utf8' }).trim().split(/\r?\n/)[0]
    : execFileSync('/bin/sh', ['-c', 'command -v git'], { env, encoding: 'utf8' }).trim();
  const shell = process.platform === 'win32' ? path.resolve(path.dirname(gitExecutable), '../bin/sh.exe') : '/bin/sh';
  assert(fs.existsSync(shell), 'the installed Git shell must be available to execute the hook fixtures');
  const pathEnv = (value) => {
    const result = { ...env };
    for (const key of Object.keys(result)) if (key.toLowerCase() === 'path') delete result[key];
    result.PATH = value;
    return result;
  };
  const emptyPath = path.join(temporary, 'empty-path');
  fs.mkdirSync(emptyPath);
  const nodeOnlyPath = path.join(temporary, 'node-only-path');
  fs.mkdirSync(nodeOnlyPath);
  const nodeStub = path.join(nodeOnlyPath, 'node');
  fs.writeFileSync(nodeStub, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(nodeStub, 0o755);
  const shellPath = (value) => process.platform === 'win32'
    ? value.replace(/\\/g, '/').replace(/^([a-z]):/i, (_, drive) => `/${drive.toLowerCase()}`) : value;
  const runRestrictedHook = (hook, toolPath) => spawnSync(shell,
    ['-c', 'PATH="$1"; export PATH; exec /bin/sh "$2" origin', 'fixture', shellPath(toolPath), shellPath(hook)],
    { cwd: hookRepo, env, encoding: 'utf8' });
  const absentGit = createMetadataInspector({ cwd: hookRepo, env: pathEnv(emptyPath) });
  assert.throws(() => absentGit.current(), /metadata-git-read-failed/);
  for (const filename of ['pre-commit', 'pre-push']) {
    const hook = path.join(hookRepo, '.githooks', filename);
    const absentNode = runRestrictedHook(hook, emptyPath);
    assert.equal(absentNode.status, 1);
    assert.match(absentNode.stderr, /Node.js and Git are required/);
    const missingGit = runRestrictedHook(hook, nodeOnlyPath);
    assert.equal(missingGit.status, 1);
    assert.match(missingGit.stderr, /Node.js and Git are required/);
  }
  const verifierPath = path.join(hookRepo, '.github/scripts/check-commit-metadata.mjs');
  fs.renameSync(verifierPath, `${verifierPath}.fixture-hidden`);
  for (const filename of ['pre-commit', 'pre-push']) {
    const absentVerifier = spawnSync(shell, [shellPath(path.join(hookRepo, '.githooks', filename)), 'origin'],
      { cwd: hookRepo, env, encoding: 'utf8' });
    assert.equal(absentVerifier.status, 1);
    assert.match(absentVerifier.stderr, /metadata verifier is unavailable/);
  }
  fs.renameSync(`${verifierPath}.fixture-hidden`, verifierPath);
  const modulePath = path.join(hookRepo, '.github/scripts/commitMetadataPrivacy.mjs');
  fs.renameSync(modulePath, `${modulePath}.fixture-hidden`);
  const absentModule = spawnSync(process.execPath, [verifierPath, '--current'], { cwd: hookRepo, env, encoding: 'utf8' });
  assert.equal(absentModule.status, 1);
  assert.match(absentModule.stderr, /metadata-check-failed/);
  assert(!`${absentModule.stdout}${absentModule.stderr}`.includes(hookRepo));
  assert(!`${absentModule.stdout}${absentModule.stderr}`.includes('ERR_MODULE_NOT_FOUND'));
  ok('both hooks fail closed for missing tools/verifier; a missing module also refuses with redacted diagnostics');

  const prePush = fs.readFileSync(path.join(root, '.githooks/pre-push'), 'utf8');
  assert.match(prePush, /check-commit-metadata\.mjs/);
  assert.match(prePush, /--pre-push/);
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/commit-metadata-privacy.yml'), 'utf8');
  assert.match(workflow, /fetch-depth: 0/); assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /check-commit-metadata\.mjs/);
  ok('local push wiring and inactive workflow adapter remain present');
  console.log(`commit metadata privacy: ${checks} checks passed`);
} finally {
  assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
  assert(path.basename(temporary).startsWith('commit-metadata-privacy-'));
  fs.rmSync(temporary, { recursive: true, force: true });
}
