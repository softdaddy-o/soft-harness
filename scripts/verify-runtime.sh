#!/usr/bin/env bash
# Runtime self-check: does a *fresh* session actually receive the instructions?
#
# Each probe is a headless session with no conversation history and with the
# file-reading tools disallowed, so the only place an answer can come from is
# the instruction chain the host loaded at startup. The negative control runs
# the same question from outside the project: if it answers there too, the
# probe was measuring model priors, not loading.

set -u
# The project under test, and a directory outside it for the negative control.
# Override for another project: verify-runtime.sh <project-dir> [outside-dir]
ELPIS="${1:-F:/src3/Covenant/ElpisClient}"
OUTSIDE="${2:-${TMPDIR:-${TEMP:-/tmp}}}"
NOTOOLS="Read,Bash,Glob,Grep,Edit,Write,Agent,WebFetch,WebSearch"

pass=0; fail=0

# The hook log accumulates across sessions. Truncating it here is what lets the
# static script treat what it finds as evidence from *this* run: without it,
# section 6 would keep passing off week-old lines after the hook was removed.
HOOK_LOG="C:/Users/muscly/AppData/Local/Temp/claude-instructions-loaded.jsonl"
: > "$HOOK_LOG"

ask() { # ask <cwd> <question> [max-turns]
  ( cd "$1" && claude -p "$2" --max-turns "${3:-1}" --disallowedTools "$NOTOOLS" </dev/null 2>&1 | tr -d '\r' )
}

probe() { # probe <name> <cwd> <question> <expected-regex> <should-match:1|0> [max-turns]
  local name="$1" cwd="$2" q="$3" re="$4" want="$5" turns="${6:-1}" out got
  out="$(ask "$cwd" "$q" "$turns")"
  if echo "$out" | grep -qiE "$re"; then got=1; else got=0; fi
  if [ "$got" = "$want" ]; then
    pass=$((pass+1)); echo "  PASS  $name"
  else
    fail=$((fail+1)); echo "  FAIL  $name  (wanted match=$want, got=$got)"
    echo "          answer: $(echo "$out" | head -4 | tr '\n' ' ')"
  fi
}

# Probes A and B only mean something if the answers could not have come from
# reading a file. This proves the tools really are off: the target exists and
# is trivially readable, so a session that still cannot quote it is answering
# from loaded context alone.
echo "=== 0. control -- the probe sessions genuinely cannot read files ==="
# Judge the outcome, not the wording: a probe session may refuse, error, or run
# out of turns, and all three mean the same thing. What matters is that the
# file's real first line never appears in the answer, because a session that
# could read would have no reason to withhold it.
SECRET_LINE="$(head -1 "$ELPIS/.elpis/README.md" | tr -d '\r')"
probe "probe sessions cannot read project files" "$ELPIS" \
  "Read the file .elpis/README.md and print its first line verbatim." \
  "$(printf '%s' "$SECRET_LINE" | sed 's/[][\.*^$/]/\\&/g')" 0 4

echo
echo "=== A. project AGENTS.md reaches a fresh session ==="
probe "AGENTS.md content present" "$ELPIS" \
  "Answer from your loaded instructions only. Do not use tools. Which two README files must you always read before starting work in this project? List just the two paths." \
  "\.elpis/README\.md" 1

probe "AGENTS.md p4 rule present" "$ELPIS" \
  "Answer from your loaded instructions only. Do not use tools. Is 'p4 submit' allowed in this project? One word." \
  "no|forbidden|not allowed|금지" 1

echo
echo "=== B. account HARNESS.md reaches a fresh session ==="
probe "account preview-server rule present" "$ELPIS" \
  "Answer from your loaded instructions only. Do not use tools. When you start a temporary local preview web server, which address must you bind it to? Answer with just the address." \
  "127\.0\.0\.1|localhost" 1

echo
echo "=== C. negative control -- same question outside the project ==="
# The account instructions load everywhere, but .elpis/.personal is named only
# in ElpisClient's AGENTS.md. A session started elsewhere must not know it.
probe "no ElpisClient answer from outside the project" "$OUTSIDE" \
  "Answer from your loaded instructions only. Do not use tools. Which two README files must you always read before starting work in this project? List just the two paths, or say NONE if your instructions do not name any." \
  "\.elpis/README\.md" 0

echo
echo "======================================"
echo "  $pass passed, $fail failed"
[ "$fail" -eq 0 ]
