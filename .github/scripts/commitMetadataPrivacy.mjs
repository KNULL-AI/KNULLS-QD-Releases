import { execFileSync } from 'node:child_process';

// Only non-personal delivery identities. This is deliberately not a generic
// domain allowlist: someone@example.org is useful test data, not a commit identity.
export function isPrivateCommitEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email === 'dev@knull.local'
    || email === 'noreply@github.com'
    || /^(?:\d+\+)?[a-z0-9][a-z0-9-]*(?:\[bot\])?@users\.noreply\.github\.com$/.test(email);
}

export function createMetadataInspector({ cwd = process.cwd(), env = process.env } = {}) {
  function git(args, input) {
    try {
      return execFileSync('git', args, { cwd, env, input, encoding: 'utf8',
        maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
      // Git stderr can contain a configured mailbox, a credential-bearing URL,
      // a private path or an identity. Never forward it to a hook or CI log.
      throw new Error('metadata-git-read-failed');
    }
  }
  const oid = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
  const zero = (value) => oid(value) && /^0+$/.test(value);
  // Manual checks may name HEAD or a local revision. Hook/event boundaries stay
  // strict object IDs; --end-of-options prevents a revision becoming a Git flag.
  function resolveRevision(value) {
    if (typeof value !== 'string' || !value || /[\r\n\0]/.test(value)) throw new Error('metadata-invalid-revision');
    const object = git(['rev-parse', '--verify', '--end-of-options', `${value}^{object}`]);
    if (!oid(object) || zero(object)) throw new Error('metadata-invalid-revision');
    return object;
  }
  const findings = [];
  const seen = new Set();
  let commits = 0;
  let tags = 0;
  function inspectIdentity(raw, field, object = 'pending') {
    const match = /^([^<>\r\n]+) <([^<>\r\n]+)>\s+\d+\s+[+-]\d{4}$/.exec(String(raw));
    if (!match || !isPrivateCommitEmail(match[2])) findings.push({ object, field });
    // Configuring a safe email must not hide a mailbox copied into user.name.
    // Whether an ordinary display name is a private legal name is a human decision.
    if (match && /[^\s@]+@[^\s@]+\.[^\s@]+/.test(match[1])) findings.push({ object, field: `${field}-name` });
  }
  function current() {
    inspectIdentity(git(['var', 'GIT_AUTHOR_IDENT']), 'author');
    inspectIdentity(git(['var', 'GIT_COMMITTER_IDENT']), 'committer');
  }
  function peel(value, required = true) {
    if (!oid(value) || zero(value)) throw new Error('metadata-invalid-object');
    try {
      const peeled = git(['rev-parse', '--verify', `${value}^{commit}`]);
      if (!oid(peeled)) throw new Error('metadata-invalid-object');
      return peeled;
    } catch {
      if (!required) return null;
      throw new Error('metadata-object-unavailable');
    }
  }
  function inspectTag(value) {
    let object = value;
    const tagSeen = new Set();
    while (git(['cat-file', '-t', object]) === 'tag') {
      if (tagSeen.has(object) || tagSeen.size >= 32) throw new Error('metadata-tag-chain-invalid');
      tagSeen.add(object);
      const raw = git(['cat-file', '-p', object]);
      const header = raw.split(/\r?\n\r?\n/, 1)[0];
      const tagger = /^tagger (.+)$/m.exec(header);
      if (!seen.has(`tag:${object}`)) {
        seen.add(`tag:${object}`); tags++;
        inspectIdentity(tagger?.[1], 'tagger', object);
      }
      object = /^object ([a-f0-9]+)$/m.exec(header)?.[1];
      if (!oid(object)) throw new Error('metadata-tag-chain-invalid');
    }
  }
  function range(tips, bases = []) {
    const positive = [...new Set(tips.map((value) => peel(value)))];
    // A known remote boundary must be available locally. Silently dropping an
    // unavailable boundary would conceal an incomplete check or scan the wrong history.
    const negative = [...new Set(bases.filter((value) => !zero(value)).map((value) => peel(value)))];
    if (!positive.length) return;
    const objects = git(['rev-list', '--stdin'], [...positive, ...negative.map((value) => `^${value}`)].join('\n') + '\n');
    for (const object of objects.split('\n').filter(Boolean)) {
      if (!oid(object)) throw new Error('metadata-invalid-revision-list');
      if (seen.has(object)) continue;
      seen.add(object); commits++;
      const raw = git(['cat-file', '-p', object]);
      // Raw commit objects deliberately bypass mailmap: displayed replacements
      // must not conceal personal author/committer metadata actually being pushed.
      const header = raw.split(/\r?\n\r?\n/, 1)[0];
      inspectIdentity(/^author (.+)$/m.exec(header)?.[1], 'author', object);
      inspectIdentity(/^committer (.+)$/m.exec(header)?.[1], 'committer', object);
    }
    tips.forEach(inspectTag);
  }
  function remoteBases(remote) {
    if (!remote || remote.startsWith('-') || /[\r\n\0]/.test(remote)) throw new Error('metadata-invalid-remote');
    const advertised = git(['ls-remote', '--refs', remote]);
    const bases = [];
    for (const line of advertised.split('\n').filter(Boolean)) {
      const [object, ref] = line.split(/\s+/, 2);
      if (!oid(object) || !ref?.startsWith('refs/')) throw new Error('metadata-invalid-remote-advertisement');
      // Objects absent locally are not excluded. This conservatively checks
      // additional history, never trusts stale remote-tracking refs as a bypass.
      const commit = peel(object, false);
      if (commit) bases.push(commit);
    }
    return bases;
  }
  function push(input, remote) {
    const updates = String(input).split(/\r?\n/).filter((line) => line.trim()).map((line) => {
      const fields = line.trim().split(/\s+/);
      if (fields.length !== 4 || !oid(fields[1]) || !oid(fields[3]) || !fields[2].startsWith('refs/')) {
        throw new Error('metadata-invalid-push-input');
      }
      return { local: fields[1], remote: fields[3] };
    }).filter((update) => !zero(update.local));
    if (!updates.length) return;
    // Existing refs get their exact advertised old tip from Git. New refs also
    // need the actual remote advertisement, not a possibly stale local branch.
    const bases = updates.filter((update) => !zero(update.remote)).map((update) => update.remote);
    if (updates.some((update) => zero(update.remote))) bases.push(...remoteBases(remote));
    range(updates.map((update) => update.local), bases);
  }
  function result() { return { ok: findings.length === 0, commits, tags, findings }; }
  return { current, range, push, result, resolveRevision };
}
