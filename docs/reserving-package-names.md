# Reserving the SDK package names

Step-by-step for claiming the StampMitra names in all seven registries **before** anyone else does, and for wiring GitHub release workflows to publish without long-lived tokens where the registry supports it.

Conventions used below:

- GitHub owner: `Bani-Global-Industries-LLP`. Repos: `stampmitra-developer-{node,python,php,java,go,dotnet,ruby}`. Release workflow file in every repo: `release.yml` (triggered by pushing a `vX.Y.Z` tag).
- Registry UIs change. Anything marked **verify in the registry UI** is from memory of the current flow and must be checked on screen before relying on it. Steps without that mark are stable (they match the release workflows already in `stampmitra-developer-node`, `-python`, `-php`).
- Use a shared organisation mailbox (not a personal one) as the registry owner, turn on 2FA/MFA everywhere, and record recovery codes in the company password manager. Never put registry tokens in repos; the publish jobs are inert until the repository variable below is set to `true`.
- Nothing here publishes anything. Reserving a name is separate from the first release.

| Ecosystem | Name to claim | Repo | GitHub variable to flip (Settings > Secrets and variables > Actions > Variables) | Keyless (OIDC) publishing |
|---|---|---|---|---|
| npm | scope `@stampmitra`, package `@stampmitra/sdk` | `stampmitra-developer-node` | `NPM_PUBLISH=true` | yes (trusted publisher) |
| PyPI | project `stampmitra` | `stampmitra-developer-python` | `PYPI_PUBLISH=true` | yes (trusted publisher, env `pypi`) |
| Packagist | vendor `stampmitra`, package `stampmitra/stampmitra-php` | `stampmitra-developer-php` | none (Packagist pulls tags via webhook/app) | n/a |
| Maven Central | namespace `in.stampmitra` | `stampmitra-developer-java` | `MAVEN_PUBLISH=true` (proposed) | no: token + GPG key as secrets (verify) |
| Go | module `github.com/Bani-Global-Industries-LLP/stampmitra-developer-go` | `stampmitra-developer-go` | none (a tag is the release) | n/a |
| NuGet | ID prefix `StampMitra.`, package `StampMitra.Sdk` | `stampmitra-developer-dotnet` | `NUGET_PUBLISH=true` (proposed) | yes (verify) |
| RubyGems | gem `stampmitra` | `stampmitra-developer-ruby` | `RUBYGEMS_PUBLISH=true` (proposed) | yes (trusted publisher, verify) |

The variable names for Java, .NET and Ruby are a proposal for consistency; match whatever the `release.yml` in those repos actually reads.

---

## 1. npm (`@stampmitra/sdk`)

