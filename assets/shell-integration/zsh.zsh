# Putz shell integration for zsh
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

# Sentinel variable prevents double-execution when this snippet
# is sourced multiple times (e.g., subshells, re-sourced rc files).
if [[ -z "${__PUTZ_SHELL_INTEGRATION_LOADED:-}" ]]; then
  typeset -g __PUTZ_SHELL_INTEGRATION_LOADED=1

  __putz_urlencode() {
    local s="$1" out="" i c
    for (( i = 1; i <= ${#s}; i++ )); do
      c="${s[i]}"
      case "$c" in
        [a-zA-Z0-9._~/-]) out+="$c" ;;
        *) out+="$(printf '%%%02X' "'$c")" ;;
      esac
    done
    printf '%s' "$out"
  }

  __putz_emit_cwd() {
    # OSC 7 + putz handshake — emitted on every prompt
    printf '\e]7;file://%s%s\a' "${HOST:-localhost}" "$(__putz_urlencode "$PWD")"
    printf '\e]133;P;putz=1\a'
  }

  # Idempotent registration via add-zsh-hook
  autoload -Uz add-zsh-hook
  add-zsh-hook precmd __putz_emit_cwd
fi
