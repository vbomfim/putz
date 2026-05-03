# Putz shell integration for bash
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Compatible with bash 3.2+ (macOS default) and bash 5+.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

__putz_osc7_cwd() {
    printf '\e]7;file://%s%s\a' "${HOSTNAME:-localhost}" "$PWD"
}

__putz_handshake() {
    printf '\e]133;P;putz=1\a'
}

# Append to PROMPT_COMMAND without clobbering existing hooks.
# Guard against double-sourcing by checking for our function.
if [[ "$(type -t __putz_osc7_cwd)" != "function" ]] 2>/dev/null; then
    PROMPT_COMMAND="__putz_osc7_cwd; __putz_handshake${PROMPT_COMMAND:+; $PROMPT_COMMAND}"
fi