1. Sign in at https://www.npmjs.com (shared mailbox), enable 2FA (Account > Two-Factor Authentication, "Authorization and publishing").
2. Create the organisation: avatar menu > **Add Organization** (https://www.npmjs.com/org/create), name `stampmitra`, choose the free plan (public packages). This reserves the scope `@stampmitra`. Add the other maintainers as owners/members.
3. The first publish creates the package. Either:
   - **Manual first publish** (reserves the name immediately): from `stampmitra-developer-node` at a clean tag, `npm login && npm publish --access public`. Scoped packages are private by default, so `--access public` is required.
   - or configure the trusted publisher first if the UI lets you for a not-yet-existing package (**verify in the registry UI**; the usual flow is to publish once, then configure).
4. Trusted publisher (keyless, with provenance): npmjs.com > package `@stampmitra/sdk` > **Settings** > **Trusted Publisher** > GitHub Actions, then enter:
   - Organization or user: `Bani-Global-Industries-LLP`
   - Repository: `stampmitra-developer-node`
   - Workflow filename: `release.yml`
   - Environment name: leave empty (the node `release.yml` job declares no `environment:`; if you add one, enter the same name here)

   Trusted publishing needs a recent npm CLI (11.5.1 or newer) on the runner (**verify the minimum version in the npm docs**); the workflow already has `id-token: write` and publishes with `npm publish --provenance --access public`.
5. Flip `NPM_PUBLISH` to `true` in the `stampmitra-developer-node` repo variables. Cut a release by pushing `v0.1.0`.
6. Optional hardening: on the package, set "Require two-factor authentication and disallow tokens" once trusted publishing works (**verify in the registry UI**).

## 2. PyPI (`stampmitra`)

1. Create an account at https://pypi.org (shared mailbox) and enable 2FA (Account settings > Two factor authentication). Registering the same account on https://test.pypi.org is optional but handy for a dry run.
2. Add a **pending publisher** (this lets the very first release create the project, with no token): https://pypi.org/manage/account/publishing/ > "Add a new pending publisher" > GitHub, then enter:
   - PyPI Project Name: `stampmitra`
   - Owner: `Bani-Global-Industries-LLP`
   - Repository name: `stampmitra-developer-python`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. A pending publisher does **not** hold the name until the first successful publish; if you want the name locked now, publish `0.1.0` manually (`python -m build && twine upload dist/*` with a short-lived API token) and then add the trusted publisher on the project's **Publishing** page with the same five values.
4. In GitHub, `stampmitra-developer-python` > Settings > Environments > **New environment** `pypi` (optionally add required reviewers so a human approves each release).
5. Flip the repo variable `PYPI_PUBLISH` to `true`. The `publish` job uses `pypa/gh-action-pypi-publish@release/v1` with `id-token: write`; no secrets.
6. Optional: a PyPI organisation for the project (**verify in the registry UI**, organisation accounts may require approval).

## 3. Packagist (`stampmitra/stampmitra-php`)

Composer vendors are not a separate registration: the vendor `stampmitra` is owned by whoever submits the first package under it, so submit promptly.

1. Sign in at https://packagist.org (the GitHub login is simplest) with the organisation account and enable 2FA.
2. https://packagist.org/packages/submit > Repository URL `https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-php` > Check > Submit. The name `stampmitra/stampmitra-php` comes from `composer.json`. Packagist needs the repo's default branch and tags to exist (the repos currently have no `main`; create it first, **verify in the registry UI**).
3. Auto-update, one of:
   - **Packagist GitHub app** (recommended): install it on the repo/org from the package page's "Enable auto-update" prompt.
   - **Webhook**: GitHub repo > Settings > Webhooks > Add webhook: Payload URL `https://packagist.org/api/github?username=<packagist-username>`, content type `application/json`, secret = the API token from your Packagist profile (Profile > Show API Token), event "Just the push event".
4. No GitHub variable: `release.yml` only creates the GitHub Release; Packagist reads the tag. Optionally protect the `v*` tag pattern in GitHub (Settings > Rules).

## 4. Maven Central (`in.stampmitra`)

Maven Central publishing goes through the **Sonatype Central Portal** (https://central.sonatype.com). The legacy OSSRH (`s01.oss.sonatype.org`) flow is retired; do not use it.

1. Sign in at https://central.sonatype.com (GitHub, Google or email).
2. **Account** > **View Namespaces** > **Add Namespace**, enter `in.stampmitra` (reverse of the domain `stampmitra.in`, which the company owns).
3. Central shows a verification key. Verify domain ownership with a **DNS TXT record**: at the DNS host for `stampmitra.in`, create a TXT record on the apex host (`@`, i.e. `stampmitra.in`) whose value is exactly the key shown (**verify the exact host and value format in the registry UI**; it is the key string Central generates for that namespace). Wait for propagation (`dig +short TXT stampmitra.in`), then click **Verify Namespace**. Status becomes "Verified" and the namespace is yours; groupId `in.stampmitra` (and sub-groups like `in.stampmitra.sdk`) can now be published.
4. Publishing credentials (Central does not offer GitHub OIDC trusted publishing as far as we know; **verify in the registry UI**): Account > **Generate User Token** (a username/password pair for the publishing plugin), and a GPG key pair for signing (`gpg --full-generate-key`, publish the public key to `keyserver.ubuntu.com` and `keys.openpgp.org`). Store the token pair and the armored private key + passphrase as GitHub **secrets** in `stampmitra-developer-java`, ideally scoped to an environment `maven-central` with required reviewers.
5. Build with the `central-publishing-maven-plugin` (`org.sonatype.central`) or Gradle equivalent; Central requires sources jar, javadoc jar, signatures and a complete POM (name, description, url, licenses, developers, scm). Suggested coordinates: `in.stampmitra:stampmitra-sdk`.
6. Flip `MAVEN_PUBLISH` to `true` (proposed variable) when the Java `release.yml` is ready. Published versions are immutable.

## 5. Go (`github.com/Bani-Global-Industries-LLP/stampmitra-developer-go`)

Go has no registry to reserve a name in: the module path is the repo path, and the owner of the GitHub org owns it.

1. `go.mod` in `stampmitra-developer-go` must start with `module github.com/Bani-Global-Industries-LLP/stampmitra-developer-go`. (A vanity path such as `stampmitra.in/...` would need an HTML `go-import` meta tag served from that domain; not recommended for v0.)
2. Release = push a semver tag: `git tag v0.1.0 && git push origin v0.1.0`. From v2 onward the module path must end in `/v2` (and so on).
3. pkg.go.dev indexes automatically after the first fetch through the proxy. Trigger it: `GOPROXY=https://proxy.golang.org go list -m github.com/Bani-Global-Industries-LLP/stampmitra-developer-go@v0.1.0`, then open https://pkg.go.dev/github.com/Bani-Global-Industries-LLP/stampmitra-developer-go (use the page's **Request** button if it says the module is not found). Docs render only when the repo has a recognised OSI licence file (MIT `LICENSE` is fine).
4. No GitHub variable; a tag is the release. Do not move or delete published tags (the proxy caches them permanently); to retract a version add a `retract` directive in `go.mod` in a later release.

## 6. NuGet (`StampMitra.*`)

1. Sign in at https://www.nuget.org with a Microsoft account for the company, enable 2FA, and (recommended) create an **organization** under Account to own the packages (**verify in the registry UI**).
2. **ID prefix reservation** (so only you can publish `StampMitra.*`): request it from the nuget.org site, Account menu > "Request ID prefix reservation" or the form described at https://learn.microsoft.com/nuget/nuget-org/id-prefix-reservation (**verify in the registry UI** which entry point is current; historically it was an email/form reviewed manually, taking a few days). Request prefix `StampMitra.` and be ready to show that you own `stampmitra.in` / the brand. Reserved packages get a padlock badge.
3. First package: `StampMitra.Sdk`. Until the prefix is approved, push `0.1.0` early to hold the exact ID: create an API key (Account > API Keys, scope Push, glob `StampMitra.*`, short expiry) and `dotnet nuget push StampMitra.Sdk.0.1.0.nupkg -k <key> -s https://api.nuget.org/v3/index.json`.
4. Trusted publishing from GitHub Actions (OIDC via the `NuGet/login` action) exists on nuget.org (**verify in the registry UI**: Account > Trusted Publishing, with owner `Bani-Global-Industries-LLP`, repo `stampmitra-developer-dotnet`, workflow `release.yml`, optional environment `nuget`). Otherwise store the API key as a secret in an environment.
5. Flip `NUGET_PUBLISH` to `true` (proposed variable).

## 7. RubyGems (`stampmitra`)

RubyGems has no namespace reservation; a name is held by whoever pushes the first version.

1. Create an account at https://rubygems.org (shared mailbox) and enable MFA (Profile > Edit Profile > Multifactor Authentication, "UI and API"). Also set `spec.metadata["rubygems_mfa_required"] = "true"` in the gemspec.
2. Hold the name immediately by pushing `0.1.0` once: `gem build stampmitra.gemspec && gem push stampmitra-0.1.0.gem` (signs in on first use; uses MFA).
3. Trusted publisher: https://rubygems.org/gems/stampmitra > **Trusted Publishers** (gem owner view) > Create > GitHub Actions with owner `Bani-Global-Industries-LLP`, repository `stampmitra-developer-ruby`, workflow `release.yml`, environment optional (suggest `rubygems`). A **pending** trusted publisher for a not-yet-created gem is available at https://rubygems.org/profile/oidc/pending_trusted_publishers (**verify in the registry UI**).
4. Publish from CI with `rubygems/release-gem@v1` and `id-token: write`; no API key.
5. Flip `RUBYGEMS_PUBLISH` to `true` (proposed variable).

---

## Final checklist

- [ ] npm org `stampmitra` created; `@stampmitra/sdk` owned; trusted publisher set; `NPM_PUBLISH` flipped
- [ ] PyPI `stampmitra` held; trusted publisher (env `pypi`) set; GitHub env `pypi` created; `PYPI_PUBLISH` flipped
- [ ] Packagist `stampmitra/stampmitra-php` submitted; webhook / app active
- [ ] Central Portal namespace `in.stampmitra` verified via DNS TXT; token + GPG key stored as secrets
- [ ] Go module path in `go.mod` matches the repo; first tag fetched through `proxy.golang.org`
- [ ] NuGet prefix `StampMitra.` requested and approved
- [ ] RubyGems `stampmitra` held; trusted publisher set
- [ ] DNS owner for `stampmitra.in` and the shared registry mailbox documented in the company password manager
