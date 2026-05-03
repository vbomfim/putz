# Putz shell integration for fish
# Emits OSC 7 (CWD reporting) and OSC 133 handshake on every prompt.
# Do NOT add OSC 133 ;A/B/C/D markers here — that is S4 scope.

function __putz_osc7_cwd --on-event fish_prompt
    printf '\e]7;file://%s%s\a' (hostname) $PWD
end

function __putz_handshake --on-event fish_prompt
    printf '\e]133;P;putz=1\a'
end
