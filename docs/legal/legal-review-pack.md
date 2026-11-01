# Legal review pack for the Grammigo privacy notice

**Status: DRAFT `draft-2026-11`. Not legal advice. Not reviewed by a lawyer. Do not invite a real student until this has been reviewed and the notice finalised.**

This pack is what a qualified privacy lawyer needs to review the notice (`src/features/accounts/PrivacyAccounts.tsx`, shown at `/privacy` when accounts are on; a plain-text copy is in
[`privacy-notice-draft.md`](privacy-notice-draft.md)) and the product behind it. Everything below is a statement of what the software does today, verified against the code and its tests.
Where something is not yet known or decided it is marked **[OPEN]**.

## 1. What the product is

An English-grammar practice app. Anyone can use it **without an account**: progress stays in their browser and nothing is sent to us. An **optional, invitation-only account** (Google sign-in, adults 18+ only)
lets a learner choose to keep progress in their account to continue on another device. Accounts are **switched off in production today**; no real student has an account.

## 2. Data inventory (what exists, where, why, how long, how it is deleted)

| Data | Where | Why | Held until | Deletion / export |
|---|---|---|---|---|
| Email address, name, Google account id, verified flag, profile picture URL | Supabase Auth (`auth.users`, `auth.identities`) | Sign-in; display name | Account deletion | Deleted with the account; email in export; picture URL / Google id are in the sign-in record and are **not** in the export file **[OPEN: include?]** |
| Display name, first language (optional), time zone (unused today), practising topics, daily minutes | `profiles` | Personalisation, greeting | Account deletion | Deleted; in export |
| Date adult (18+) was confirmed | `profiles.adult_confirmed_at` | Eligibility record | Account deletion | Deleted; in export |
| Invitation used (id), invitation label/use counts | `profiles.joined_via_invitation`, `invitations`, `invitation_reservations` | Invitation-only access; seat counting | Link removed at deletion; counts remain (no person) | The link to the person is cleared; the owner-written label stays |
| Consent records: adult confirmation, privacy-notice version, cloud-saving consent, with times | `consents` | Evidence of what was agreed | Account deletion | Deleted; in export |
| Lesson answers, quick-check answers, goals, Guided Correction attempts (typed or confirmed text; **never audio**) | `learner_documents` (2 documents) + last 10 revisions in `learner_document_versions` | Cross-device continuity | Account deletion | Deleted; current documents in export (older revisions are not) |
| Sign-in sessions / refresh tokens | Supabase Auth | Staying signed in | Sign-out or deletion | Removed at deletion (verified in tests) |
| Abuse-prevention counters (HMAC of network address + endpoint) | `rate_limits` | Rate limiting | Windows ≤ 1 day, pruned after 2 days | Not linked to a person; not in export |
| Deletion ledger (HMAC of account id; no personal data) | `deletion_ledger` | Re-apply deletions after a backup restore | 35 days (immutable until then) | n/a |
| Audit log: invitation created/revoked/redeemed, export requested, account deleted (no names, no content; actor id cleared on deletion) | `audit_events` | Security and accountability | At least 90 days | Actor link removed at deletion |
| Hosting request logs (IP, user agent, path) | Vercel | Operation, security | Per Vercel's policy **[OPEN]** | Not under our control |
| Browser storage: progress on the device, last-saved note, `gm-auth` (httpOnly), `gm-scope`, `gm-flow` cookies | The learner's device | Local-first learning; sign-in | Until cleared / sign-out | Learner controls; deletion offers to remove the account's local copy |
| Text/audio sent to OpenAI **only when AI features are on** | OpenAI API (not stored by Grammigo) | Goal understanding, feedback, transcription | Per OpenAI's policy | **No name, email or account id is sent** (code: AI routes do not import account code; architecture test) |

Not collected: advertising or analytics trackers, location, contacts, payment data, children's accounts (accounts are 18+; no under-18 flow exists).

## 3. Processors and transfers **[OPEN: all agreements and locations]**

