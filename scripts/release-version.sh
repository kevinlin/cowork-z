#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────
# release-version.sh
# Bumps the app version, updates all version files,
# adds an UPDATE_LOG entry, builds, commits, and pushes.
#
# Usage:
#   ./scripts/release-version.sh           # patch bump (default)
#   ./scripts/release-version.sh --patch   # patch bump
#   ./scripts/release-version.sh --minor   # minor bump
#   ./scripts/release-version.sh --major   # major bump
# ─────────────────────────────────────────────

show_help() {
  cat <<EOF
Usage: $0 [OPTION]

Bump the app version, update version files, build, commit, and push.

Options:
  --major    Bump major version  (0.x.x → 1.0.0)
  --minor    Bump minor version  (x.0.x → x.1.0)
  --patch    Bump patch version  (x.x.0 → x.x.1)  [default]
  -h, --help Show this help message and exit

Files updated:
  package.json, src-tauri/Cargo.toml, src-tauri/tauri.conf.json, UPDATE_LOG.md
EOF
  exit 0
}

# Show help if requested (check before anything else)
case "${1:-}" in
  -h|--help) show_help ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Verify we are on the main branch ──────────────────────────────
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "❌ Error: Must be on 'main' branch to release (currently on '$CURRENT_BRANCH')."
  exit 1
fi

# ── 2. Read current version from package.json ────────────────────────
CURRENT_VERSION="$(node -p "require('./package.json').version")"
echo "📦 Current version: $CURRENT_VERSION"

IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"

# ── 3. Determine bump type (default: --patch) ────────────────────────
BUMP="${1:---patch}"

case "$BUMP" in
  --major)
    MAJOR=$((MAJOR + 1))
    MINOR=0
    PATCH=0
    ;;
  --minor)
    MINOR=$((MINOR + 1))
    PATCH=0
    ;;
  --patch)
    PATCH=$((PATCH + 1))
    ;;
  *)
    echo "❌ Unknown argument: $BUMP"
    echo "Usage: $0 [--major | --minor | --patch]"
    exit 1
    ;;
esac

NEW_VERSION="${MAJOR}.${MINOR}.${PATCH}"
echo "🚀 New version:     $NEW_VERSION"

# ── 4. Update version in all three files ─────────────────────────────

# package.json — update the "version" field
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json
echo "  ✅ package.json"

# src-tauri/Cargo.toml — update the version line in [package]
sed -i '' "s/^version = \"$CURRENT_VERSION\"/version = \"$NEW_VERSION\"/" src-tauri/Cargo.toml
echo "  ✅ src-tauri/Cargo.toml"

# src-tauri/tauri.conf.json — update the "version" field
sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" src-tauri/tauri.conf.json
echo "  ✅ src-tauri/tauri.conf.json"

# ── 5. Add new section to UPDATE_LOG.md ──────────────────────────────
# Insert a new version header right after the "# UPDATE LOG" title line
sed -i '' "s/^# UPDATE LOG$/# UPDATE LOG\\
\\
## v${NEW_VERSION}\\
\\
- /" UPDATE_LOG.md
echo "  ✅ UPDATE_LOG.md"

# ── 6. Build ─────────────────────────────────────────────────────────
echo ""
echo "🔨 Running pnpm tauri build …"
pnpm tauri build

# ── 7. Commit and push ───────────────────────────────────────────────
echo ""
echo "📝 Committing and pushing …"
git add package.json src-tauri/Cargo.toml src-tauri/tauri.conf.json UPDATE_LOG.md
git commit -m "Release version ${NEW_VERSION}"
git push

echo ""
echo "🎉 Released v${NEW_VERSION} successfully!"
