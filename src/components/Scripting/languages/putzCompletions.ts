/**
 * Putz scripting API completion provider for Monaco Editor.
 *
 * Provides autocompletion for the `putz.*` global API available
 * in Putz automation scripts (JavaScript).
 *
 * @module putzCompletions
 */
import type * as monaco from "monaco-editor";

interface PutzApiMethod {
  label: string;
  detail: string;
  documentation: string;
  insertText: string;
  kind: "method" | "snippet";
}

const putzApiMethods: PutzApiMethod[] = [
  {
    label: "putz.send",
    detail: "Send command to terminal",
    documentation: "Sends a string to the active PTY session. Equivalent to typing the text and pressing Enter.",
    insertText: 'putz.send("${1:show version}");',
    kind: "method",
  },
  {
    label: "putz.waitFor",
    detail: "Wait for pattern in output",
    documentation: "Waits for a string or regex pattern to appear in the terminal output. Returns the captured output. Default timeout: 30 seconds.",
    insertText: 'putz.waitFor("${1:#}", ${2:5000});',
    kind: "method",
  },
  {
    label: "putz.sendAndCapture",
    detail: "Send command and capture output",
    documentation: "Sends a command, then waits for a prompt pattern and returns everything between. Combines send() + waitFor().",
    insertText: 'const ${1:output} = putz.sendAndCapture("${2:show version}", "${3:#}", ${4:5000});',
    kind: "method",
  },
  {
    label: "putz.sleep",
    detail: "Pause execution (ms)",
    documentation: "Pauses script execution for the specified number of milliseconds.",
    insertText: "putz.sleep(${1:1000});",
    kind: "method",
  },
  {
    label: "putz.log",
    detail: "Log message to output panel",
    documentation: "Writes a message to the script output panel. Useful for debugging and status reporting.",
    insertText: 'putz.log("${1:message}");',
    kind: "method",
  },
  {
    label: "putz.disconnect",
    detail: "Disconnect the session",
    documentation: "Disconnects the current terminal/SSH session.",
    insertText: "putz.disconnect();",
    kind: "method",
  },
  {
    label: "putz.vault.get",
    detail: "Get credential from vault",
    documentation: "Retrieves a stored credential by name from the Putz vault. Use for passwords, keys, and secrets.",
    insertText: 'const ${1:password} = putz.vault.get("${2:credential-name}");',
    kind: "method",
  },
];

const putzSnippets: PutzApiMethod[] = [
  {
    label: "putz-login",
    detail: "SSH login script template",
    documentation: "Complete SSH login script with credential retrieval and prompt detection.",
    insertText: [
      '// Login to device via SSH',
      'putz.waitFor("${1:Password:}", ${2:10000});',
      'const password = putz.vault.get("${3:device-password}");',
      'putz.send(password);',
      'putz.waitFor("${4:#}", ${5:5000});',
      'putz.log("Login successful");',
    ].join("\n"),
    kind: "snippet",
  },
  {
    label: "putz-backup-config",
    detail: "Backup running-config",
    documentation: "Captures the running configuration and logs it.",
    insertText: [
      '// Backup running configuration',
      'putz.send("terminal length 0");',
      'putz.waitFor("#", 3000);',
      'const config = putz.sendAndCapture("show running-config", "#", 30000);',
      'putz.log("Config captured: " + config.length + " bytes");',
      'putz.send("terminal length 24");',
      'putz.waitFor("#", 3000);',
    ].join("\n"),
    kind: "snippet",
  },
  {
    label: "putz-show-version",
    detail: "Capture show version output",
    documentation: "Sends show version and captures the output.",
    insertText: [
      'putz.send("show version");',
      'const version = putz.waitFor("${1:#}", ${2:5000});',
      'putz.log("Version info:\\n" + version);',
    ].join("\n"),
    kind: "snippet",
  },
  {
    label: "putz-multi-command",
    detail: "Run multiple commands template",
    documentation: "Template for running multiple commands and capturing output.",
    insertText: [
      'const commands = [',
      '  "show version",',
      '  "show ip interface brief",',
      '  "show ip route",',
      '];',
      '',
      'for (const cmd of commands) {',
      '  putz.send(cmd);',
      '  const output = putz.waitFor("#", 5000);',
      '  putz.log("=== " + cmd + " ===");',
      '  putz.log(output);',
      '  putz.sleep(500);',
      '}',
    ].join("\n"),
    kind: "snippet",
  },
  {
    label: "putz-config-change",
    detail: "Config change with save",
    documentation: "Enter config mode, make changes, save config.",
    insertText: [
      '// Enter configuration mode',
      'putz.send("configure terminal");',
      'putz.waitFor("(config)#", 3000);',
      '',
      '// Make changes',
      'putz.send("${1:interface GigabitEthernet0/0}");',
      'putz.waitFor("(config-if)#", 3000);',
      'putz.send("${2:description Updated by Putz}");',
      'putz.waitFor("(config-if)#", 3000);',
      '',
      '// Save',
      'putz.send("end");',
      'putz.waitFor("#", 3000);',
      'putz.send("write memory");',
      'putz.waitFor("#", 5000);',
      'putz.log("Configuration saved");',
    ].join("\n"),
    kind: "snippet",
  },
];

/**
 * Register the Putz API completion provider for JavaScript mode.
 */
export function registerPutzCompletions(monacoInstance: typeof monaco): void {
  monacoInstance.languages.registerCompletionItemProvider("javascript", {
    triggerCharacters: ["."],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber);
      const textBeforeCursor = lineContent.substring(0, position.column - 1);

      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const { CompletionItemKind, CompletionItemInsertTextRule } = monacoInstance.languages;
      const suggestions: monaco.languages.CompletionItem[] = [];

      // After "putz." — show API methods
      if (textBeforeCursor.endsWith("putz.") || textBeforeCursor.match(/putz\.[\w]*$/)) {
        for (const method of putzApiMethods) {
          // Strip "putz." prefix from insertText since user already typed it
          const stripped = method.insertText.replace(/^putz\./, "");
          suggestions.push({
            label: method.label,
            kind: CompletionItemKind.Method,
            detail: method.detail,
            documentation: method.documentation,
            insertText: stripped,
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            range,
            sortText: "0" + method.label,
          });
        }
        return { suggestions };
      }

      // After "putz.vault." — show vault methods
      if (textBeforeCursor.endsWith("putz.vault.") || textBeforeCursor.match(/putz\.vault\.[\w]*$/)) {
        const vaultGet = putzApiMethods.find((m) => m.label === "putz.vault.get")!;
        const stripped = vaultGet.insertText.replace(/^.*putz\.vault\./, "");
        suggestions.push({
          label: "get",
          kind: CompletionItemKind.Method,
          detail: vaultGet.detail,
          documentation: vaultGet.documentation,
          insertText: stripped,
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: "0get",
        });
        return { suggestions };
      }

      // General context — show putz methods and snippets
      for (const method of putzApiMethods) {
        suggestions.push({
          label: method.label,
          kind: CompletionItemKind.Method,
          detail: method.detail,
          documentation: method.documentation,
          insertText: method.insertText,
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: "1" + method.label,
        });
      }

      for (const snippet of putzSnippets) {
        suggestions.push({
          label: snippet.label,
          kind: CompletionItemKind.Snippet,
          detail: snippet.detail,
          documentation: snippet.documentation,
          insertText: snippet.insertText,
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range,
          sortText: "2" + snippet.label,
        });
      }

      return { suggestions };
    },
  });
}
