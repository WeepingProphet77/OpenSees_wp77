#!/usr/bin/env bash
# Fetch Eigen headers to the path OpenSees documents for them.
#
# The fork's .gitmodules references Eigen at OTHER/eigenAPI/eigen, but the
# submodule gitlink was never committed to the tree, so `git submodule update`
# cannot populate it. Eigen is header-only, so we fetch it as a build-time
# dependency (NOT committed) — locally and in CI alike.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
DEST="$REPO_ROOT/OTHER/eigenAPI/eigen"
EIGEN_REF="${EIGEN_REF:-3.4.0}"

if [ -f "$DEST/Eigen/Dense" ]; then
  echo "Eigen already present at $DEST"
  exit 0
fi

echo "Fetching Eigen ($EIGEN_REF) to $DEST"
git clone --depth 1 --branch "$EIGEN_REF" https://gitlab.com/libeigen/eigen.git "$DEST"
test -f "$DEST/Eigen/Dense" && echo "Eigen headers OK"
