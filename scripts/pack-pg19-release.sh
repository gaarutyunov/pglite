#!/usr/bin/env bash
#
# Pack the PG19 fork build of @electric-sql/pglite into a distributable npm
# tarball, ready to be attached to a GitHub Release on this fork.
#
# This is the producer half of the distribution mechanism documented in the
# README section "PG19 fork builds". The consumer half is an npm URL dependency
# on the released tarball, pinned by the integrity hash in the consumer's
# lockfile.
#
# Prerequisites: packages/pglite has been built, i.e. `pnpm build:all` (or
# `pnpm wasm:build && pnpm ts:build`) has produced packages/pglite/dist with
# pglite.wasm and pglite.data in it.
#
# Usage:
#   scripts/pack-pg19-release.sh [build-number]     # default build number: 1
#
# Outputs, into release-dist/ (override with PG19_RELEASE_OUT):
#   electric-sql-pglite-<version>.tgz   npm-installable package tarball
#   SHA256SUMS                          checksum of the tarball
#   build-info.txt                      provenance of this build
#
# The packed version is <package version>-pg19.<build number>, e.g.
# 0.5.4-pg19.1, so an installed copy self-identifies as a fork build. The
# checked-in packages/pglite/package.json is never modified: packing happens in
# a staging directory.

set -euo pipefail

BUILD_NUMBER="${1:-${PG19_BUILD_NUMBER:-1}}"
case "$BUILD_NUMBER" in
  '' | *[!0-9]*)
    echo "error: build number must be a positive integer, got '$BUILD_NUMBER'" >&2
    exit 1
    ;;
esac

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PKG="$ROOT/packages/pglite"
OUT="${PG19_RELEASE_OUT:-$ROOT/release-dist}"

for path in "$PKG/package.json" "$PKG/dist/pglite.wasm" "$PKG/dist/pglite.data" "$PKG/dist/index.js"; do
  if [ ! -f "$path" ]; then
    echo "error: missing $path" >&2
    echo "       build first: pnpm build:all  (or pnpm ts:build if release/ is populated)" >&2
    exit 1
  fi
done

BASE_VERSION="$(node -p "require('$PKG/package.json').version")"
VERSION="${BASE_VERSION}-pg19.${BUILD_NUMBER}"
TAG="pglite-v${VERSION}"
TARBALL="electric-sql-pglite-${VERSION}.tgz"

PGLITE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
POSTGRES_COMMIT="$(git -C "$ROOT" rev-parse HEAD:postgres-pglite)"
# Read the server version straight out of the wasm rather than trusting the
# submodule pin, so build-info describes the bytes actually being shipped.
PG_VERSION="$(LC_ALL=C grep -a -o -m1 'PostgreSQL [0-9][0-9A-Za-z.]*' "$PKG/dist/pglite.wasm" || true)"
PG_VERSION="${PG_VERSION:-unknown}"

if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no)" ]; then
  DIRTY=" (working tree dirty)"
else
  DIRTY=""
fi

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

cp "$PKG/package.json" "$STAGE/package.json"
# -L: dereference, so a dist/ symlinked in from another build worktree packs
# its real bytes rather than a dangling link.
cp -RL "$PKG/dist" "$STAGE/dist"
[ -f "$PKG/README.md" ] && cp "$PKG/README.md" "$STAGE/README.md"
[ -f "$ROOT/LICENSE" ] && cp "$ROOT/LICENSE" "$STAGE/LICENSE"
[ -f "$ROOT/POSTGRES-LICENSE" ] && cp "$ROOT/POSTGRES-LICENSE" "$STAGE/POSTGRES-LICENSE"

mkdir -p "$OUT"
rm -f "$OUT/$TARBALL" "$OUT/SHA256SUMS" "$OUT/build-info.txt"

(
  cd "$STAGE"
  npm pkg set version="$VERSION" >/dev/null
  npm pack --ignore-scripts --pack-destination "$OUT" >/dev/null
)

[ -f "$OUT/$TARBALL" ] || { echo "error: npm pack did not produce $TARBALL" >&2; exit 1; }

if command -v sha256sum >/dev/null 2>&1; then
  SHA256="$(cd "$OUT" && sha256sum "$TARBALL")"
else
  SHA256="$(cd "$OUT" && shasum -a 256 "$TARBALL")"
fi
printf '%s\n' "$SHA256" >"$OUT/SHA256SUMS"

cat >"$OUT/build-info.txt" <<EOF
package:          @electric-sql/pglite
version:          $VERSION
release tag:      $TAG
postgres:         $PG_VERSION
pglite commit:    $PGLITE_COMMIT$DIRTY
postgres-pglite:  $POSTGRES_COMMIT
sha256:           ${SHA256%% *}
EOF

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  {
    echo "version=$VERSION"
    echo "tag=$TAG"
    echo "tarball=$TARBALL"
    echo "postgres=$PG_VERSION"
    echo "postgres_commit=$POSTGRES_COMMIT"
    echo "sha256=${SHA256%% *}"
  } >>"$GITHUB_OUTPUT"
fi

echo "packed $OUT/$TARBALL"
cat "$OUT/build-info.txt"
