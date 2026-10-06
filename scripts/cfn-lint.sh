#!/usr/bin/env bash
# Lints the synthesized stack template and records the result in docs/cfn-lint-report.txt (LB AC-6).
# Prerequisite: `npm run synth`. cfn-lint runs through uvx at a pinned version; cfn-guard runs only if it
# is installed (the aws-infrastructure-as-code power's compliance check is recorded in
# docs/power-iac-validation.md). Exits 1 when cfn-lint reports errors or cannot run; warnings are
# recorded (and justified in docs/power-iac-validation.md) without failing.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="infra/cdk.out/KiroManStack.template.json"
REPORT="docs/cfn-lint-report.txt"
CFN_LINT_VERSION="1.57.1"

cd "$ROOT" || exit 1
if [[ ! -f "$TEMPLATE" ]]; then
  echo "cfn-lint: $TEMPLATE not found; run \"npm run synth\" first." >&2
  exit 1
fi
if ! command -v uvx >/dev/null 2>&1; then
  echo "cfn-lint: uvx is not installed (https://docs.astral.sh/uv/)." >&2
  exit 1
fi

mkdir -p docs
lint_output="$(uvx --quiet "cfn-lint==${CFN_LINT_VERSION}" "$TEMPLATE" 2>&1)"
lint_status=$?

if command -v cfn-guard >/dev/null 2>&1; then
  guard_section="$(cfn-guard --version 2>&1)"$'\n'"cfn-guard needs a rules file; see docs/power-iac-validation.md for the power's Guard compliance results."
else
  guard_section="cfn-guard not installed"
fi

{
  echo "cfn-lint report for $TEMPLATE"
  echo "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "Command: uvx cfn-lint==${CFN_LINT_VERSION} $TEMPLATE"
  echo "Exit status: $lint_status (0 = clean; otherwise the sum of 2 = errors, 4 = warnings, 8 = informational)"
  echo
  echo "== cfn-lint =="
  if [[ -n "$lint_output" ]]; then echo "$lint_output"; else echo "No findings."; fi
  echo
  echo "== cfn-guard =="
  echo "$guard_section"
} >"$REPORT"

cat "$REPORT"
if (( lint_status & 3 )); then
  echo "cfn-lint reported errors (exit status $lint_status)." >&2
  exit 1
fi
exit 0
