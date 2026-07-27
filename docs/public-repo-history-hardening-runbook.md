# Public Repo Full Hardening Runbook

Goal: remove historical source snapshots from the public repo while keeping release users unaffected.

Scope:
- Public repo: KNULL-AI/KNULLS-QD-Releases
- Private repo: KNULL-AI/KNULLS-QD

Current checkpoints:
- Private repo hardening commit: 876b8256b01cfa3a7fcf65e63d0502b05de3d698
- Public repo artifact-only commit on main: cd9447b57e62e0227487eebbd65314fee573756d

## 1) Required secret for private CI (one-time)

In the private repo, set this secret:
- Name: PUBLIC_RELEASES_TOKEN
- Value: fine-grained PAT
- Token scope: Contents = Read and write
- Token repository access: KNULL-AI/KNULLS-QD-Releases only

Safe way (prompts directly in terminal):

```powershell
gh secret set PUBLIC_RELEASES_TOKEN --repo KNULL-AI/KNULLS-QD
```

Validate:

```powershell
gh secret list --repo KNULL-AI/KNULLS-QD | Select-String PUBLIC_RELEASES_TOKEN
```

## 2) Pre-flight safety snapshot

Use a separate folder, never your working source tree.

```powershell
$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backup = "C:\Users\akqet\tmp\KNULLS-QD-Releases-backup-mirror-$ts"
$work = "C:\Users\akqet\tmp\KNULLS-QD-Releases-rewrite-$ts"

if (Test-Path $backup) { Remove-Item -Recurse -Force $backup }
if (Test-Path $work) { Remove-Item -Recurse -Force $work }

git clone --mirror https://github.com/KNULL-AI/KNULLS-QD-Releases.git $backup
git clone https://github.com/KNULL-AI/KNULLS-QD-Releases.git $work
Set-Location $work
```

Record release and tag baseline:

```powershell
gh api repos/KNULL-AI/KNULLS-QD-Releases/releases?per_page=100 --jq "[.[] | {tag:.tag_name,assets:(.assets|length),published:.published_at}]"
gh api repos/KNULL-AI/KNULLS-QD-Releases/git/refs/tags?per_page=200 --jq ".[].ref"
```

## 3) Rewrite public history to clean artifact-only root

This removes old source commits from branch history.

```powershell
Set-Location $work
git checkout main
git checkout --orphan main-clean

Get-ChildItem -Force | Where-Object { $_.Name -ne '.git' } | Remove-Item -Recurse -Force
@'
# KNULLS-QD-Releases

This repository is intentionally artifact-only.

It contains public release assets for KNULL Queue Destroyer.
Source code is maintained in a separate private repository.
'@ | Set-Content README.md

git add README.md
git commit -m "chore: reset public history to artifact-only root"
$clean = git rev-parse HEAD
```

## 4) Preserve release URLs while removing old tag snapshots

Move existing release tags onto the new clean commit so GitHub source archives no longer expose old code.

```powershell
$tags = gh api repos/KNULL-AI/KNULLS-QD-Releases/git/refs/tags?per_page=200 --jq ".[].ref" |
  ForEach-Object { $_ -replace '^refs/tags/', '' }

# Recreate all tags locally on the clean commit
$localTags = git tag -l
foreach ($t in $localTags) { git tag -d $t | Out-Null }
foreach ($t in $tags) { git tag -f $t $clean | Out-Null }

# Replace branch and tags on remote
git branch -M main
git push origin +main
git push origin --force --tags
```

## 5) Validation checks (must pass)

A) Public main tree should only contain artifact-facing files:

```powershell
gh api repos/KNULL-AI/KNULLS-QD-Releases/contents?ref=main --jq ".[] | [.name,.type] | @tsv"
```

B) Spot-check old tag source is no longer present:

```powershell
gh api repos/KNULL-AI/KNULLS-QD-Releases/contents/src?ref=v1.0.19
```

Expected: 404 Not Found.

C) Releases still have assets:

```powershell
gh api repos/KNULL-AI/KNULLS-QD-Releases/releases?per_page=100 --jq ".[] | [.tag_name, (.assets|length)] | @tsv"
```

Expected: same asset counts as pre-flight.

D) Latest release still opens and downloads:

```powershell
gh api repos/KNULL-AI/KNULLS-QD-Releases/releases/tags/v1.0.19 --jq "{url:.html_url,assets:(.assets|length)}"
```

## 6) Rollback plan (if any check fails)

Rollback source of truth is your mirror backup created in Step 2.

```powershell
$restore = "C:\Users\akqet\tmp\KNULLS-QD-Releases-restore-$ts"
if (Test-Path $restore) { Remove-Item -Recurse -Force $restore }
git clone $backup $restore
Set-Location $restore
git push --mirror https://github.com/KNULL-AI/KNULLS-QD-Releases.git
```

Then re-run Step 5 validation.

## 7) Post-hardening operational rules

- Never push source to the public repo.
- Keep builds in private CI only.
- Publish only assets to public releases.
- Keep public workflow files disabled (already done).
- Rotate GLOBAL_TRIGGER_SECRET and any bot/worker secrets if they were ever exposed.

## 8) No-downtime expectation

This process does not delete release assets, so end users can keep installing/updating.
Only historical Git source snapshots are removed/repointed.
