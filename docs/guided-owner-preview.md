# Guided Correction release gate

Production previously treated `NEXT_PUBLIC_GUIDED_PREVIEW=true` as public access even though educator and physical-device acceptance remain pending. This change keeps the preview available only to a verified active owner, using the existing Auth-server identity verification, RLS profile lookup and fresh `is_admin` RPC. No role is granted and no database/authentication configuration changes are needed.

The same public flag now requests owner preview. It cannot authorize a guest or ordinary student. The server route independently gates rendering; entry cards request a private, uncached Boolean from `/api/guided/access`, fail closed on errors and clear authorization across storage-scope changes. Personal pages and access responses are not cacheable. Missing owner status means no preview; verify or separately authorize role management rather than granting a role here.

Disposable browser-test/preview servers may explicitly set server-only `GUIDED_PUBLIC_PREVIEW=true`, with the public preview flag for client affordances. This escape hatch is ignored when `VERCEL_ENV=production`. Development/test behavior and the eventual educator release gate are preserved. Guided voice has its existing separate switch.

No production flags were changed. Shipping this code requires owner release approval. The CI account suite exercises a production-mode server against local Supabase: guests and ordinary students denied, verified owner allowed. Physical-device testing and educator acceptance still gate broad release.
