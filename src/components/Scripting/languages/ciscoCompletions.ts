/**
 * Cisco IOS completion provider for Monaco Editor.
 *
 * Provides context-aware autocompletion for:
 * - Top-level config commands
 * - Interface configuration subcommands
 * - Routing protocol configuration
 * - ACL entries
 * - Common config snippets
 *
 * @module ciscoCompletions
 */
import type * as monaco from "monaco-editor";
import { CISCO_IOS_LANGUAGE_ID } from "./ciscoIos";

interface CiscoCompletion {
  label: string;
  detail: string;
  insertText: string;
  kind: "keyword" | "snippet" | "value";
}

// ── Top-level commands ────────────────────────────────────────────
const topLevelCommands: CiscoCompletion[] = [
  { label: "interface", detail: "Configure an interface", insertText: "interface ${1:GigabitEthernet0/0}\n ${2:description ${3:Link}}\n ${4:ip address ${5:10.0.0.1} ${6:255.255.255.0}}\n no shutdown\n!", kind: "snippet" },
  { label: "router ospf", detail: "Configure OSPF routing", insertText: "router ospf ${1:1}\n router-id ${2:1.1.1.1}\n network ${3:10.0.0.0} ${4:0.0.0.255} area ${5:0}\n!", kind: "snippet" },
  { label: "router bgp", detail: "Configure BGP routing", insertText: "router bgp ${1:65000}\n bgp router-id ${2:1.1.1.1}\n neighbor ${3:10.0.0.2} remote-as ${4:65001}\n address-family ipv4 unicast\n  network ${5:10.0.0.0} mask ${6:255.255.255.0}\n  neighbor ${3} activate\n exit-address-family\n!", kind: "snippet" },
  { label: "router eigrp", detail: "Configure EIGRP routing", insertText: "router eigrp ${1:100}\n network ${2:10.0.0.0} ${3:0.0.0.255}\n no auto-summary\n!", kind: "snippet" },
  { label: "ip access-list extended", detail: "Create named extended ACL", insertText: "ip access-list extended ${1:ACL_NAME}\n permit ${2:ip} ${3:any} ${4:any}\n deny ip any any log\n!", kind: "snippet" },
  { label: "ip access-list standard", detail: "Create named standard ACL", insertText: "ip access-list standard ${1:ACL_NAME}\n permit ${2:10.0.0.0} ${3:0.0.0.255}\n deny any log\n!", kind: "snippet" },
  { label: "access-list", detail: "Create numbered ACL", insertText: "access-list ${1:100} ${2|permit,deny|} ${3:ip} ${4:any} ${5:any}", kind: "snippet" },
  { label: "route-map", detail: "Create a route-map", insertText: "route-map ${1:ROUTE_MAP_NAME} ${2|permit,deny|} ${3:10}\n match ${4:ip address prefix-list ${5:PREFIX_LIST}}\n set ${6:local-preference ${7:200}}\n!", kind: "snippet" },
  { label: "ip prefix-list", detail: "Create a prefix-list", insertText: "ip prefix-list ${1:PREFIX_NAME} seq ${2:10} ${3|permit,deny|} ${4:10.0.0.0/8}${5: ge ${6:16} le ${7:24}}", kind: "snippet" },
  { label: "hostname", detail: "Set device hostname", insertText: "hostname ${1:Router}", kind: "keyword" },
  { label: "enable secret", detail: "Set enable password", insertText: "enable secret ${1:password}", kind: "keyword" },
  { label: "ip route", detail: "Static route", insertText: "ip route ${1:0.0.0.0} ${2:0.0.0.0} ${3:10.0.0.1}", kind: "snippet" },
  { label: "ip domain-name", detail: "Set domain name", insertText: "ip domain-name ${1:example.com}", kind: "keyword" },
  { label: "ip name-server", detail: "Set DNS server", insertText: "ip name-server ${1:8.8.8.8}", kind: "keyword" },
  { label: "ntp server", detail: "Configure NTP server", insertText: "ntp server ${1:10.0.0.1}", kind: "keyword" },
  { label: "logging", detail: "Configure logging", insertText: "logging ${1:host} ${2:10.0.0.1}", kind: "keyword" },
  { label: "snmp-server community", detail: "SNMP community string", insertText: "snmp-server community ${1:public} ${2|RO,RW|}", kind: "snippet" },
  { label: "banner motd", detail: "Message of the day banner", insertText: "banner motd ^\n${1:Authorized access only}\n^", kind: "snippet" },
  { label: "username", detail: "Create local user", insertText: "username ${1:admin} privilege ${2:15} secret ${3:password}", kind: "snippet" },
  { label: "line console 0", detail: "Configure console line", insertText: "line console 0\n logging synchronous\n exec-timeout ${1:30} 0\n!", kind: "snippet" },
  { label: "line vty 0 15", detail: "Configure VTY lines", insertText: "line vty 0 15\n transport input ssh\n login local\n exec-timeout ${1:15} 0\n!", kind: "snippet" },
  { label: "crypto key generate rsa", detail: "Generate RSA keys for SSH", insertText: "crypto key generate rsa modulus ${1:2048}", kind: "keyword" },
  { label: "ip ssh version 2", detail: "Enable SSH version 2", insertText: "ip ssh version 2", kind: "keyword" },
  { label: "service password-encryption", detail: "Encrypt passwords", insertText: "service password-encryption", kind: "keyword" },
  { label: "vlan", detail: "Create VLAN", insertText: "vlan ${1:10}\n name ${2:DATA}\n!", kind: "snippet" },
  { label: "spanning-tree mode", detail: "Set STP mode", insertText: "spanning-tree mode ${1|rapid-pvst,mst,pvst|}", kind: "snippet" },
  { label: "vtp mode", detail: "Set VTP mode", insertText: "vtp mode ${1|transparent,server,client,off|}", kind: "snippet" },
  { label: "class-map", detail: "Create class-map for QoS", insertText: "class-map match-any ${1:CLASS_NAME}\n match ${2:dscp ${3:ef}}\n!", kind: "snippet" },
  { label: "policy-map", detail: "Create policy-map for QoS", insertText: "policy-map ${1:POLICY_NAME}\n class ${2:CLASS_NAME}\n  ${3:bandwidth ${4:1000}}\n!", kind: "snippet" },
  { label: "aaa new-model", detail: "Enable AAA", insertText: "aaa new-model", kind: "keyword" },
  { label: "ip dhcp pool", detail: "Create DHCP pool", insertText: "ip dhcp pool ${1:POOL_NAME}\n network ${2:10.0.0.0} ${3:255.255.255.0}\n default-router ${4:10.0.0.1}\n dns-server ${5:8.8.8.8}\n!", kind: "snippet" },
  { label: "ip nat inside source", detail: "NAT inside source", insertText: "ip nat inside source ${1|list,static|} ${2:1} ${3:interface ${4:GigabitEthernet0/0} overload}", kind: "snippet" },
  { label: "ip sla", detail: "IP SLA monitor", insertText: "ip sla ${1:1}\n icmp-echo ${2:10.0.0.1}\n frequency ${3:30}\nip sla schedule ${1} start-time now life forever\n!", kind: "snippet" },
  { label: "track", detail: "Object tracking", insertText: "track ${1:1} ip sla ${2:1} reachability", kind: "snippet" },
];

