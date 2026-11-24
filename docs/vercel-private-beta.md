# Vercel private beta preparation

## Compatibility and current limitations

The web application uses Next.js 15.5.29, React 19 and npm with a committed lockfile. next.config.js uses the checkout directory as its tracing root and permits TMDB images. No custom server, export mode or build-time database migration is configured. Use the Next.js preset and Node.js 26.x, matching local verification and a currently supported Vercel version. The Git repository root contains package.json; the local publish-checkout directory name is not a Vercel Root Directory. [Node versions](https://vercel.com/docs/functions/runtimes/node-js/node-js-versions)

Public artwork, captions and other files under public are static deployment assets. Their presence in Git does not establish redistribution rights. Confirm rights before making the deployment available. TMDB fetches run server-side, use a fixed HTTPS origin, reject redirects and have ten-second deadlines. The homepage uses one-hour revalidation and API fetches have their existing cache lifetimes. A build with unavailable TMDB can succeed while showing catalog errors and empty rows. Redeploy after changing catalog credentials to avoid retaining that initial cached result.

| Configuration | Expected behavior |
|---|---|
| No secrets, database or gateway | App shell, static assets and demo route render. Catalog rows are empty with existing error feedback. TMDB search/details calls fail gracefully. Registered playback is unavailable and availability is empty. |
| Approved replacement TMDB token and fingerprint only | Real metadata, search, logos, seasons and episodes can work. Catalog playback stays unavailable. Watchlist and progress remain browser-local. |
| TMDB plus complete web production configuration and migrated PostgreSQL | Registry reads and approved-source lookup can work. The reader validates actual SQL privileges. A private object source additionally requires a reachable authorized gateway. |
| Gateway addresses and signing keys without a gateway | Configuration alone cannot establish playable delivery. Keep private sources disabled until actual media checks pass. |

The demo player uses existing externally hosted sample sources. Rendering its route is locally verified; external playback still depends on network, host permission and availability. It does not establish feature-film playback readiness.

Production registry access requires postgres mode, a verified-TLS read URL, an independently generated geo secret, delivery key and HTTPS delivery origin as well as approved TMDB credentials. Missing configuration returns unavailable playback. Do not substitute invented operational addresses or weaken these checks. Country-restricted titles also require authenticated geo injection; an ordinary browser country header is insufficient.

Private administration routes return 404 in production. Keep write/migration URLs, worker tokens and storage credentials outside Vercel. Local JSON operations, filesystem-backed package inspection, long multipart uploads, operator commands, scheduled import sessions and the media gateway belong on separate approved infrastructure. Existing serverless route guards prevent the development admin code from being an operational production dashboard. PostgreSQL can be Neon; use a scoped pooled reader for HTTP requests, direct connections for scheduler session locks and schema work. The gateway is a separate Node service with private origin access and authorization before every cache hit. [Staging runtime guide](private-staging.md)

## Owner dashboard steps after deployment approval

1. Confirm the Vercel account and plan support the proposed private pilot. In team Settings, Deployment Protection, configure Vercel Authentication with All Deployments as the default for new projects before importing. If the account cannot establish this protection before the first deployment, stop and resolve it before pressing Deploy.
2. Add New Project, import jdcr518-problem-solver/netflix-clone, select the intended reviewed branch, and use the repository root. Select Next.js, Node.js 26.x, install command npm ci, build command npm run build, and the framework's default output directory. Keep its default .vercel.app domain.
3. In environment variables, scope beta configuration to the intended environment. Preview builds also run NODE_ENV=production and must obey the production fingerprint policy. A shell-only diagnostic can have no secrets. A functional catalog requires the account-owner-approved replacement TMDB_READ_ACCESS_TOKEN and STREAMFRAME_TMDB_APPROVED_SHA256. Enter them privately; never use NEXT_PUBLIC names. Keep Preview and Production credentials separate.
4. After explicit deployment approval and before inviting testers, open project Settings, Deployment Protection and verify All Deployments covers the project production domain, branch aliases and generated deployment URLs. Standard Protection excludes production domains. Check every alias in a fresh browser session and require the protection screen. Also verify direct API and asset paths are gated.
5. The owner can use Vercel Authentication. For testers without Vercel accounts, use the deployment's Share control to create a revocable Sharable Link. Treat it as a bearer invitation; recipients can forward it. Hobby currently permits one shareable link per account. Revoke it at the end of the session. This adds no StreamFrame viewer account.
6. Verify anonymous app behavior after passing the platform gate, hidden admin routes, unavailable unregistered titles and TMDB error behavior. Confirm build/function logs contain no credentials. Inspect deployment source tracing and public files for private data before enabling any production source.

All Deployments protection is currently documented on all plans. Vercel Authentication normally requires a Vercel account; sharable links provide access without an account. Verify the available controls in the actual account before authorizing the first deployment. [Protection scopes](https://vercel.com/docs/deployment-protection) · [Authentication](https://vercel.com/docs/deployment-protection/methods-to-protect-deployments/vercel-authentication) · [Sharable links](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/sharable-links)

## Credential and infrastructure gates

The local development configuration remains private and separate. The previously disclosed TMDB credential is denied by its one-way fingerprint in production even if its approval pin matches. Rotation has not been completed or attempted. The owner must obtain a replacement, revoke the prior credential, approve its fingerprint and verify provider acceptance/rejection privately. [Rotation procedure](phase9c-operations.md#tmdb-application-token-rotation)

A complete playback beta additionally needs a separate database, reviewed migrations/roles, private gateway listener and edge, authorized storage/CDN, exact-edition distribution evidence, trustworthy country headers and full-length device testing. Verify warm-cache revocation, MP4 ranges, HLS children, audio and captions, denied direct-origin URLs, and key rotation before enabling sources. A temporary Vercel hostname can be the exact player CORS origin. Separate media hosting can use a provider-assigned HTTPS hostname if its controls meet the same requirements.

## Cost and launch decision

A protected frontend pilot can fit an eligible Hobby plan. Confirm current usage allowances, eligible use, build/CPU, image optimization and transfer quotas in the account. Hobby link and external-user limits restrict invitation options. Password protection and increased plan capacity may cost extra. Free viewer access does not establish free infrastructure eligibility. Database compute, media bandwidth, gateway hosting, encoding and log retention have separate quotas and billing. Use the existing small pilot budget and provider alerts before activating services. [Hobby plan](https://vercel.com/docs/plans/hobby) · [Protection pricing](https://vercel.com/docs/deployment-protection)

The code is compatible with a Vercel web deployment subject to platform build verification. A usable private catalog beta remains blocked by credential rotation and verified platform protection. A complete streaming beta also requires the media infrastructure and rights gates. Owner approval must identify the account, plan, protected deployment scope, reviewed commit and permitted beta functionality before project creation or first deployment.
