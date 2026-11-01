# Privacy notice: placeholders, what can be filled now, and what is left for the owner and counsel

The notice stays a **DRAFT** (`draft-2026-11`) in the app. Nothing below is published as final or approved. "Verified" means checked against the running system or its code today; "claimed" means a vendor statement that has not been checked against our own account.

| Placeholder in the notice | Candidate text | Status | Who completes it |
|---|---|---|---|
| Operator legal name, contact address, jurisdiction | — | **The operator is an individual, not a registered company** (owner statement, 2026-11-01). No company name or address may be invented. The notice says so and leaves the legal name, address and jurisdiction-specific disclosures bracketed | Owner confirms; counsel advises what must be published |
| Privacy contact email | e.g. `privacy@grammigo.si` | Needs a mailbox that exists on the new domain (MX records are not set up) | Owner |
| Supabase region | "in Singapore (ap-southeast-1)" | **Unverified.** Design assumption only; the real region cannot be read without dashboard/CLI access. The region is fixed when a project is created and cannot be changed later | Owner confirms; then fill |
| Backup period | "up to 7 days" (Pro daily backups) | **Claimed** by vendor docs; true only if the project is on Pro. Plan unverified | Owner confirms plan |
| Vercel hosting region | "functions run in [region]" | Unverified (Vercel project not reachable from this session) | Owner / `vercel.json` decision (readiness report §6) |
| Vercel request-log retention | per plan | Unverified | Owner |
| Lawful bases | — | Legal judgement | Counsel |
| Rights and complaint routes (by jurisdiction) | — | Legal judgement | Counsel |
| How learners are told of a material change, and whether re-consent is needed | — | Not built; legal question 11 | Counsel, then a build decision |
| International transfers wording | — | Depends on region and processors' terms | Counsel |
| Processor agreements (Supabase, Vercel, Google, OpenAI) | — | Contracts | Owner / counsel |
| Whether AI features are on for learners | "AI features are currently [on/off]" | Production AI flag is the owner's; the notice's AI section is accurate either way | Owner |

**Already factual and verified in code/tests** (and guarded by architecture tests so the notice cannot drift): the data collected, the three cookies, the retention numbers for the ledger (35 days), audit (≥ 90 days) and rate-limit counters (2 days), export contents, deletion behaviour, that no analytics or advertising trackers exist, and that AI requests carry no account identity.

**Outstanding legal-review decisions** are the eleven questions in `docs/legal/legal-review-pack.md` §5, plus: the suspended-learner process (identity check, delivery, 72-hour delay), the 18-and-over rule and how a school/teacher enrolment would change roles, and cookie/storage disclosure.