// ── Interface subcommands ─────────────────────────────────────────
const interfaceSubcommands: CiscoCompletion[] = [
  { label: "ip address", detail: "Set IP address", insertText: "ip address ${1:10.0.0.1} ${2:255.255.255.0}", kind: "keyword" },
  { label: "ip address dhcp", detail: "Get IP from DHCP", insertText: "ip address dhcp", kind: "keyword" },
  { label: "description", detail: "Interface description", insertText: "description ${1:Link to}", kind: "keyword" },
  { label: "no shutdown", detail: "Enable interface", insertText: "no shutdown", kind: "keyword" },
  { label: "shutdown", detail: "Disable interface", insertText: "shutdown", kind: "keyword" },
  { label: "switchport mode access", detail: "Set as access port", insertText: "switchport mode access\n switchport access vlan ${1:10}", kind: "snippet" },
  { label: "switchport mode trunk", detail: "Set as trunk port", insertText: "switchport mode trunk\n switchport trunk allowed vlan ${1:10,20,30}", kind: "snippet" },
  { label: "switchport access vlan", detail: "Assign access VLAN", insertText: "switchport access vlan ${1:10}", kind: "keyword" },
  { label: "switchport trunk allowed vlan", detail: "Trunk allowed VLANs", insertText: "switchport trunk allowed vlan ${1:10,20,30}", kind: "keyword" },
  { label: "switchport trunk native vlan", detail: "Set native VLAN", insertText: "switchport trunk native vlan ${1:999}", kind: "keyword" },
  { label: "ip access-group", detail: "Apply ACL to interface", insertText: "ip access-group ${1:ACL_NAME} ${2|in,out|}", kind: "snippet" },
  { label: "ip ospf", detail: "OSPF interface config", insertText: "ip ospf ${1:cost ${2:10}}", kind: "keyword" },
  { label: "ip helper-address", detail: "DHCP relay", insertText: "ip helper-address ${1:10.0.0.1}", kind: "keyword" },
  { label: "ip nat inside", detail: "Mark NAT inside", insertText: "ip nat inside", kind: "keyword" },
  { label: "ip nat outside", detail: "Mark NAT outside", insertText: "ip nat outside", kind: "keyword" },
  { label: "standby", detail: "HSRP configuration", insertText: "standby ${1:1} ip ${2:10.0.0.1}\n standby ${1} priority ${3:110}\n standby ${1} preempt", kind: "snippet" },
  { label: "channel-group", detail: "EtherChannel config", insertText: "channel-group ${1:1} mode ${2|active,passive,on|}", kind: "snippet" },
  { label: "speed", detail: "Set interface speed", insertText: "speed ${1|auto,10,100,1000|}", kind: "snippet" },
  { label: "duplex", detail: "Set interface duplex", insertText: "duplex ${1|auto,full,half|}", kind: "snippet" },
  { label: "bandwidth", detail: "Set bandwidth (kbps)", insertText: "bandwidth ${1:1000000}", kind: "keyword" },
  { label: "encapsulation dot1q", detail: "802.1Q encapsulation", insertText: "encapsulation dot1q ${1:10}", kind: "keyword" },
  { label: "service-policy", detail: "Apply QoS policy", insertText: "service-policy ${1|input,output|} ${2:POLICY_NAME}", kind: "snippet" },
  { label: "storm-control", detail: "Storm control", insertText: "storm-control ${1|broadcast,multicast,unicast|} level ${2:10}", kind: "snippet" },
  { label: "spanning-tree portfast", detail: "Enable PortFast", insertText: "spanning-tree portfast", kind: "keyword" },
  { label: "spanning-tree bpduguard enable", detail: "Enable BPDU guard", insertText: "spanning-tree bpduguard enable", kind: "keyword" },
  { label: "mtu", detail: "Set MTU size", insertText: "mtu ${1:1500}", kind: "keyword" },
  { label: "load-interval", detail: "Stats interval", insertText: "load-interval ${1:30}", kind: "keyword" },
];

