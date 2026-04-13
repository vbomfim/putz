//! Telnet protocol negotiation — IAC command parsing and response generation.
//!
//! Implements RFC 854 Telnet option negotiation as pure functions.
//! No network I/O — operates on byte slices for testability.
//!
//! # Telnet Protocol Summary (RFC 854)
//!
//! - IAC (0xFF) introduces a command sequence
//! - Two-byte commands: IAC + command_byte
//! - Three-byte option commands: IAC + WILL/WONT/DO/DONT + option_byte
//! - Subnegotiation: IAC SB option ... IAC SE
//! - Data byte 0xFF must be escaped as 0xFF 0xFF

// ─── Telnet Protocol Constants ───────────────────────────────────────

/// Interpret As Command — starts every Telnet command sequence.
pub const IAC: u8 = 255;

/// Subnegotiation End marker.
pub const SE: u8 = 240;
/// No Operation.
#[allow(dead_code)]
pub const NOP: u8 = 241;
/// Subnegotiation Begin marker.
pub const SB: u8 = 250;
/// Sender is willing to begin performing the indicated option.
pub const WILL: u8 = 251;
/// Sender refuses to perform the indicated option.
pub const WONT: u8 = 252;
/// Sender wants the other side to perform the indicated option.
pub const DO: u8 = 253;
/// Sender wants the other side to stop performing the indicated option.
pub const DONT: u8 = 254;

// ─── Telnet Option Codes ─────────────────────────────────────────────

/// Echo option — server echoes input back to client.
pub const OPT_ECHO: u8 = 1;
/// Suppress Go Ahead — disables half-duplex mode.
pub const OPT_SGA: u8 = 3;
/// Terminal Type — negotiate the terminal type string.
pub const OPT_TTYPE: u8 = 24;
/// Negotiate About Window Size — send terminal dimensions.
pub const OPT_NAWS: u8 = 31;

/// Subnegotiation sub-command: SEND (used in TTYPE).
const TTYPE_SEND: u8 = 1;
/// Subnegotiation sub-command: IS (used in TTYPE response).
const TTYPE_IS: u8 = 0;

/// Terminal type string sent to servers.
const TERMINAL_TYPE: &[u8] = b"xterm-256color";

// ─── Parser State Machine ────────────────────────────────────────────

/// State of the IAC parser between calls.
///
/// The parser may receive partial sequences across TCP reads,
/// so state must be preserved between invocations.
#[derive(Debug, Clone, Default, PartialEq)]
pub enum ParserState {
    /// Normal data mode — bytes are passed through.
    #[default]
    Data,
    /// Received IAC — waiting for the command byte.
    Iac,
    /// Received IAC WILL/WONT/DO/DONT — waiting for the option byte.
    NegotiateOption(u8),
    /// Inside IAC SB — collecting subnegotiation bytes.
    Subnegotiation(Vec<u8>),
    /// Inside subnegotiation, received IAC — waiting for SE or escaped 0xFF.
    SubnegotiationIac(Vec<u8>),
}

/// Result of parsing a chunk of Telnet data.
///
/// Contains the clean application data (with IAC sequences removed)
/// and any response bytes that should be sent back to the server.
#[derive(Debug, Clone)]
pub struct ParseResult {
    /// Clean data bytes to display in the terminal.
    pub data: Vec<u8>,
    /// Response bytes to send back to the server (negotiation replies).
    pub responses: Vec<u8>,
}

