# Export and deletion requests from SUSPENDED learners

> **STATUS: requires legal and security review before production use.** Three parts of this workflow are proposals, not approved controls: **(1) the identity-verification method** (control of the registered email via a challenge phrase), **(2) password-protected delivery of the export**, and **(3) the 72-hour deletion delay**. They are marked **[REQUIRES REVIEW]** below. Do not use this process for a real student until counsel and a security reviewer have approved or changed them. The tool and the safeguards in it (suspended-only, non-owner only, never restores access, one transaction) are implemented and tested.

A suspended learner (`profiles.status = 'suspended'`) is refused everywhere in the app, including the self-service export and deletion, because row-level security shows an inactive profile nothing. They still have a right to ask for their data and to ask for deletion (legal pack Q7). This is the process. **It never restores access**: the status stays `suspended`, no session is created, and nothing in the app changes for them.

The tool is `scripts/admin-cli.mjs` (`suspended-find`, `suspended-export`, `suspended-delete`), implemented in `scripts/suspended-requests.mjs`. It runs **on the owner's machine** with the service role of the project in question (never from the web, never in CI against a hosted project). It refuses any account that is not currently a suspended, non-owner learner, so it cannot be used to read or delete an ordinary active account (those use the app) or the owner. It prints no names, emails or records, only ids and counts. Tested against the real local stack in `supabase/tests/auth/lifecycle.test.ts`: the export equals the app's own export for the same data, is limited to the one person, writes an audit row, and leaves the status and the learner's lack of access unchanged.

## Step 1: receive the request
Only through the privacy contact address in the notice **[OPEN: address to be set]**. Log the date, the type (export / deletion) and the outcome in a private request log (no content). Reply within **[OPEN: counsel to set, commonly 30 days]**.

## Step 2: verify that the requester controls the registered email **[REQUIRES REVIEW]**
* An **invitation code is never proof** of anything here, and nothing the requester says about their account is enough on its own.
* `node scripts/admin-cli.mjs suspended-find --email <the address the request came from>`. It must report `suspended: true, owner: false`. If it reports anything else, stop: an active learner uses the app; an unknown address gets a neutral reply that does not confirm whether an account exists.
* Send a one-time **random challenge phrase** to that registered address (the Google address on the account) and require it to be sent back **from the same address** within 7 days. This proves control of the mailbox, which is the same thing Google sign-in proved when the account was made. It does not prove civil identity; counsel to confirm that is adequate (legal pack Q7).
* Never act on a request from a different address, a forwarded message, or a request that merely quotes account details.

## Step 3a: export
```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/admin-cli.mjs suspended-export --user <id> --out ./request-<ticket>.json
```
* The file is created new (it refuses to overwrite) and is readable only by the owner (`0600`). It is the same JSON the app gives an active learner.
* **Delivery [REQUIRES REVIEW]:** put it in a password-protected archive, send it to the verified address, and give the passphrase through a different channel the learner already uses with you (not the same email). Do not attach it unprotected, do not upload it to a shared drive link without a passphrase.
* **Delete the local file and the archive** once delivery is confirmed (or after 7 days). Do not copy it anywhere else.

## Step 3b: deletion
* After the verification above, send a **notice to the registered address** that the account will be deleted in **72 hours** unless they reply to stop it **[REQUIRES REVIEW: whether a delay is needed and how long]**. Deletion cannot be undone and account recovery does not exist.
* Then: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… INVITE_CODE_PEPPER=… node scripts/admin-cli.mjs suspended-delete --user <id> --identity-verified`
* `--identity-verified` is you stating that Step 2 is done. The deletion is the same single transaction as self-service (ledger entry, audit row with no actor, removal of the account, profile, consents, documents, revisions, sessions and identity). A restore of an old backup is covered by the deletion ledger replay (`deletion-and-restore.md`).
* Confirm to the requester. Record "deleted" and the date in the request log (no identifiers beyond your ticket number).

## What this process does not do
* It does not lift the suspension, answer why the account was suspended, or give any sign-in. That is a separate decision.
* It is manual and depends on one person (the owner). If the owner is unavailable the response time suffers; name a deputy before launch **[OPEN]**.
* Suspension itself is applied by the owner directly in the database today; there is no screen for it.
