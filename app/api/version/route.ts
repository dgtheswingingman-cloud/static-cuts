// Which build of the site is live (the commit it was built from). The
// desktop app's NIX worker asks every half hour and reloads itself when the
// site has been updated, so a PC left running NIX picks up new code without
// anyone touching it.

export function GET() {
  return Response.json(
    { version: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.VERCEL_DEPLOYMENT_ID ?? "dev" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
