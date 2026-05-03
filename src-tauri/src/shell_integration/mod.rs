/// Shell integration module — detects installed shells and manages
/// installation/uninstallation of shell-integration snippets.
///
/// # Components
/// - `detector`: Finds installed tier-1 shells and their dotfile paths
/// - `installer`: Reads/writes marker-delimited blocks in dotfiles
/// - `cmd_autorun`: Windows cmd.exe AutoRun registry management
pub mod cmd_autorun;
pub mod detector;
pub mod installer;
