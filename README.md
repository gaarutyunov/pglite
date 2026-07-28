<p align="center">
  <a href="https://pglite.dev" target="_blank">
    <picture>
      <source media="(prefers-color-scheme: dark)"
          srcset="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo.svg"
      />
      <source media="(prefers-color-scheme: light)"
          srcset="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo-light.svg"
      />
      <img alt="PGlite logo"
          src="https://raw.githubusercontent.com/electric-sql/pglite/main/docs/public/img/brand/logo-light.svg"
      />
    </picture>
  </a>
</p>

<p align="center">
  <a href="https://pglite.dev">PGlite</a> - the WASM build of Postgres from <a href="https://electric.ax" target="_blank">Electric</a>.<br>
  Build reactive, realtime, local-first apps directly on Postgres.
<p>

<p align="center">
  <a href="https://github.com/electric-sql/pglite/stargazers/"><img src="https://img.shields.io/github/stars/electric-sql/pglite?style=social&label=Star" /></a>
  <!-- <a href="https://github.com/electric-sql/pglite/actions"><img src="https://github.com/electric-sql/pglite/workflows/CI/badge.svg" alt="CI"></a> -->
  <a href="https://github.com/electric-sql/pglite/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-Apache_2.0-green" alt="License - Apache 2.0"></a>
  <a href="#roadmap"><img src="https://img.shields.io/badge/status-alpha-orange" alt="Status - Alpha"></a>
  <a href="https://discord.electric-sql.com"><img src="https://img.shields.io/discord/933657521581858818?color=5969EA&label=discord" alt="Chat - Discord"></a>
  <a href="https://x.com/ElectricSQL"><img src="https://img.shields.io/twitter/follow/nestframework.svg?style=social&label=Follow%20@ElectricSQL"></a>
  <a href="https://fosstodon.org/@electric"><img src="https://img.shields.io/mastodon/follow/109599644322136925.svg?domain=https%3A%2F%2Ffosstodon.org"></a>
</p>

# PGlite - Postgres in WASM

