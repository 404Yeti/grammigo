// `server-only` throws when imported outside a React Server Component bundle. In unit tests that is exactly where we are, so it is
// aliased to this empty module (see vitest.config.mts / vitest.db.config.mts). The real package still guards the production build.
export {};
