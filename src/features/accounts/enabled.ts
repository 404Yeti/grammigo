/** Build-time switch for the account PAGES. Off by default: with it off, /join, /signin, /account and /auth/* are 404 and Grammigo is the anonymous app. */
export const accountsEnabled = (): boolean => process.env.NEXT_PUBLIC_ACCOUNTS === "on";
