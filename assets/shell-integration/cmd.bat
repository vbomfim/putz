@echo off
:: Putz shell integration for cmd.exe
:: This script is invoked via HKCU\Software\Microsoft\Command Processor\AutoRun
:: Emits OSC 7 (CWD reporting) and OSC 133 handshake in the prompt.
:: Note: cmd.exe has no prompt-hook concept; the integration is encoded
:: in the prompt string itself via ANSI escape sequences.
:: Limitation: $P is emitted raw — cmd.exe has no built-in percent-encoding
:: mechanism, so paths with spaces or special characters produce non-standard
:: file:// URIs. This is acceptable for the cmd.exe tier.
if defined __PUTZ_INTEGRATION_LOADED goto :eof
set __PUTZ_INTEGRATION_LOADED=1
:: Capture user's existing prompt (default if unset is "$P$G")
if not defined PROMPT set "PROMPT=$P$G"
set "PROMPT=$E]7;file://%COMPUTERNAME%$P$E\$E]133;P;putz=1$E\%PROMPT%"