// ── Show commands ────────────────────────────────────────────────
const showCommands: CiscoCompletion[] = [
  { label: "show running-config", detail: "Display running config", insertText: "show running-config", kind: "keyword" },
  { label: "show startup-config", detail: "Display startup config", insertText: "show startup-config", kind: "keyword" },
  { label: "show ip interface brief", detail: "Interface summary", insertText: "show ip interface brief", kind: "keyword" },
  { label: "show interfaces", detail: "Detailed interface info", insertText: "show interfaces ${1}", kind: "keyword" },
  { label: "show ip route", detail: "Routing table", insertText: "show ip route${1}", kind: "keyword" },
  { label: "show ip bgp summary", detail: "BGP neighbor summary", insertText: "show ip bgp summary", kind: "keyword" },
  { label: "show ip bgp", detail: "BGP table", insertText: "show ip bgp${1}", kind: "keyword" },
  { label: "show ip ospf neighbor", detail: "OSPF neighbors", insertText: "show ip ospf neighbor", kind: "keyword" },
  { label: "show ip ospf interface", detail: "OSPF interface details", insertText: "show ip ospf interface${1}", kind: "keyword" },
  { label: "show ip eigrp neighbors", detail: "EIGRP neighbors", insertText: "show ip eigrp neighbors", kind: "keyword" },
  { label: "show vlan brief", detail: "VLAN summary", insertText: "show vlan brief", kind: "keyword" },
  { label: "show spanning-tree", detail: "STP status", insertText: "show spanning-tree${1}", kind: "keyword" },
  { label: "show cdp neighbors", detail: "CDP neighbor table", insertText: "show cdp neighbors detail", kind: "keyword" },
  { label: "show lldp neighbors", detail: "LLDP neighbor table", insertText: "show lldp neighbors detail", kind: "keyword" },
  { label: "show logging", detail: "Display log buffer", insertText: "show logging", kind: "keyword" },
  { label: "show version", detail: "Device version info", insertText: "show version", kind: "keyword" },
  { label: "show inventory", detail: "Hardware inventory", insertText: "show inventory", kind: "keyword" },
  { label: "show processes cpu", detail: "CPU utilization", insertText: "show processes cpu", kind: "keyword" },
  { label: "show memory", detail: "Memory utilization", insertText: "show memory", kind: "keyword" },
  { label: "show ip access-lists", detail: "Display ACLs", insertText: "show ip access-lists${1}", kind: "keyword" },
  { label: "show ip nat translations", detail: "NAT translations", insertText: "show ip nat translations", kind: "keyword" },
  { label: "show etherchannel summary", detail: "EtherChannel status", insertText: "show etherchannel summary", kind: "keyword" },
  { label: "show standby brief", detail: "HSRP summary", insertText: "show standby brief", kind: "keyword" },
  { label: "show mac address-table", detail: "MAC address table", insertText: "show mac address-table${1}", kind: "keyword" },
  { label: "show arp", detail: "ARP table", insertText: "show arp", kind: "keyword" },
  { label: "show ip dhcp binding", detail: "DHCP bindings", insertText: "show ip dhcp binding", kind: "keyword" },
  { label: "show crypto isakmp sa", detail: "IKE SAs", insertText: "show crypto isakmp sa", kind: "keyword" },
  { label: "show crypto ipsec sa", detail: "IPSec SAs", insertText: "show crypto ipsec sa", kind: "keyword" },
  { label: "show ip sla statistics", detail: "IP SLA results", insertText: "show ip sla statistics", kind: "keyword" },
  { label: "show environment", detail: "Environmental status", insertText: "show environment all", kind: "keyword" },
];

