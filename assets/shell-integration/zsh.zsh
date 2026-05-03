# Putz shell integration for zsh
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

__putz_osc7_cwd() {
    printf '\e]7;file://%s%s\a' "${HOST:-localhost}" "$PWD"
}

__putz_handshake() {
    printf '\e]133;P;putz=1\a'
}

# Use precmd hooks (zsh-idiomatic). Guard against double-sourcing.
if (( ! ${+functions[__putz_osc7_cwd]} )); then
    autoload -Uz add-zsh-hook 2>/dev/null
    if (( ${+functions[add-zsh-hook]} )); then
        add-zsh-hook precmd __putz_osc7_cwd
        add-zsh-hook precmd __putz_handshake
    else
        precmd_functions+=( __putz_osc7_cwd __putz_handshake )
    fi
fi
