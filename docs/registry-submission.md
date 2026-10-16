# Registry submission checklist (v0.1.0)

Ordered, owner-only steps to get the seven SDKs published. Companion to [reserving-package-names.md](reserving-package-names.md) (background and rationale). Every SDK `main` was verified on 2026-10-16: it builds the real distributable, installs into a fresh project and makes a call against `scripts/mock-server.mjs`. Nothing has been published, tagged or configured on any registry.

Registry UIs change; fields marked *(verify on screen)* come from the current flow as we know it. Do not paste tokens into repos. Use a shared company mailbox, enable 2FA/MFA everywhere, keep recovery codes in the password manager.

## Facts that differ from older notes

| Item | Actual value |
|---|---|
| Maven coordinates | `in.stampmitra:stampmitra-java:0.1.0` (not `stampmitra-sdk`) |
| NuGet packages | `StampMitra` and `StampMitra.Extensions.DependencyInjection` (not `StampMitra.Sdk`); reserve prefix `StampMitra` |
| Go module path | `github.com/Bani-Global-Industries-LLP/stampmitra-developer-go` (capitals are significant) |
| Default branch | `main` exists in all repos, all public |
| Go release variable | `RELEASE_ENABLED` (optional; gates only the GitHub release and proxy poke) |

## Repo variables and environments (what the workflows actually read)

| Repo | Variable (Settings > Secrets and variables > Actions > Variables) | GitHub environment to create | Secrets |
|---|---|---|---|
| node | `NPM_PUBLISH=true` | none | none |
| python | `PYPI_PUBLISH=true` | `pypi` | none |
| php | none (tag creates the GitHub release; Packagist pulls the tag) | none | none |
| java | `MAVEN_PUBLISH=true` | `maven-central` (required reviewers) | `CENTRAL_USERNAME`, `CENTRAL_PASSWORD`, `MAVEN_GPG_PRIVATE_KEY`, `MAVEN_GPG_PASSPHRASE` |
| go | `RELEASE_ENABLED=true` (optional) | none | none |
| dotnet | `NUGET_PUBLISH=true` and `NUGET_USER=<nuget.org profile name>` | none | none |
| ruby | `RUBYGEMS_PUBLISH=true` | `rubygems` | none |

Without its variable each publish job is skipped. Tag pushes still build and test. php and dotnet still create a GitHub release for the tag (go and java only with their variable).

## Order of work

1. Merge the open `claude/registry-ready` PRs (node, python, php, dotnet) so the tag is cut from the final `main`.
2. Start the slow ones first: step A (Maven DNS) and step B (NuGet prefix).
3. Reserve the remaining names and configure trusted publishers (C to F).
4. Set the variables (last, after the registry side is ready).
5. Tag `v0.1.0` in each repo.
6. Post-tag: Packagist, pkg.go.dev, Maven Portal "Publish".

## 0. Prerequisites

- Shared mailbox as owner on every registry; 2FA on; recovery codes stored.
- DNS admin access to `stampmitra.in`.
- A machine with `gpg` (for Maven).

## A. Maven Central (slowest: DNS + GPG)

1. https://central.sonatype.com > sign in > **Account** > **View Namespaces** > **Add Namespace**. Namespace: `in.stampmitra`.
2. Central shows a **verification key** (string). At the `stampmitra.in` DNS host create a **TXT** record: Host `@` (apex, `stampmitra.in`), Value = the key exactly, TTL 300. *(verify on screen: host and value format)* Check: `dig +short TXT stampmitra.in`.
3. Click **Verify Namespace**; wait for status **Verified**.
4. **Account** > **Generate User Token**. Save username/password as secrets `CENTRAL_USERNAME` / `CENTRAL_PASSWORD` in the `maven-central` environment of `stampmitra-developer-java`.
5. `gpg --full-generate-key` (RSA 4096 or Ed25519). Publish the public key: `gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>` and `keys.openpgp.org`. Secrets: `MAVEN_GPG_PRIVATE_KEY` = `gpg --armor --export-secret-keys <KEYID>`, `MAVEN_GPG_PASSPHRASE`.
6. Create environment `maven-central` with required reviewers; add the four secrets there.
7. Later (after tag): https://central.sonatype.com/publishing/deployments > the validated deployment > **Publish** (the pom sets `autoPublish=false`). Versions are immutable.

## B. NuGet (prefix review takes days)