function toMonacoKind(
  kind: CiscoCompletion["kind"],
  CompletionItemKind: typeof monaco.languages.CompletionItemKind,
): monaco.languages.CompletionItemKind {
  switch (kind) {
    case "snippet": return CompletionItemKind.Snippet;
    case "value": return CompletionItemKind.Value;
    default: return CompletionItemKind.Keyword;
  }
}

/**
 * Register the Cisco IOS completion provider with Monaco.
 */
export function registerCiscoCompletions(monacoInstance: typeof monaco): void {
  monacoInstance.languages.registerCompletionItemProvider(CISCO_IOS_LANGUAGE_ID, {
    triggerCharacters: [" ", "\n"],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber).trimStart();
      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const { CompletionItemKind, CompletionItemInsertTextRule } = monacoInstance.languages;
      let completions: CiscoCompletion[];

      // Determine context: show commands, interface subcommands, or top-level
      if (lineContent.startsWith("show")) {
        completions = showCommands;
      } else if (lineContent.startsWith(" ") || lineContent.startsWith("\t")) {
        // Indented = likely inside a config block (interface, router, etc.)
        completions = [...interfaceSubcommands, ...topLevelCommands.slice(0, 5)];
      } else {
        completions = [...topLevelCommands, ...showCommands.slice(0, 10)];
      }

      const suggestions: monaco.languages.CompletionItem[] = completions.map((c, i) => ({
        label: c.label,
        kind: toMonacoKind(c.kind, CompletionItemKind),
        detail: c.detail,
        insertText: c.insertText,
        insertTextRules: c.kind === "snippet"
          ? CompletionItemInsertTextRule.InsertAsSnippet
          : undefined,
        range,
        sortText: String(i).padStart(3, "0"),
      }));

      return { suggestions };
    },
  });
}
