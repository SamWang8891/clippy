# GitHub Actions

Three workflows, plus [`../release.yaml`](../release.yaml) which is
configuration rather than a workflow (it groups auto-generated release notes by
label). No workflow here exposes secrets to code from a fork — see
[Trigger safety](#trigger-safety).

| Workflow | Triggers | Does |
|---|---|---|
| [`check_version.yaml`](check_version.yaml) | PR → `main`, push → `main`/`dev` | Fails if the version string disagrees across the 7 files carrying it, and on PRs if it wasn't bumped |
| [`create_release.yaml`](create_release.yaml) | push → `main` | Builds the frontend, assembles the self-host bundle, publishes a GitHub Release with `release.zip` |
| [`docker_publish.yaml`](docker_publish.yaml) | push → `main` | Builds and pushes the image to GHCR, deploys it to EC2 over SSM, verifies the site is serving |

`create_release.yaml` and `docker_publish.yaml` both fire on the same push to
`main` and run independently: one produces the downloadable bundle, the other
updates the live deployment.

---

## `check_version.yaml`

The version is duplicated in seven places, so this asserts they agree:

- `backend/pyproject.toml` — the source of truth the others are compared against
- `backend/app.py` (the `FastAPI(version=...)` argument)
- `frontend/package.json`
- `frontend/src/components/Menu.jsx` (`APP_VERSION`)
- `frontend/src/App.jsx` (the footer string)
- `README.md` and `README.zh-TW.md` (the shields.io badge)

On pull requests it additionally requires the new version to sort strictly above
the base branch's (`sort -V`).

**Bumping a version means editing all seven.** The greps are positional, so
reformatting any of those lines breaks the check even when the value is correct —
`backend/app.py` is matched on `version="`, and would silently produce a
multi-line value if a second occurrence were ever introduced.

Secrets: **none**. Permissions: repository default (read is sufficient).

---

## `create_release.yaml`

Produces the "download and run" bundle for self-hosters:

1. Reads the version from `backend/pyproject.toml`.
2. `npm install && npm run build` in `frontend/`.
3. Stages `docker/`: `backend/.env.example` → `docker/backend/.env`,
   `.env.example` → `.env`, `frontend/public/config.example.json` →
   `docker/frontend/config.json`, plus the built frontend and `app.py`.
4. Deletes `backend/`, `frontend/`, `.github/`, `logo/`, moves the rest into
   `clippy/`, zips it.
5. Publishes a release tagged `v<version>` with `release.zip` attached.

> The staged config must be **JSON named `config.json`** — the frontend does
> `fetch('/config.json')` then `response.json()` (`frontend/src/utils/config.js`).
> A YAML file, or JSON under another name, fails silently: the fetch errors, the
> app falls back to `http://localhost:8123`, and the bundle looks fine until
> someone actually runs it.

Secrets: **none beyond the automatic `GITHUB_TOKEN`**.
Permissions: `contents: write`, to create the release.

---

## `docker_publish.yaml`

Two jobs; `deploy` runs only if `publish` succeeded.

**`publish`** — logs in to GHCR with the automatic `GITHUB_TOKEN` and pushes.
On `main` that is `:latest` plus the immutable `:v<version>`; on a manual
`workflow_dispatch` run it is a single branch-named tag (see
[Testing a branch](#testing-a-branch-before-it-reaches-main)). Exports `version`
as a job output for `deploy`.

The image name is lowercased with `${GITHUB_REPOSITORY,,}`. `github.repository`
preserves the owner's original casing (`SamWang8891/clippy`), and Docker rejects
any reference whose repository name is not lowercase — so interpolating it
directly fails the push with `invalid reference format`.

**`deploy`** — assumes an AWS role via OIDC, sends one SSM command that writes
`CLIPPY_TAG=v<version>` into `/opt/clippy/.env` and runs
`docker compose pull && up -d`, then waits for that command and curls the live
site.

It deploys the immutable tag rather than `:latest` because two merges minutes
apart would otherwise race — run A's deploy could ship run B's image and still
report success for A's commit. Rolling back means editing `CLIPPY_TAG` on the box
and re-running `docker compose up -d`.

`aws ssm send-command` only *queues* work, so the job polls
`get-command-invocation` and fails on any status other than `Success`, then
health-checks `/api/v2/config`. Without both, the workflow goes green on a failed
image pull, a crash-looping container, or an offline SSM agent.

### Required secrets

| Secret | What it is | How to get it |
|---|---|---|
| `AWS_DEPLOY_ROLE_ARN` | IAM role the runner assumes via OIDC | `npx cdk deploy` in the `clippy-infra` repo, then take the `DeployRoleArn` stack output |
| `EC2_INSTANCE_ID` | Target instance, e.g. `i-0abc123…` | The `InstanceId` stack output |

`GITHUB_TOKEN` is injected automatically — do not create it.

Read both values straight from the deployed stack:

```sh
aws cloudformation describe-stacks --stack-name ClippyStack \
  --region ap-southeast-1 \
  --query "Stacks[0].Outputs[?OutputKey=='DeployRoleArn'||OutputKey=='InstanceId']" \
  --output table
```

Then set them under **Settings → Secrets and variables → Actions → New
repository secret**, or:

```sh
gh secret set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::<account>:role/<role>"
gh secret set EC2_INSTANCE_ID     --body "i-0abc123def456"
```

The role's trust policy is scoped to `repo:<owner>/<repo>:ref:refs/heads/main`,
so it can only be assumed by this repository's `main` branch — a fork or a
feature branch presents a different `sub` claim and is rejected by STS.

Both secrets must exist **before this workflow first lands on `main`**, since
that same push is what runs it. Until then the deploy job has nothing to
authenticate with and will fail at the credentials step.

### Testing a branch before it reaches main

`push: [main]` means a branch never produces an image. To build one without
merging, trigger the workflow by hand:

```sh
gh workflow run docker_publish.yaml --ref dev
```

or Actions → *Publish Docker Image* → **Run workflow** → branch `dev`.

A manual run publishes `ghcr.io/samwang8891/clippy:dev` **only** — it never
moves `:latest`, and the `deploy` job is gated on `github.ref == refs/heads/main`
so it does not run at all. Nothing touches a live deployment.

Point a stack at that tag with `npx cdk deploy -c clippy:imageTag=dev`; see
`clippy-infra/README.md`.

### The package must be public

Neither the EC2 `user-data.sh` nor the self-hoster `setup.sh` does a
`docker login`, so `ghcr.io/samwang8891/clippy` has to be a **public** package or
every `docker compose pull` fails. GHCR creates new packages as private, so this
needs setting once after the first publish: Packages → clippy → Package settings
→ Change visibility → Public.

### Hardcoded values

`aws-region` (`ap-southeast-1`) and the health-check URL
(`https://clippy.smashit.tw`) are literals in the workflow. Change both if the
region or domain moves.

---

## Trigger safety

- Every workflow triggers on `push` to a protected branch, or on `pull_request`.
- `check_version.yaml` uses `pull_request`, **not** `pull_request_target`, so a
  fork PR runs without secrets and cannot reach the deploy path.
- The SSM command interpolates only `secrets.EC2_INSTANCE_ID` and a version
  string read from `pyproject.toml` on a `push` trigger — neither is
  attacker-controllable, so the `--parameters` payload is not injectable.
- Jobs declare least-privilege `permissions:`. `deploy` needs only
  `id-token: write` (to mint the OIDC assertion) and `contents: read`; leaving
  it unset makes the job inherit the repository default, which on older repos is
  read-write-all.

## Reproducing CI locally

```sh
# the version assertions
grep -Po '(?<=^version = ")[^"]+' backend/pyproject.toml

cd backend && .venv/bin/python -m pytest -q && .venv/bin/python -m ruff check .
cd ../frontend && npx eslint src && npm run build
cd .. && docker build -t clippy:test .
```
