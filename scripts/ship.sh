#!/usr/bin/env bash
#
# Ship everything: verify, commit, deploy, push.
#
#   ./scripts/ship.sh "what changed"
#
# Runs from anywhere. Safe to re-run: if there is nothing to commit it still uploads and
# pushes, so an interrupted run can simply be run again.
#
# What this exists to prevent, in order of how much each one has cost:
#
#   1. A STALE BUNDLE. QuoteOptionsFunction.bundle.js is what HubSpot actually runs. Deploying
#      a rebuilt card against an old bundle looks like a successful ship and changes nothing on
#      the server. check.sh fails on this; this script refuses to continue when it does.
#   2. AN UPLOAD THAT WENT SOMEWHERE ELSE. A wrong --account does NOT fail -- it falls back and
#      uploads anyway. The only proof is the "Uploaded ... to <account> (<portal>)" line, so
#      this script reads it and stops unless it says 45023718.
#   3. A DEPLOY NOBODY LOOKED AT. The run ends by naming what to check, because "shipped" and
#      "working" came apart repeatedly on 2026-08-30.

set -euo pipefail

readonly PORTAL_ID="45023718"
readonly ACCOUNT="x"

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${root_dir}"

message="${1:-}"

say() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m! %s\033[0m\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# 0. A stale lock from a Claude session's `git status`.
#
# The desktop bridge gives Claude a shell with no delete permission on the mount, so git can
# create .git/index.lock there and not remove it. It blocks every git command that follows with
# "Unable to create index.lock: File exists". Clearing it here is safe: nothing else is holding
# it by the time this script runs.
# ---------------------------------------------------------------------------
rm -f .git/index.lock .git/index.lock.stale

# ---------------------------------------------------------------------------
# 1. Verify. Tests, bundle parity, prettier, eslint, tsc.
# ---------------------------------------------------------------------------
say "Checking (tests, bundle parity, lint, types)"
./scripts/check.sh || fail "check.sh failed. Nothing has been committed, uploaded or pushed.

If it failed on bundle parity, the fix is:
    npm run build --prefix src/app/functions
then run this script again."

# ---------------------------------------------------------------------------
# 2. Commit, if there is anything to commit.
# ---------------------------------------------------------------------------
if [ -n "$(git status --porcelain)" ]; then
  if [ -z "${message}" ]; then
    fail "There are uncommitted changes but no commit message.

    ./scripts/ship.sh \"what changed\""
  fi
  say "Committing"
  git add -A
  git commit -m "${message}"
else
  say "Nothing to commit -- deploying what is already on HEAD"
  message="${message:-$(git log -1 --pretty=%s)}"
fi

git --no-pager log --oneline -1

# ---------------------------------------------------------------------------
# 3. Upload to HubSpot, and PROVE it went to the right portal.
#
# `hs project upload --account=<anything>` succeeds even when the account does not exist: it
# falls back and deploys to x regardless. So the exit code means nothing here. The
# "Uploaded ... to x [standard] (45023718)" line is the only real confirmation, and it is what
# this checks.
# ---------------------------------------------------------------------------
say "Uploading to HubSpot (${ACCOUNT} / ${PORTAL_ID})"
upload_log="$(mktemp -t nylas-pricing-upload)"
if ! hs project upload --account="${ACCOUNT}" --message="${message}" 2>&1 | tee "${upload_log}"; then
  fail "hs project upload failed. See the output above.

If it is an auth failure, the personal access key has been regenerated:
    hs account auth
Get a new key at https://app.hubspot.com/personal-access-key while logged into portal ${PORTAL_ID}.
Nothing has been pushed."
fi

if ! grep -q "${PORTAL_ID}" "${upload_log}"; then
  fail "The upload did not report portal ${PORTAL_ID}.

A wrong --account silently falls back rather than failing, so this may have deployed somewhere
unintended. Check the 'Uploaded ... to <account> (<portal>)' line above, and run:
    hs accounts list
Nothing has been pushed."
fi
rm -f "${upload_log}"

# ---------------------------------------------------------------------------
# 4. Push. Last, so a failed deploy never leaves GitHub ahead of the portal.
#
# Deliberately a plain push. A non-fast-forward rejection here means main was rewritten and
# needs the recovery in claude/deploy-loop.md -- NOT a `git pull`, which would merge
# rolled-back work straight back in.
# ---------------------------------------------------------------------------
say "Pushing"
git push || fail "git push was rejected.

If this is a non-fast-forward rejection, do NOT run 'git pull' -- it merges rolled-back work
back in. See the non-fast-forward section of claude/deploy-loop.md.
The upload already succeeded, so the portal is up to date either way."

# ---------------------------------------------------------------------------
# 5. Say what to look at.
# ---------------------------------------------------------------------------
cat <<'DONE'

------------------------------------------------------------------------------
Shipped.

Now verify, because a deploy nobody looks at is not a fix:

  1. Hard-refresh the Deal record -- Cmd-Shift-R -- then open the Pricing tab.
     The card is cached; a normal refresh can show you the old one.

  2. Template follows the PIPELINE:
       new business pipeline  -> New Business Template   (567553820432)
       renewal pipeline       -> Change or Renewal       (583243623796 / 583243745379)
     Move a Deal between pipelines with the card open, then Lock in. The picker
     must drop a template the new pipeline does not offer, and the quote that
     comes out must match the pipeline it is in now.

  3. Quote status matches the approval tier:
       tier none        -> DRAFT
       any other tier   -> PENDING_APPROVAL

  4. On the Deal, after Lock in:
       Professional Services Package    reflects the picks (or "No")
       Pricing: Subscription Add-ons    reflects the add-ons
       Pricing: Contract summary        readable, and agrees with the quote

  5. A new configuration starts with Onboarding = None.

If a quote comes out wrong, get its ID before deleting it -- the template
association on the quote is the evidence, and it goes with the record.
------------------------------------------------------------------------------
DONE