![PGlite](https://raw.githubusercontent.com/electric-sql/pglite/main/screenshot.png)

## PG19 fork builds

> This is [`gaarutyunov/pglite`](https://github.com/gaarutyunov/pglite), a fork of
> [`electric-sql/pglite`](https://github.com/electric-sql/pglite) whose `postgres-pglite`
> submodule points at a **PostgreSQL 19** tree carrying SQL/PGQ. Everything below this
> section is upstream's documentation and still applies.

Builds of this fork are **not** published to any registry. They are published as
[GitHub Releases on this repository](https://github.com/gaarutyunov/pglite/releases),
each carrying an `npm pack` tarball of `packages/pglite`:

| asset | what it is |
| --- | --- |
| `electric-sql-pglite-<version>.tgz` | installable npm package tarball |
| `SHA256SUMS` | checksum of the tarball |
| `build-info.txt` | the pglite and postgres-pglite commits it was built from, and the Postgres version read out of the shipped `pglite.wasm` |

Fork builds are versioned `<upstream version>-pg19.<build number>` (e.g. `0.5.4-pg19.1`)
and tagged `pglite-v<that version>`, so an installed copy self-identifies as a fork
build. The package **name** inside the tarball is unchanged, so consumers keep
importing `@electric-sql/pglite`.

### Consuming a build

Install the release asset as a URL dependency — no registry, no credentials, plain
HTTPS from a public repository:

```bash
npm install https://github.com/gaarutyunov/pglite/releases/download/pglite-v0.5.4-pg19.1/electric-sql-pglite-0.5.4-pg19.1.tgz
```

```js
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.query('select version()')
// -> PostgreSQL 19beta2 on wasm32-unknown-linux-gnu ... 32-bit
```

The tarball has no runtime dependencies, so this pulls exactly one package.

**How it is pinned.** `npm install` writes both the resolved URL and a `sha512`
integrity hash into `package-lock.json`; `npm ci` then reproduces exactly those bytes
on every build and fails with `EINTEGRITY` if the asset ever differs. Never point a
consumer at a moving `latest` — every build gets its own immutable tag, and assets are
not replaced in place. pnpm and yarn record the same URL and integrity for URL
dependencies.

### Cutting a build

The build itself needs Docker and takes ~30–50 minutes; consumers never build.

- **From CI:** run the [Publish PG19 build](.github/workflows/publish-pg19-release.yml)
  workflow (`workflow_dispatch`) with the next build number. It builds
  `pnpm build:all:ci` on a GitHub-hosted runner, runs the SQL/PGQ smoke test
  against the result, packs, and creates the release.
  It deliberately does **not** use the `blacksmith-*` runner labels that
  `build_and_test.yml` inherits from upstream — this fork has no Blacksmith runners.
- **From a local build:** once `pnpm build:all` has populated
  `packages/pglite/dist`, run

  ```bash
  scripts/pack-pg19-release.sh <build-number>
  gh release create pglite-v<version> --prerelease --target <commit> \
    release-dist/*.tgz release-dist/SHA256SUMS release-dist/build-info.txt
  ```

`scripts/pack-pg19-release.sh` packs in a staging directory and never modifies the
checked-in `packages/pglite/package.json`.

`build:all:ci` is `build:all` with the wasm build throttled: `build-pglite.sh` runs
`emmake make -j` with no job limit, which a 4-vCPU / 16 GB hosted runner cannot
survive. Set `PGLITE_BUILD_LOAD` to override the load cap. Use plain `build:all`
locally.

### Detecting fork rot

The fork has no CI conformance role, so the browser build can rot silently between
rebases. Two things catch that:

- **`packages/pglite/tests/graph-table.test.ts`** — the only test that exercises the
  feature this fork exists for. It boots the **built** artifact (`packages/pglite/dist`,
  not `src`), runs `CREATE PROPERTY GRAPH` and a set of `GRAPH_TABLE (... MATCH ...)`
  queries, and asserts on the returned rows. Run it by hand once a build exists:

  ```bash
  pnpm -C packages/pglite test:pgq
  ```

  It takes seconds and needs no Docker.

- **[Fork rot check](.github/workflows/fork-rot-check.yml)** — monthly (and on
  `workflow_dispatch`), rebuilds from scratch on a GitHub-hosted runner and then runs
  that same test against the fresh artifact.

The boot is the detector, not the build. This fork has already shipped a defect
(`PostgresMain` calling an undefined `pgl_sigsetjmp`) that survived a green wasm32
compile, ten green native CI legs and a `build-pglite.sh` that exited 0, and only
surfaced when something called `new PGlite()`. A scheduled rebuild that checks the
exit code alone is precisely the check that already passed while the artifact was
broken.

### Why a GitHub Release

The binding constraint is that a downstream Pages workflow must be able to fetch the
build **without credentials**. That ruled out the alternatives:

- **npmjs.com** — publishing a fork to a public registry is an outward-facing act
  needing credentials this repo does not have, and would mean renaming the package.
- **GitHub Packages (`npm.pkg.github.com`)** — its npm registry requires a token for
  *all* reads: "You need an access token to publish, install, and delete private,
  internal, and public packages." A consumer repo's `GITHUB_TOKEN` has no read access
  to a package owned by a different repository without the owner explicitly granting
  it, so this fails the no-authentication constraint.
- **Committing build artifacts** — ~17 MB of `release/` (23 MB unpacked in `dist/`)
  per build, permanently in git history, paid by every clone forever, and the consumer
  would have to reassemble a package from loose files.
- **Actions artifacts** (what `build_and_test.yml` already uploads) — the download API
  requires authentication and artifacts expire, so they are neither anonymous nor
  durable.

PGlite is a WASM Postgres build packaged into a TypeScript client library that enables you to run Postgres in the browser, Node.js, Bun and Deno, with no need to install any other dependencies. It is only 3mb gzipped and has support for many Postgres extensions, including [pgvector](https://github.com/pgvector/pgvector) and [PostGIS](https://postgis.net).

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

It can be used as an ephemeral in-memory database, or with persistence either to the file system (Node/Bun/Deno) or indexedDB (Browser).

Unlike previous "Postgres in the browser" projects, PGlite does not use a Linux virtual machine - it is simply Postgres in WASM.

For full documentation and user guides see [pglite.dev](https://pglite.dev).

## Browser

It can be installed and imported using your usual package manager:

```js
import { PGlite } from "@electric-sql/pglite";
```
or using a CDN such as JSDeliver:

```js
import { PGlite } from "https://cdn.jsdelivr.net/npm/@electric-sql/pglite/dist/index.js";
```

Then for an in-memory Postgres:

```js
const db = new PGlite()
await db.query("select 'Hello world' as message;")
// -> { rows: [ { message: "Hello world" } ] }
```

or to persist the database to indexedDB:

```js
const db = new PGlite("idb://my-pgdata");
```

## Node/Bun/Deno

Install into your project:

**NodeJS**

```bash
npm install @electric-sql/pglite
```

**Bun**

```bash
bun install @electric-sql/pglite
```

**Deno**

```bash
deno add npm:@electric-sql/pglite
```

To use the in-memory Postgres:

```javascript
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.query("select 'Hello world' as message;");
// -> { rows: [ { message: "Hello world" } ] }
```

or to persist to the filesystem:

```javascript
const db = new PGlite("./path/to/pgdata");
```

## How it works

PostgreSQL typically operates using a process forking model; whenever a client initiates a connection, a new process is forked to manage that connection. However, programs compiled with Emscripten - a C to WebAssembly (WASM) compiler - cannot fork new processes, and operates strictly in a single-process mode. As a result, PostgreSQL cannot be directly compiled to WASM for conventional operation.

Fortunately, PostgreSQL includes a "single user mode" primarily intended for command-line usage during bootstrapping and recovery procedures. Building upon this capability, PGlite introduces an input/output pathway that facilitates interaction with PostgreSQL when it is compiled to WASM within a JavaScript environment.

## Limitations

- PGlite is single user/connection.

## How to build PGlite and contribute

The build process of PGlite is split into two parts:

1. Building the Postgres WASM module.
2. Building the PGlite client library and other TypeScript packages.

Docker is required to build the WASM module, along with Node (v20 or above) and [pnpm](https://pnpm.io/) for package management and building the TypeScript packages.

To start checkout the repository and install dependencies:

```bash
git clone --recurse-submodules https://github.com/electric-sql/pglite
cd pglite
pnpm install
```

To build everything, we have the convenient `pnpm build:all` command in the root of the repository. This command will:

1. Use Docker to build the Postgres WASM module. The artifacts produced by this step are then copied to `/packages/pglite/release`.
2. Build the PGlite client library and other TypeScript packages.

To _only_ build the Postgres WASM module (i.e. point 1 above), run

```bash
pnpm wasm:build
```

If you don't want to build the WASM module and assorted WASM binaries from scratch, they are generated automatically on Github after each successful PR merge. You can download the latest binaries by going to the last successfully merged PR and clicking the link after the comment _Interim build files:_. Extract the files and place them under `packages/pglite/release` in your local repo copy.

To build all TypeScript packages (i.e. point 2 of the above), run:

```bash
pnpm ts:build
```

This will build all packages in the correct order based on their dependency relationships. You can now develop any individual package using the `build` and `test` scripts, as well as the `stylecheck` and `typecheck` scripts to ensure style and type validity.

Or alternatively to build a single package, move into the package directory and run:

```bash
cd packages/pglite
pnpm build
```

When ready to open a PR, run the following command at the root of the repository:
```bash
pnpm changeset
```
And follow the instructions to create an appropriate changeset. Please ensure any contributions that touch code are accompanied by a changeset.

## Acknowledgments

PGlite builds on the work of [Stas Kelvich](https://github.com/kelvich) of [Neon](https://neon.tech) in this [Postgres fork](https://github.com/electric-sql/postgres-pglite).

## Sponsors

Big shoutout to everybody supporting us!

### Blacksmith

<a href="https://blacksmith.sh">
  <img src="./docs/img/blacksmith-logo-white-on-black.svg" width="350px"/>
</a>

## License

PGlite is dual-licensed under the terms of the [Apache License 2.0](https://github.com/electric-sql/pglite/blob/main/LICENSE) and the [PostgreSQL License](https://github.com/electric-sql/pglite/blob/main/POSTGRES-LICENSE), you can choose which you prefer.

Changes to the [Postgres source](https://github.com/electric-sql/postgres-pglite) are licensed under the PostgreSQL License.
