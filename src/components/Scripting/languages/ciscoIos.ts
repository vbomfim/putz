/**
 * Cisco IOS language definition for Monaco Editor.
 *
 * Provides syntax highlighting via Monarch tokenizer for:
 * - IOS / IOS-XE / NX-OS configuration commands
 * - Interface names (GigabitEthernet, Loopback, Vlan, etc.)
 * - IP addresses, subnet masks, wildcard masks
 * - ACL entries, route-maps, prefix-lists
 * - Comments (! and #)
 * - Strings and descriptions
 *
 * @module ciscoIos
 */
import type * as monaco from "monaco-editor";

export const CISCO_IOS_LANGUAGE_ID = "cisco-ios";

export const ciscoIosLanguageConfig: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "!",
  },
  brackets: [],
  autoClosingPairs: [{ open: '"', close: '"' }],
  surroundingPairs: [{ open: '"', close: '"' }],
};

/**
 * Monarch tokenizer for Cisco IOS configuration syntax.
 *
 * Token groups:
 * - keyword.command: top-level config commands
 * - keyword.subcommand: interface/routing subcommands
 * - keyword.action: permit, deny, allow, block
 * - type.interface: interface type names
 * - number.ip: IP addresses and masks
 * - number: plain numbers (VLAN IDs, AS numbers, etc.)
 * - comment: ! and # comment lines
 * - string: quoted strings
 * - keyword.negation: "no" prefix (config removal)
 * - keyword.section: section-starting commands
 */