* **Supabase** (database + Auth). Intended project `ugifdvaaaioiqmwfiksw`; region **recorded as ap-southeast-1 (Singapore) in the design but NOT yet verified**; verified in the production-provisioning phase.
* **Google** (sign-in, OAuth). Identity provider; Grammigo never sees a password.
* **Vercel** (hosting, edge, logs).
* **OpenAI** (AI features; off unless enabled).
* Cross-border transfer mechanism, DPAs, sub-processors: to be settled.

## 4. How the product meets common obligations (for the lawyer to assess, not assume)

* **Access / portability**: authenticated JSON export of the learner's own records (`/api/account/export`), tested to contain no other learner's data.
* **Erasure**: authenticated deletion with typed confirmation and a recent Google sign-in; one transaction removes the account, profile, consents, documents, revisions, sessions and identity; verified in tests with no orphan rows.
* **Backups**: deleted data can remain in provider backups until they expire **[OPEN: provider's retention]**. After any restore, a deletion ledger (35 days) is replayed so deleted people are deleted again before service resumes; rehearsed on a disposable local database (`docs/dev/deletion-and-restore.md`).
* **Consent for cloud saving**: explicit, separate, recorded server-side with notice version; the database refuses to store progress without it. Turning it on lists exactly what is saved.
* **Minimisation**: sign-in uses Google only; no phone, address, or date of birth (only "confirmed 18+" and when).
* **Security**: see `docs/dev/security-review.md`.
* **Account recovery** does not exist (deliberately; out of scope until an identity-verification threat model is approved). A lost Google account means a lost Grammigo account.

## 5. Questions for counsel **[OPEN]**

1. Which jurisdiction(s) and regimes apply (operator location, learners' locations)? Is there a controller/processor split, and who is the controller?
2. Lawful basis for each purpose (contract, consent, legitimate interests); is a separate cloud-saving consent sufficient and appropriately worded?
3. **Students**: if learners are enrolled through a school/teacher, does that change roles or consent? Is "18 and over only" the right product rule, and is the self-declaration + date record sufficient?
4. Retention periods stated in the notice (especially audit ≥ 90 days, ledger 35 days, backups) and whether an audit log with a cleared actor link is acceptable.
5. International transfers (Singapore project region; US processors) and required safeguards/notices.
6. Whether the export must include the Google id / picture URL / earlier revisions, and the format.
7. Suspended accounts cannot use self-service export/deletion (row-level security requires an active profile). The owner-assisted process is in `docs/dev/suspended-requests.md`: is its identity check (control of the registered email, a cooling-off wait before deletion) adequate, what is the response time, and how should an export file be delivered?
8. Breach notification process and contact addresses; who is the named contact in the notice.
9. Cookie/storage disclosure: are the three cookies "strictly necessary"? Is a banner needed?
10. AI: wording about OpenAI processing and retention; whether learners should confirm before the first AI request.
11. Re-consent: for which kinds of change must existing learners be asked to agree again, and how should they be told? (Not built; see the gate below.)

## 6. Gate before the first real student

- [ ] Counsel has reviewed and approved the notice; bracketed items in the notice are completed; `PRIVACY_NOTICE_VERSION` is changed from `draft-…` to a final version.
- [ ] Processor agreements in place; Supabase region and backup retention verified and stated.
- [ ] Owner approves the notice text. Learners who agreed to a draft version are asked to agree again (the version is recorded per consent).
- [ ] **Re-consent is NOT implemented, and the notice no longer promises it.** What exists: every consent (privacy notice, adult confirmation, cloud saving) is stored with the notice version and time. What does not: any screen or gate that asks existing learners to agree again to a new version. Counsel decides whether and when re-consent is required (Q11); if so it is a separate piece of work (a version check on the learner pages and on saving, an agree-again screen, tests) to be built and approved before the first material change to the notice after launch. Until then a material change cannot be applied to existing learners without it.
- [x] Owner-assisted request process for suspended accounts written down and tested (`docs/dev/suspended-requests.md`); **requires legal and security review before production use**: the identity-verification method, the password-protected delivery of the export and the 72-hour deletion delay are proposals.