/// Parses a chunk of bytes from a Telnet connection.
///
/// Strips IAC command sequences from the data stream and generates
/// appropriate negotiation responses. Returns clean data for terminal
/// display and response bytes to send to the server.
///
/// # Arguments
/// * `input` — Raw bytes received from the TCP stream.
/// * `state` — Mutable parser state (preserved across calls).
/// * `cols` — Current terminal width (for NAWS responses).
/// * `rows` — Current terminal height (for NAWS responses).
pub fn parse_telnet(input: &[u8], state: &mut ParserState, cols: u16, rows: u16) -> ParseResult {
    let mut data = Vec::with_capacity(input.len());
    let mut responses = Vec::new();

    for &byte in input {
        match state {
            ParserState::Data => {
                if byte == IAC {
                    *state = ParserState::Iac;
                } else {
                    data.push(byte);
                }
            }
            ParserState::Iac => {
                match byte {
                    IAC => {
                        // Escaped 0xFF — emit as literal data byte
                        data.push(IAC);
                        *state = ParserState::Data;
                    }
                    WILL | WONT | DO | DONT => {
                        *state = ParserState::NegotiateOption(byte);
                    }
                    SB => {
                        *state = ParserState::Subnegotiation(Vec::new());
                    }
                    SE => {
                        // Unexpected SE outside subnegotiation — ignore
                        *state = ParserState::Data;
                    }
                    _ => {
                        // Other IAC commands (NOP, BRK, etc.) — ignore
                        *state = ParserState::Data;
                    }
                }
            }
            ParserState::NegotiateOption(command) => {
                let cmd = *command;
                handle_option_negotiation(cmd, byte, cols, rows, &mut responses);
                *state = ParserState::Data;
            }
            ParserState::Subnegotiation(ref mut buf) => {
                if byte == IAC {
                    let taken = std::mem::take(buf);
                    *state = ParserState::SubnegotiationIac(taken);
                } else {
                    buf.push(byte);
                }
            }
            ParserState::SubnegotiationIac(ref mut buf) => {
                if byte == SE {
                    // Subnegotiation complete — process the buffer
                    handle_subnegotiation(buf, &mut responses);
                    *state = ParserState::Data;
                } else if byte == IAC {
                    // Escaped 0xFF inside subnegotiation
                    buf.push(IAC);
                    let taken = std::mem::take(buf);
                    *state = ParserState::Subnegotiation(taken);
                } else {
                    // Malformed sequence — discard and return to data mode
                    *state = ParserState::Data;
                }
            }
        }
    }

    ParseResult { data, responses }
}

/// Handles a three-byte WILL/WONT/DO/DONT option negotiation.
fn handle_option_negotiation(
    command: u8,
    option: u8,
    cols: u16,
    rows: u16,
    responses: &mut Vec<u8>,
) {
    match command {
        WILL => {
            // Server offers to do something — accept known options
            match option {
                OPT_ECHO | OPT_SGA => {
                    // Accept: server echoes / suppresses go-ahead
                    responses.extend_from_slice(&[IAC, DO, option]);
                }
                _ => {
                    // Reject unknown options
                    responses.extend_from_slice(&[IAC, DONT, option]);
                }
            }
        }
        DO => {
            // Server asks us to do something — accept known options
            match option {
                OPT_TTYPE => {
                    responses.extend_from_slice(&[IAC, WILL, OPT_TTYPE]);
                }
                OPT_NAWS => {
                    // Accept NAWS and immediately send window size
                    responses.extend_from_slice(&[IAC, WILL, OPT_NAWS]);
                    build_naws_subnegotiation(cols, rows, responses);
                }
                OPT_SGA => {
                    responses.extend_from_slice(&[IAC, WILL, OPT_SGA]);
                }
                _ => {
                    // Reject unknown options
                    responses.extend_from_slice(&[IAC, WONT, option]);
                }
            }
        }
        WONT => {
            // Server refuses — acknowledge
            responses.extend_from_slice(&[IAC, DONT, option]);
        }
        DONT => {
            // Server tells us to stop — acknowledge
            responses.extend_from_slice(&[IAC, WONT, option]);
        }
        _ => {} // unreachable in normal flow
    }
}

