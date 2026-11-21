# >>> egehan >>>
# Added by Egehan {version} — `egehan hook install`. Everything between these markers is
# rewritten on the next install and removed by `egehan hook uninstall`, so edit outside them.
#
# This block never writes to the repository: no `git add`, no `git commit`, no `git stash`.
# It regenerates the chronicle in the background and returns, so `git {verb}` never waits for it.
egehan_chronicle() {
  # Guard against recursion and give people a documented way to switch it off for one command.
  if [ -n "$EGEHAN_HOOK" ] || [ -n "$EGEHAN_SKIP_HOOK" ]; then
    return 0
  fi

  egehan_git_dir=$(git rev-parse --git-dir 2>/dev/null) || return 0

  # Mid-operation states: a rebase replays many commits, and each one would fire this hook.
  for egehan_state in rebase-merge rebase-apply MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
    if [ -e "$egehan_git_dir/$egehan_state" ]; then
      return 0
    fi
  done

  egehan_root=$(git rev-parse --show-toplevel 2>/dev/null) || return 0

  if [ -x "$egehan_root/node_modules/.bin/egehan" ]; then
    egehan_bin="$egehan_root/node_modules/.bin/egehan"
  elif command -v egehan >/dev/null 2>&1; then
    egehan_bin=egehan
  else
    # Not installed on this machine: stay silent rather than nag on every commit.
    return 0
  fi

  (
    EGEHAN_HOOK=1 "$egehan_bin" generate --quiet >/dev/null 2>&1 </dev/null &
  ) >/dev/null 2>&1

  return 0
}

egehan_chronicle
# <<< egehan <<<
