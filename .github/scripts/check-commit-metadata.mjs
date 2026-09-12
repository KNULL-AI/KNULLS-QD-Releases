#!/usr/bin/env node
import fs from 'node:fs';
try {
  // Load inside the redacted error boundary: a missing module must not print a
  // local absolute path or silently skip metadata verification.
  const { createMetadataInspector } = await import('./commitMetadataPrivacy.mjs');
  const inspector = createMetadataInspector();
  const [mode, ...args] = process.argv.slice(2);
  if (mode === '--current' && args.length === 0) inspector.current();
  else if (mode === '--pre-push' && args.length === 1) inspector.push(fs.readFileSync(0, 'utf8'), args[0]);
  else if (mode === '--range' && args.length === 2) inspector.range([inspector.resolveRevision(args[1])], [inspector.resolveRevision(args[0])]);
  else if (mode === '--all-reachable' && args.length === 1) inspector.range([inspector.resolveRevision(args[0])]);
  // Preserve the old no-argument workflow adapter. Repository policy disables
  // Actions; local checks below do not require an event file or hosted runner.
  else if ((mode === '--ci' || mode === undefined) && args.length === 0) {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (process.env.GITHUB_EVENT_NAME === 'pull_request') {
      inspector.range([event.pull_request.head.sha], [event.pull_request.base.sha]);
    } else if (process.env.GITHUB_EVENT_NAME === 'push') {
      const oid = (value) => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
      if (!oid(event.before) || !oid(event.after)
        || (event.forced !== undefined && typeof event.forced !== 'boolean')
        || (event.deleted !== undefined && typeof event.deleted !== 'boolean')) throw new Error('metadata-invalid-ci-event');
      // A rewritten before-object need not exist in a fresh checkout. Inspecting
      // all incoming ancestry is stronger than excluding that vanished boundary.
      if (!event.deleted) inspector.range([event.after], event.forced === true || /^0+$/.test(event.before) ? [] : [event.before]);
    } else throw new Error('metadata-unsupported-ci-event');
  } else throw new Error('metadata-invalid-arguments');
  const result = inspector.result();
  if (!result.ok) {
    console.error('commit metadata privacy: refused; personal or unapproved email identity found.');
    for (const finding of result.findings.slice(0, 25)) {
      console.error(`  ${finding.object === 'pending' ? 'pending commit' : finding.object.slice(0, 12)}: ${finding.field} email`);
    }
    if (result.findings.length > 25) console.error(`  ${result.findings.length - 25} additional identity findings`);
    console.error('Use your GitHub noreply identity for both author and committer; release automation may use the documented KNULL identity.');
    console.error('Values are redacted. Correct affected local commits before pushing; changing git config does not repair old commits.');
    process.exitCode = 1;
  } else console.log(`commit metadata privacy: passed (${result.commits} commits, ${result.tags} annotated tags checked).`);
} catch (error) {
  const reason = /^metadata-[a-z-]+$/.test(error?.message || '') ? error.message : 'metadata-check-failed';
  console.error(`commit metadata privacy: refused; ${reason}. No unverified push is allowed. Fetch the needed history if an object is unavailable.`);
  process.exitCode = 1;
}
