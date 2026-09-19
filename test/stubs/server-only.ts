// Vitest alias target for the "server-only" package (see vitest.config.ts).
// The real package unconditionally throws so bundlers can catch a
// server-only module being pulled into client code — irrelevant under a
// plain Node test runner, so this is just a no-op stand-in.
export {};
