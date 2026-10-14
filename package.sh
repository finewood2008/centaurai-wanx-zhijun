#!/usr/bin/env bash
set -euo pipefail

# ./package.sh           读取 market-release.local.json
# ./package.sh 0.4.7     指定发行版本，不修改源码版本
# 其他参数直接传给市场打包工具，例如 --out、--config、--help。
script_dir="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

if [[ $# -gt 0 && "$1" != -* ]]; then
  release_version="$1"
  shift
  set -- --version "$release_version" "$@"
fi

exec node "$script_dir/tools/package-market.mjs" "$@"
