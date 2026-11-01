import Link from "next/link";
import { PRIVACY_NOTICE_VERSION } from "@/lib/auth/constants";

/**
 * The privacy notice for people WITH an account. It is shown only when accounts are switched on, so the public notice never describes a
 * feature that is not running. It is a DRAFT until a qualified lawyer has reviewed it (see docs/legal/); the draft banner and the bracketed
 * gaps are deliberate and must be filled in or removed by that review, not by a developer. Keep this in step with docs/legal/data-inventory.md.
 */
const H2 = "pt-4 text-base font-bold text-ink";
const UL = "list-disc space-y-1 pl-5";

export function PrivacyAccounts() {
  return (
    <section className="space-y-2 text-sm font-medium leading-6 text-ink-2" data-testid="privacy-accounts">
      <p role="note" className="rounded-[14px] border-[1.5px] border-warning-text bg-warning-soft px-4 py-3 font-semibold text-warning-text" data-testid="privacy-draft-banner">
        DRAFT {PRIVACY_NOTICE_VERSION}. This notice has not yet been reviewed by a lawyer and may change before students are invited. Bracketed items [like this] are still to be completed.
      </p>

      <h2 className={H2}>Who runs Grammigo</h2>
      <p>Grammigo is run by [name and address of the operator]. Questions, requests and complaints: [privacy contact email].</p>

      <h2 className={H2}>Without an account</h2>
      <p>You can use Grammigo with no account. Your lessons, answers and progress are saved only in this browser, on your device. Nothing about you is sent to us.</p>

      <h2 className={H2}>With an account</h2>
      <p>Accounts are by invitation, for adults (18 or older). You sign in with Google; Grammigo never sees or stores your Google password.</p>
      <ul className={UL}>
        <li><b>From Google:</b> your email address (and whether Google has verified it), your name, and the address of your Google profile picture. We use your email and name. Our sign-in provider also keeps the Google account id and the picture address in your sign-in record.</li>
        <li><b>What you tell us:</b> your display name, first language (optional), the topics you are practising and the time you have each day, and the date you confirmed you are 18 or older.</li>
        <li><b>Your invitation:</b> the invitation you used is recorded against your profile, so we can tell how many places an invitation has left. The code itself is stored only in scrambled form.</li>
        <li><b>Your agreements:</b> which privacy-notice version you agreed to and when, and when you turned saving on.</li>
        <li>
          <b>Your learning progress, only if you turn saving on:</b> your lesson answers, quick-check answers, goals, and the text you typed or confirmed in Guided Correction. It is kept in your account so you can pick up on another device. Audio is never kept.
          You can turn it off on a device at any time; progress already saved stays until you delete your account.
        </li>
      </ul>

      <h2 className={H2}>Why we use it</h2>
      <p>To let you sign in, keep your progress between devices if you ask us to, keep accounts invitation-only and adults-only, prevent abuse, and meet our legal duties. [Lawful bases, to be completed by legal review.]</p>

      <h2 className={H2}>AI-assisted learning</h2>
      <p>
        Only when AI features are switched on, the text you type about your goals and your short written answers (and, if you choose to speak, a recording of up to 30 seconds) are sent to OpenAI to give feedback or turn your voice into text. Grammigo does <b>not</b> send your name, email or account to OpenAI.
        AI never grades multiple-choice or fill-in answers and never lowers your result. Grammigo does not keep recordings. Please don’t type personal details. OpenAI handles what it receives under its own terms and retention policy.
      </p>

      <h2 className={H2}>Who handles your data</h2>
      <ul className={UL}>
        <li><b>Supabase</b> runs our account database and sign-in. [Region and agreements to be confirmed.]</li>
        <li><b>Google</b> provides the sign-in.</li>
        <li><b>Vercel</b> hosts the app, and keeps ordinary request logs under its own policy.</li>
        <li><b>OpenAI</b> receives text or audio only for the AI features above.</li>
      </ul>
      <p>We do not sell your data, show ads, or use advertising or analytics trackers.</p>

      <h2 className={H2}>Cookies and storage</h2>
      <ul className={UL}>
        <li><b>Sign-in cookie</b> (<code>gm-auth</code>): keeps you signed in. Not readable by page scripts.</li>
        <li><b>Folder cookie</b> (<code>gm-scope</code>): your account number, so this device opens your own saved progress. It grants no access.</li>
        <li><b>Sign-in step cookie</b> (<code>gm-flow</code>): lives for at most 30 minutes while you sign in.</li>
        <li><b>This browser’s storage</b>: your progress on this device, and a small note of when it was last saved. Signing out does not delete it.</li>
      </ul>

      <h2 className={H2}>How long we keep things</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-left text-xs" data-testid="retention-table">
          <caption className="sr-only">Retention periods</caption>
          <thead>
            <tr className="border-b border-line-strong">
              <th scope="col" className="py-1.5 pr-3 font-bold text-ink">What</th>
              <th scope="col" className="py-1.5 font-bold text-ink">How long</th>
            </tr>
          </thead>
          <tbody className="align-top">
            <tr className="border-b border-line"><td className="py-1.5 pr-3">Account, profile, agreements, sign-in record</td><td>Until you delete your account.</td></tr>
            <tr className="border-b border-line"><td className="py-1.5 pr-3">Saved progress (if you turned saving on)</td><td>Until you delete your account. The newest 10 earlier versions are kept for recovery and go with the account.</td></tr>
            <tr className="border-b border-line"><td className="py-1.5 pr-3">Sign-in sessions</td><td>Until you sign out or delete the account; they end if the account is deleted.</td></tr>
            <tr className="border-b border-line"><td className="py-1.5 pr-3">Abuse-prevention counters (a scrambled form of your network address)</td><td>Up to two days.</td></tr>
            <tr className="border-b border-line"><td className="py-1.5 pr-3">A record that an account was deleted (a scrambled id, no personal details)</td><td>35 days, so a restored backup can have your deletion applied again.</td></tr>
            <tr className="border-b border-line"><td className="py-1.5 pr-3">A log that an invitation was used, an export was made or an account was deleted (no names, no content)</td><td>At least 90 days.</td></tr>
            <tr><td className="py-1.5 pr-3">Backups held by our database provider</td><td>[Period to be confirmed.] Deleted data can remain in backups until they expire.</td></tr>
          </tbody>
        </table>
      </div>

      <h2 className={H2}>Your choices</h2>
      <ul className={UL}>
        <li><b>Look at and change</b> your profile any time: <Link href="/account/profile" className="font-bold underline underline-offset-4">Profile</Link>.</li>
        <li><b>Download your data</b> as a file: <Link href="/account/data" className="font-bold underline underline-offset-4">Your data</Link>. It contains only your own records.</li>
        <li><b>Turn saving off</b> on a device, or never turn it on.</li>
        <li><b>Delete your account</b> and everything saved in it: <Link href="/account/delete" className="font-bold underline underline-offset-4">Delete my account</Link>. You are asked to confirm it’s you first. Deleting is permanent.</li>
      </ul>
      <p>If a backup is ever restored, anyone who had asked to be deleted is deleted again before the service is used. [Rights and complaint routes, to be completed by legal review.]</p>

      <h2 className={H2}>Security</h2>
      <p>Connections are encrypted. Each account can only reach its own records, and the database enforces that itself. Invitation codes and sign-in steps are protected against guessing and replay, and requests are rate limited. No system is perfectly secure, and we will tell you if something affects you.</p>

      <h2 className={H2}>Changes</h2>
      <p>If this notice changes in a way that matters, we will tell you and ask you to agree again before it applies to you.</p>
    </section>
  );
}