/// Handles a completed subnegotiation sequence.
fn handle_subnegotiation(buf: &[u8], responses: &mut Vec<u8>) {
    if buf.is_empty() {
        return;
    }

    let option = buf[0];
    let sub_data = &buf[1..];

    match option {
        OPT_TTYPE => {
            // Server requests terminal type: SB TTYPE SEND
            if sub_data.first() == Some(&TTYPE_SEND) {
                // Respond: SB TTYPE IS <terminal_type>
                responses.extend_from_slice(&[IAC, SB, OPT_TTYPE, TTYPE_IS]);
                responses.extend_from_slice(TERMINAL_TYPE);
                responses.extend_from_slice(&[IAC, SE]);
            }
        }
        _ => {
            // Unknown subnegotiation — ignore
        }
    }
}

/// Builds a NAWS (Negotiate About Window Size) subnegotiation message.
///
/// Format: IAC SB NAWS <cols_hi> <cols_lo> <rows_hi> <rows_lo> IAC SE
/// Values of 0xFF in the size bytes must be escaped as 0xFF 0xFF.
pub fn build_naws_subnegotiation(cols: u16, rows: u16, output: &mut Vec<u8>) {
    output.extend_from_slice(&[IAC, SB, OPT_NAWS]);

    // Encode cols (big-endian) with IAC escaping
    let cols_bytes = cols.to_be_bytes();
    for &b in &cols_bytes {
        output.push(b);
        if b == IAC {
            output.push(IAC); // Escape 0xFF
        }
    }

    // Encode rows (big-endian) with IAC escaping
    let rows_bytes = rows.to_be_bytes();
    for &b in &rows_bytes {
        output.push(b);
        if b == IAC {
            output.push(IAC); // Escape 0xFF
        }
    }

    output.extend_from_slice(&[IAC, SE]);
}

/// Escapes IAC bytes (0xFF) in outgoing data.
///
/// When sending user data through a Telnet connection, any 0xFF byte
/// must be doubled to 0xFF 0xFF to avoid being interpreted as IAC.
pub fn escape_iac(data: &[u8]) -> Vec<u8> {
    let mut escaped = Vec::with_capacity(data.len());
    for &byte in data {
        escaped.push(byte);
        if byte == IAC {
            escaped.push(IAC);
        }
    }
    escaped
}

#[cfg(test)]
mod tests {
    use super::*;

    // ====================================================================
    // Parser state tests
    // ====================================================================

    #[test]
    fn parser_state_default_is_data() {
        assert_eq!(ParserState::default(), ParserState::Data);
    }

    // ====================================================================
    // Plain data tests — no IAC sequences
    // ====================================================================

    #[test]
    fn parse_plain_text_passes_through() {
        let mut state = ParserState::Data;
        let result = parse_telnet(b"Hello, world!", &mut state, 80, 24);
        assert_eq!(result.data, b"Hello, world!");
        assert!(result.responses.is_empty());
        assert_eq!(state, ParserState::Data);
    }

    #[test]
    fn parse_empty_input_returns_empty() {
        let mut state = ParserState::Data;
        let result = parse_telnet(b"", &mut state, 80, 24);
        assert!(result.data.is_empty());
        assert!(result.responses.is_empty());
    }