export const ciscoIosTokensProvider: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: true,

  // Top-level IOS commands
  commands: [
    "hostname",
    "enable",
    "service",
    "no",
    "logging",
    "banner",
    "line",
    "aaa",
    "username",
    "crypto",
    "ntp",
    "snmp-server",
    "spanning-tree",
    "vtp",
    "errdisable",
    "boot",
    "clock",
    "archive",
    "alias",
    "privilege",
    "parser",
    "default",
    "do",
    "exit",
    "end",
    "write",
    "copy",
    "show",
    "debug",
    "undebug",
    "clear",
    "reload",
    "ping",
    "traceroute",
    "telnet",
    "ssh",
    "terminal",
  ],

  // Section-starting commands (create indented blocks)
  sectionCommands: [
    "interface",
    "router",
    "ip",
    "ipv6",
    "access-list",
    "ip access-list",
    "route-map",
    "prefix-list",
    "class-map",
    "policy-map",
    "vlan",
    "vrf",
    "key",
    "crypto",
    "monitor",
    "flow",
    "track",
    "event",
    "redundancy",
    "standby",
    "zone",
    "zone-pair",
    "object-group",
    "object",
    "control-plane",
    "management-plane",
  ],

  // Routing protocols and features
  routingKeywords: [
    "network",
    "neighbor",
    "redistribute",
    "area",
    "summary-address",
    "default-information",
    "distance",
    "maximum-paths",
    "passive-interface",
    "address-family",
    "remote-as",
    "update-source",
    "route-reflector-client",
    "next-hop-self",
    "soft-reconfiguration",
    "prefix-list",
    "route-map",
    "distribute-list",
    "weight",
    "local-preference",
    "med",
    "community",
    "metric",
    "metric-type",
    "tag",
    "timers",
    "auto-cost",
    "reference-bandwidth",
    "router-id",
    "log-adjacency-changes",
    "bgp",
    "ospf",
    "eigrp",
    "rip",
    "isis",
  ],

  // Interface subcommands
  interfaceKeywords: [
    "description",
    "ip address",
    "ipv6 address",
    "shutdown",
    "no shutdown",
    "switchport",
    "speed",
    "duplex",
    "encapsulation",
    "bandwidth",
    "delay",
    "mtu",
    "keepalive",
    "load-interval",
    "channel-group",
    "channel-protocol",
    "storm-control",
    "port-security",
    "spanning-tree",
    "bpduguard",
    "bpdufilter",
    "cdp",
    "lldp",
    "mdix",
    "service-policy",
    "rate-limit",
    "standby",
    "vrrp",
    "glbp",
    "hsrp",
    "ip helper-address",
    "ip dhcp",
    "ip ospf",
    "ip eigrp",
    "ip rip",
    "ip nat",
    "ip access-group",
    "ip flow",
    "ip route-cache",
    "negotiation",
    "media-type",
    "carrier-delay",
  ],

  // Action keywords (ACLs, route-maps)
  actionKeywords: [
    "permit",
    "deny",
    "remark",
    "match",
    "set",
    "continue",
    "log",
    "log-input",
    "established",
    "eq",
    "neq",
    "gt",
    "lt",
    "range",
    "any",
    "host",
  ],

  // Interface type names
  interfaceTypes: [
    "GigabitEthernet",
    "FastEthernet",
    "Ethernet",
    "TenGigabitEthernet",
    "TwentyFiveGigE",
    "FortyGigabitEthernet",
    "HundredGigE",
    "Serial",
    "Tunnel",
    "Loopback",
    "Vlan",
    "BDI",
    "Port-channel",
    "Management",
    "mgmt",
    "Null",
    "Dialer",
    "Virtual-Template",
    "GigE",
    "Gi",
    "Fa",
    "Te",
    "Se",
    "Lo",
    "Tu",
    "Po",
    "Vl",
    "Eth",
    "eth",
  ],

  // Protocol keywords
  protocols: [
    "tcp",
    "udp",
    "icmp",
    "ip",
    "ipv6",
    "gre",
    "esp",
    "ahp",
    "eigrp",
    "ospf",
    "pim",
    "igmp",
    "object-group",
  ],

  // Common port names
  portNames: [
    "www",
    "https",
    "ssh",
    "telnet",
    "ftp",
    "ftp-data",
    "tftp",
    "snmp",
    "snmptrap",
    "syslog",
    "ntp",
    "domain",
    "bootps",
    "bootpc",
    "dhcp",
    "bgp",
    "ldp",
    "pop3",
    "smtp",
    "imap",
    "tacacs",
    "radius",
  ],

  tokenizer: {
    root: [
      // Comments (! at start of line)
      [/^[!#].*$/, "comment"],
      [/^\s*!.*$/, "comment"],

      // IP addresses (before general numbers)
      [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}(\/\d{1,2})?\b/, "number.ip"],

      // Interface references with slot/port (e.g., GigabitEthernet0/0/1)
      [
        /\b(GigabitEthernet|FastEthernet|TenGigabitEthernet|TwentyFiveGigE|FortyGigabitEthernet|HundredGigE|Serial|Tunnel|Loopback|Vlan|BDI|Port-channel|Management|Dialer|Virtual-Template|GigE|Gi|Fa|Te|Se|Lo|Tu|Po|Vl|Eth|eth)\s*\d[\d/.:]*\b/i,
        "type.interface",
      ],

      // "no" prefix (negation)
      [/\bno\b/, "keyword.negation"],

      // Quoted strings
      [/"/, "string", "@string"],

      // Section commands (highlight differently)
      [
        /\b(interface|router|ip access-list|access-list|route-map|prefix-list|class-map|policy-map|vlan|vrf|key chain|crypto|line|control-plane)\b/i,
        "keyword.section",
      ],

      // Routing keywords
      [
        /\b(network|neighbor|redistribute|area|summary-address|default-information|distance|maximum-paths|passive-interface|address-family|remote-as|update-source|route-reflector-client|next-hop-self|soft-reconfiguration|distribute-list|weight|local-preference|med|community|metric|metric-type|tag|timers|auto-cost|reference-bandwidth|router-id|log-adjacency-changes)\b/i,
        "keyword.routing",
      ],

      // Action keywords (permit/deny etc.)
      [
        /\b(permit|deny|remark|match|set|continue|log|log-input|established|eq|neq|gt|lt|range|any|host)\b/i,
        "keyword.action",
      ],

      // Interface subcommands
      [
        /\b(description|switchport|speed|duplex|encapsulation|bandwidth|delay|mtu|keepalive|load-interval|channel-group|channel-protocol|storm-control|port-security|bpduguard|bpdufilter|cdp|lldp|mdix|service-policy|rate-limit|standby|vrrp|glbp|hsrp|negotiation|media-type|carrier-delay|shutdown)\b/i,
        "keyword.subcommand",
      ],

      // Top-level commands
      [
        /\b(hostname|enable|service|logging|banner|aaa|username|crypto|ntp|snmp-server|spanning-tree|vtp|errdisable|boot|clock|archive|alias|privilege|parser|default|do|exit|end|write|copy|show|debug|undebug|clear|reload|ping|traceroute|telnet|ssh|terminal|ip|ipv6)\b/i,
        "keyword.command",
      ],

      // Protocol keywords
      [
        /\b(tcp|udp|icmp|gre|esp|ahp|eigrp|ospf|pim|igmp|bgp|rip|isis)\b/i,
        "keyword.protocol",
      ],

      // Port names
      [
        /\b(www|https|ssh|telnet|ftp|ftp-data|tftp|snmp|snmptrap|syslog|ntp|domain|bootps|bootpc|dhcp|bgp|ldp|pop3|smtp|imap|tacacs|radius)\b/i,
        "keyword.port",
      ],

      // Numbers (VLAN IDs, AS numbers, etc.)
      [/\b\d+\b/, "number"],

      // Identifiers
      [/[a-zA-Z][\w-]*/, "identifier"],

      // Whitespace
      [/\s+/, "white"],
    ],

    string: [
      [/[^"]+/, "string"],
      [/"/, "string", "@pop"],
    ],
  },
};

/**
 * Register the Cisco IOS language with Monaco.
 * Call this once during Monaco initialization.
 */
export function registerCiscoIosLanguage(monacoInstance: typeof monaco): void {
  // Register language ID
  monacoInstance.languages.register({
    id: CISCO_IOS_LANGUAGE_ID,
    extensions: [".ios", ".cfg", ".conf"],
    aliases: ["Cisco IOS", "IOS", "cisco"],
  });

  // Set language configuration
  monacoInstance.languages.setLanguageConfiguration(
    CISCO_IOS_LANGUAGE_ID,
    ciscoIosLanguageConfig,
  );

  // Set tokenizer
  monacoInstance.languages.setMonarchTokensProvider(
    CISCO_IOS_LANGUAGE_ID,
    ciscoIosTokensProvider,
  );
}
