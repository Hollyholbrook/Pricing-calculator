#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for component in functions cards settings; do
  npm ci --prefix "${root_dir}/src/app/${component}"
done

npm test --prefix "${root_dir}/src/app/functions"
bundle_path="${root_dir}/src/app/functions/QuoteOptionsFunction.bundle.js"
bundle_before="$(git hash-object "${bundle_path}")"
npm run build --prefix "${root_dir}/src/app/functions"
bundle_after="$(git hash-object "${bundle_path}")"
if [[ "${bundle_before}" != "${bundle_after}" ]]; then
  echo "The committed serverless bundle does not match its source. Run npm run build in src/app/functions and commit the bundle." >&2
  exit 1
fi

for component in cards settings; do
  npm run format:check --prefix "${root_dir}/src/app/${component}"
  npm run lint --prefix "${root_dir}/src/app/${component}"
  (cd "${root_dir}/src/app/${component}" && npx tsc --noEmit)
done

echo "All pricing checks passed."