    #[test]
    fn parse_binary_data_passes_through() {
        let mut state = ParserState::Data;
        let input = [0x00, 0x01, 0x7F, 0xFE, 0x80];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, input.to_vec());
    }

    // ====================================================================
    // IAC escape tests — 0xFF in data
    // ====================================================================

    #[test]
    fn parse_escaped_iac_in_data() {
        // IAC IAC → single 0xFF byte in output
        let mut state = ParserState::Data;
        let input = [IAC, IAC];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, vec![0xFF]);
        assert!(result.responses.is_empty());
    }

    #[test]
    fn parse_mixed_data_and_escaped_iac() {
        let mut state = ParserState::Data;
        let input = [b'A', IAC, IAC, b'B'];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, vec![b'A', 0xFF, b'B']);
    }

    // ====================================================================
    // WILL/WONT/DO/DONT negotiation tests
    // ====================================================================

    #[test]
    fn parse_will_echo_responds_do_echo() {
        let mut state = ParserState::Data;
        let input = [IAC, WILL, OPT_ECHO];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert!(result.data.is_empty());
        assert_eq!(result.responses, vec![IAC, DO, OPT_ECHO]);
    }

    #[test]
    fn parse_will_sga_responds_do_sga() {
        let mut state = ParserState::Data;
        let input = [IAC, WILL, OPT_SGA];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert!(result.data.is_empty());
        assert_eq!(result.responses, vec![IAC, DO, OPT_SGA]);
    }

    #[test]
    fn parse_will_unknown_responds_dont() {
        let mut state = ParserState::Data;
        let input = [IAC, WILL, 99]; // Unknown option
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, DONT, 99]);
    }

    #[test]
    fn parse_do_ttype_responds_will_ttype() {
        let mut state = ParserState::Data;
        let input = [IAC, DO, OPT_TTYPE];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, WILL, OPT_TTYPE]);
    }

    #[test]
    fn parse_do_naws_responds_will_naws_and_sends_size() {
        let mut state = ParserState::Data;
        let input = [IAC, DO, OPT_NAWS];
        let result = parse_telnet(&input, &mut state, 80, 24);

        // Should contain: WILL NAWS + NAWS subnegotiation
        assert!(result.responses.starts_with(&[IAC, WILL, OPT_NAWS]));
        // Followed by: IAC SB NAWS <cols_hi> <cols_lo> <rows_hi> <rows_lo> IAC SE
        assert!(result.responses[3..].starts_with(&[IAC, SB, OPT_NAWS]));
        // 80 = 0x0050, 24 = 0x0018
        assert_eq!(result.responses[6], 0x00); // cols hi
        assert_eq!(result.responses[7], 0x50); // cols lo (80)
        assert_eq!(result.responses[8], 0x00); // rows hi
        assert_eq!(result.responses[9], 0x18); // rows lo (24)
        assert!(result.responses.ends_with(&[IAC, SE]));
    }

    #[test]
    fn parse_do_sga_responds_will_sga() {
        let mut state = ParserState::Data;
        let input = [IAC, DO, OPT_SGA];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, WILL, OPT_SGA]);
    }

    #[test]
    fn parse_do_unknown_responds_wont() {
        let mut state = ParserState::Data;
        let input = [IAC, DO, 99];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, WONT, 99]);
    }

    #[test]
    fn parse_wont_responds_dont() {
        let mut state = ParserState::Data;
        let input = [IAC, WONT, OPT_ECHO];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, DONT, OPT_ECHO]);
    }

    #[test]
    fn parse_dont_responds_wont() {
        let mut state = ParserState::Data;
        let input = [IAC, DONT, OPT_SGA];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.responses, vec![IAC, WONT, OPT_SGA]);
    }

    // ====================================================================
    // Subnegotiation tests — TTYPE
    // ====================================================================

    #[test]
    fn parse_ttype_send_responds_with_terminal_type() {
        let mut state = ParserState::Data;
        // Server sends: IAC SB TTYPE SEND IAC SE
        let input = [IAC, SB, OPT_TTYPE, TTYPE_SEND, IAC, SE];
        let result = parse_telnet(&input, &mut state, 80, 24);

        // Response: IAC SB TTYPE IS xterm-256color IAC SE
        let mut expected = vec![IAC, SB, OPT_TTYPE, TTYPE_IS];
        expected.extend_from_slice(b"xterm-256color");
        expected.extend_from_slice(&[IAC, SE]);

        assert_eq!(result.responses, expected);
        assert!(result.data.is_empty());
    }

    #[test]
    fn parse_unknown_subnegotiation_ignored() {
        let mut state = ParserState::Data;
        // Unknown option 99 subnegotiation
        let input = [IAC, SB, 99, 0x01, 0x02, IAC, SE];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert!(result.responses.is_empty());
        assert!(result.data.is_empty());
    }

    #[test]
    fn parse_empty_subnegotiation_ignored() {
        let mut state = ParserState::Data;
        let input = [IAC, SB, IAC, SE];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert!(result.responses.is_empty());
    }

    // ====================================================================
    // NAWS subnegotiation builder tests
    // ====================================================================

    #[test]
    fn build_naws_standard_size() {
        let mut output = Vec::new();
        build_naws_subnegotiation(80, 24, &mut output);
        assert_eq!(
            output,
            vec![
                IAC, SB, OPT_NAWS, 0x00, 0x50, // 80
                0x00, 0x18, // 24
                IAC, SE
            ]
        );
    }

    #[test]
    fn build_naws_large_size() {
        let mut output = Vec::new();
        build_naws_subnegotiation(200, 50, &mut output);
        assert_eq!(
            output,
            vec![
                IAC, SB, OPT_NAWS, 0x00, 0xC8, // 200
                0x00, 0x32, // 50
                IAC, SE
            ]
        );
    }

    #[test]
    fn build_naws_escapes_iac_in_size() {
        // If a size byte happens to be 0xFF (255), it must be escaped
        let mut output = Vec::new();
        build_naws_subnegotiation(255, 24, &mut output);
        // 255 = 0x00FF → lo byte is 0xFF → must be escaped
        assert_eq!(
            output,
            vec![
                IAC, SB, OPT_NAWS, 0x00, IAC, IAC, // 0x00FF with escape
                0x00, 0x18, // 24
                IAC, SE
            ]
        );
    }

    #[test]
    fn build_naws_zero_size() {
        let mut output = Vec::new();
        build_naws_subnegotiation(0, 0, &mut output);
        assert_eq!(
            output,
            vec![
                IAC, SB, OPT_NAWS, 0x00, 0x00, // 0
                0x00, 0x00, // 0
                IAC, SE
            ]
        );
    }

    // ====================================================================
    // IAC escape function tests
    // ====================================================================

    #[test]
    fn escape_iac_no_special_bytes() {
        let data = b"Hello, world!";
        assert_eq!(escape_iac(data), data.to_vec());
    }

    #[test]
    fn escape_iac_escapes_0xff() {
        let data = [0x41, 0xFF, 0x42];
        assert_eq!(escape_iac(&data), vec![0x41, 0xFF, 0xFF, 0x42]);
    }

    #[test]
    fn escape_iac_escapes_multiple_0xff() {
        let data = [0xFF, 0xFF];
        assert_eq!(escape_iac(&data), vec![0xFF, 0xFF, 0xFF, 0xFF]);
    }

    #[test]
    fn escape_iac_empty_input() {
        assert_eq!(escape_iac(b""), Vec::<u8>::new());
    }

    // ====================================================================
    // Partial sequence / cross-buffer tests
    // ====================================================================

    #[test]
    fn parse_partial_iac_at_end_of_buffer() {
        let mut state = ParserState::Data;
        // First buffer ends with IAC (incomplete sequence)
        let result1 = parse_telnet(&[b'A', IAC], &mut state, 80, 24);
        assert_eq!(result1.data, vec![b'A']);
        assert_eq!(state, ParserState::Iac);

        // Second buffer completes the sequence
        let result2 = parse_telnet(&[WILL, OPT_ECHO], &mut state, 80, 24);
        assert!(result2.data.is_empty());
        assert_eq!(result2.responses, vec![IAC, DO, OPT_ECHO]);
        assert_eq!(state, ParserState::Data);
    }

    #[test]
    fn parse_partial_negotiate_at_end_of_buffer() {
        let mut state = ParserState::Data;
        // First buffer: IAC DO
        let result1 = parse_telnet(&[IAC, DO], &mut state, 80, 24);
        assert!(result1.data.is_empty());
        assert!(result1.responses.is_empty());
        assert!(matches!(state, ParserState::NegotiateOption(DO)));

        // Second buffer: option byte
        let result2 = parse_telnet(&[OPT_TTYPE], &mut state, 80, 24);
        assert_eq!(result2.responses, vec![IAC, WILL, OPT_TTYPE]);
    }

    #[test]
    fn parse_partial_subnegotiation_across_buffers() {
        let mut state = ParserState::Data;
        // First buffer: start of subneg
        let result1 = parse_telnet(&[IAC, SB, OPT_TTYPE, TTYPE_SEND], &mut state, 80, 24);
        assert!(result1.data.is_empty());
        assert!(result1.responses.is_empty());
        assert!(matches!(state, ParserState::Subnegotiation(_)));

        // Second buffer: IAC SE to end subneg
        let result2 = parse_telnet(&[IAC, SE], &mut state, 80, 24);
        assert!(!result2.responses.is_empty()); // Should have TTYPE IS response
    }

    // ====================================================================
    // Mixed data + negotiation tests
    // ====================================================================

    #[test]
    fn parse_data_interleaved_with_negotiation() {
        let mut state = ParserState::Data;
        let input = [
            b'H', b'i', // Data
            IAC, WILL, OPT_ECHO, // Negotiation
            b'!',     // More data
        ];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, b"Hi!");
        assert_eq!(result.responses, vec![IAC, DO, OPT_ECHO]);
    }

    #[test]
    fn parse_multiple_negotiations_in_sequence() {
        let mut state = ParserState::Data;
        let input = [IAC, WILL, OPT_ECHO, IAC, WILL, OPT_SGA, IAC, DO, OPT_NAWS];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert!(result.data.is_empty());
        // Should have responses for all three
        assert!(result.responses.len() > 9); // At least 3 + 3 + 3+NAWS
    }

    #[test]
    fn parse_typical_server_greeting() {
        // Simulate a typical Telnet server initial negotiation burst
        let mut state = ParserState::Data;
        let input = [
            IAC, DO, OPT_TTYPE, // Server: DO TTYPE
            IAC, WILL, OPT_ECHO, // Server: WILL ECHO
            IAC, WILL, OPT_SGA, // Server: WILL SGA
            IAC, DO, OPT_NAWS, // Server: DO NAWS
        ];
        let result = parse_telnet(&input, &mut state, 120, 40);

        // Verify all negotiations were responded to
        assert!(result.data.is_empty());
        // WILL TTYPE + DO ECHO + DO SGA + WILL NAWS + NAWS subnego
        assert!(result.responses.len() > 12);

        // Verify NAWS contains correct dimensions
        // Find NAWS subneg in responses
        let naws_start = result
            .responses
            .windows(3)
            .position(|w| w == [IAC, SB, OPT_NAWS])
            .expect("NAWS subneg not found");
        // 120 = 0x0078, 40 = 0x0028
        assert_eq!(result.responses[naws_start + 3], 0x00);
        assert_eq!(result.responses[naws_start + 4], 0x78); // 120
        assert_eq!(result.responses[naws_start + 5], 0x00);
        assert_eq!(result.responses[naws_start + 6], 0x28); // 40
    }

    // ====================================================================
    // Edge case: IAC inside subnegotiation (escaped 0xFF)
    // ====================================================================

    #[test]
    fn parse_escaped_iac_inside_subnegotiation() {
        let mut state = ParserState::Data;
        // Subneg with escaped 0xFF inside: IAC SB 99 <FF FF> IAC SE
        let input = [IAC, SB, 99, IAC, IAC, IAC, SE];
        let result = parse_telnet(&input, &mut state, 80, 24);
        // Option 99 is unknown, so no response, but parsing should succeed
        assert!(result.responses.is_empty());
        assert_eq!(state, ParserState::Data);
    }

    // ====================================================================
    // Unexpected SE outside subnegotiation
    // ====================================================================

    #[test]
    fn parse_unexpected_se_returns_to_data() {
        let mut state = ParserState::Data;
        let input = [IAC, SE, b'A'];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, vec![b'A']);
        assert_eq!(state, ParserState::Data);
    }

    // ====================================================================
    // NOP command test
    // ====================================================================

    #[test]
    fn parse_nop_ignored() {
        let mut state = ParserState::Data;
        let input = [b'A', IAC, NOP, b'B'];
        let result = parse_telnet(&input, &mut state, 80, 24);
        assert_eq!(result.data, vec![b'A', b'B']);
        assert!(result.responses.is_empty());
    }
}
