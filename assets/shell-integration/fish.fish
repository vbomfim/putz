# Putz shell integration for fish
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

# Sentinel variable prevents double-execution when this snippet
# is sourced multiple times (e.g., subshells, re-sourced rc files).
if not set -q __PUTZ_SHELL_INTEGRATION_LOADED
  set -gx __PUTZ_SHELL_INTEGRATION_LOADED 1

  function __putz_emit_cwd --on-event fish_prompt
    printf '\e]7;file://%s%s\a' (hostname) (string escape --style=url -- $PWD)
    printf '\e]133;P;putz=1\a'
  end
end