1. https://www.nuget.org > sign in with the company Microsoft account, enable 2FA, optionally create an organization to own the packages.
2. Request **ID prefix reservation** (Account menu; see https://learn.microsoft.com/nuget/nuget-org/id-prefix-reservation) *(verify on screen)*: Prefix `StampMitra` (covers `StampMitra` and `StampMitra.*`); owner = your account/org; justification: official StampMitra developer SDK, domain `stampmitra.in`, repo `https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-dotnet`.
3. Account > **Trusted Publishing** > add policy *(verify on screen)*: Repository Owner `Bani-Global-Industries-LLP`, Repository `stampmitra-developer-dotnet`, Workflow File `release.yml`, Environment empty. One policy covers both packages. If it cannot be created before the packages exist, publish 0.1.0 once manually with a short-lived API key (Account > API Keys, Push scope, glob `StampMitra*`, 1 day expiry): `dotnet nuget push StampMitra.0.1.0.nupkg -k <key> -s https://api.nuget.org/v3/index.json` and the same for `StampMitra.Extensions.DependencyInjection.0.1.0.nupkg`; revoke the key; leave `NUGET_PUBLISH` unset until 0.1.1.
4. Repo variables: `NUGET_USER` = nuget.org profile name (not email); `NUGET_PUBLISH=true` (last).

## C. PyPI (pending trusted publisher: no manual upload needed)

1. https://pypi.org > register, enable 2FA.
2. https://pypi.org/manage/account/publishing/ > **Add a new pending publisher** > GitHub:
   - PyPI Project Name: `stampmitra`
   - Owner: `Bani-Global-Industries-LLP`
   - Repository name: `stampmitra-developer-python`
   - Workflow name: `release.yml`
   - Environment name: `pypi`
3. GitHub `stampmitra-developer-python` > Settings > Environments > New environment `pypi` (optional required reviewers).
4. Variable `PYPI_PUBLISH=true`. Note: the pending publisher does not hold the name until the first release succeeds.

## D. RubyGems (pending trusted publisher)

1. https://rubygems.org > sign up, enable MFA ("UI and API").
2. https://rubygems.org/profile/oidc/pending_trusted_publishers > create *(verify on screen)*: Gem name `stampmitra`; Owner `Bani-Global-Industries-LLP`; Repository `stampmitra-developer-ruby`; Workflow `release.yml`; Environment `rubygems`.
3. GitHub environment `rubygems`; variable `RUBYGEMS_PUBLISH=true`.

## E. npm (first publish cannot be keyless)

1. https://www.npmjs.com > sign in, enable 2FA ("Authorization and publishing").
2. https://www.npmjs.com/org/create > name `stampmitra`, free plan (reserves scope `@stampmitra`).
3. A trusted publisher can only be added to an existing package. So publish 0.1.0 once by hand from a clean checkout of the tag: `git checkout v0.1.0 && npm ci && npm run build && npm login && npm publish --access public`.
4. Package `@stampmitra/sdk` > **Settings** > **Trusted Publisher** > GitHub Actions: Organization `Bani-Global-Industries-LLP`; Repository `stampmitra-developer-node`; Workflow filename `release.yml`; Environment empty.
5. Leave `NPM_PUBLISH` unset for 0.1.0 (already published); set `NPM_PUBLISH=true` before tagging `v0.1.1`. The workflow upgrades npm to 11.5.1+ itself.

## F. Packagist and Go (no variables)

- **Packagist** (after the tag exists): https://packagist.org/packages/submit > Repository URL `https://github.com/Bani-Global-Industries-LLP/stampmitra-developer-php` > Check > Submit. Name comes from `composer.json`: `stampmitra/stampmitra-php`. Then enable auto-update: install the Packagist GitHub app, or add a repo webhook with Payload URL `https://packagist.org/api/github?username=<packagist-user>`, Content type `application/json`, Secret = API token from your Packagist profile, event "Just the push event".
- **Go / pkg.go.dev**: nothing to register. After the tag: `GOPROXY=https://proxy.golang.org go list -m github.com/Bani-Global-Industries-LLP/stampmitra-developer-go@v0.1.0`, then open https://pkg.go.dev/github.com/Bani-Global-Industries-LLP/stampmitra-developer-go@v0.1.0 (use **Request** if missing). Never move or delete the tag.

## G. Tag v0.1.0 (each repo, from up-to-date `main`)

Set the variables from the table first (all except node and, if you used the manual route, nuget). Then in each of `stampmitra-developer-{node,python,php,java,go,dotnet,ruby}`:

```sh
git checkout main && git pull --ff-only origin main
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

Each workflow fails fast if the tag does not match the version in the code (all are 0.1.0). Recommended tag order: python, ruby, dotnet, java, go, php, node (the keyless ones first, so failures show before the manual steps).

## H. After publishing

- Confirm each registry page renders the README, license (MIT) and links.
- Update the badges note in each README ("not yet published").
- Tick the checklist in `reserving-package-names.md`.
