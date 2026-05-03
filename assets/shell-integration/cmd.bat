@echo off
:: Putz shell integration for cmd.exe
:: This script is invoked via HKCU\Software\Microsoft\Command Processor\AutoRun
:: Emits OSC 7 (CWD reporting) and OSC 133 handshake in the prompt.
:: Note: cmd.exe has no prompt-hook concept; the integration is encoded
:: in the prompt string itself via ANSI escape sequences.
prompt $E]7;file://%COMPUTERNAME%$P$E\$E]133;P;putz=1$E\$P$G
