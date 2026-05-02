/**
 * Jinja2 template language definition for Monaco Editor.
 *
 * Provides syntax highlighting and autocompletion for:
 * - Expression blocks {{ ... }}
 * - Statement blocks {% ... %}
 * - Comment blocks {# ... #}
 * - Jinja2 built-in filters (upper, lower, join, default, etc.)
 * - Jinja2 tests (defined, none, string, number, etc.)
 * - Control structures (for, if, block, macro, etc.)
 * - Common Ansible/network variables
 *
 * Host content (outside Jinja blocks) is treated as plain text
 * to work with any template target (Cisco IOS, YAML, HTML, etc.)
 *
 * @module jinja2
 */
import type * as monaco from "monaco-editor";

export const JINJA2_LANGUAGE_ID = "jinja2";

export const jinja2LanguageConfig: monaco.languages.LanguageConfiguration = {
  comments: {
    blockComment: ["{#", "#}"],
  },
  brackets: [
    ["{%", "%}"],
    ["{{", "}}"],
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{{", close: " }}" },
    { open: "{%", close: " %}" },
    { open: "{#", close: " #}" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "(", close: ")" },
    { open: "[", close: "]" },
  ],
  surroundingPairs: [
    { open: "{{", close: "}}" },
    { open: "{%", close: "%}" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
};

export const jinja2TokensProvider: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: false,

  // Jinja2 keywords (tags)
  keywords: [
    "for",
    "endfor",
    "if",
    "elif",
    "else",
    "endif",
    "block",
    "endblock",
    "extends",
    "include",
    "import",
    "from",
    "macro",
    "endmacro",
    "call",
    "endcall",
    "filter",
    "endfilter",
    "set",
    "endset",
    "raw",
    "endraw",
    "autoescape",
    "endautoescape",
    "with",
    "endwith",
    "trans",
    "endtrans",
    "pluralize",
    "do",
    "continue",
    "break",
    "as",
    "in",
    "not",
    "and",
    "or",
    "is",
    "recursive",
    "scoped",
    "ignore missing",
    "true",
    "false",
    "none",
    "True",
    "False",
    "None",
    "loop",
    "caller",
    "varargs",
    "kwargs",
  ],

  // Built-in filters
  filters: [
    "abs",
    "attr",
    "batch",
    "capitalize",
    "center",
    "count",
    "d",
    "default",
    "dictsort",
    "e",
    "escape",
    "filesizeformat",
    "first",
    "float",
    "forceescape",
    "format",
    "groupby",
    "indent",
    "int",
    "items",
    "join",
    "last",
    "length",
    "list",
    "lower",
    "map",
    "max",
    "min",
    "pprint",
    "random",
    "reject",
    "rejectattr",
    "replace",
    "reverse",
    "round",
    "safe",
    "select",
    "selectattr",
    "slice",
    "sort",
    "string",
    "striptags",
    "sum",
    "title",
    "tojson",
    "trim",
    "truncate",
    "unique",
    "upper",
    "urlencode",
    "urlize",
    "wordcount",
    "wordwrap",
    "xmlattr",
    // Ansible-specific filters
    "to_yaml",
    "to_json",
    "to_nice_yaml",
    "to_nice_json",
    "from_yaml",
    "from_json",
    "bool",
    "ternary",
    "regex_search",
    "regex_replace",
    "regex_findall",
    "combine",
    "dict2items",
    "items2dict",
    "subelements",
    "zip",
    "zip_longest",
    "ipaddr",
    "ipv4",
    "ipv6",
    "ipsubnet",
    "nthhost",
    "hwaddr",
    "macaddr",
    "hash",
    "password_hash",
    "b64encode",
    "b64decode",
    "flatten",
    "product",
    "permutations",
    "combinations",
    "type_debug",
    "mandatory",
    "comment",
  ],

  // Built-in tests
  tests: [
    "callable",
    "defined",
    "divisibleby",
    "eq",
    "equalto",
    "escaped",
    "even",
    "false",
    "ge",
    "gt",
    "greaterthan",
    "in",
    "iterable",
    "le",
    "lower",
    "lt",
    "lessthan",
    "mapping",
    "ne",
    "none",
    "number",
    "odd",
    "sameas",
    "sequence",
    "string",
    "true",
    "undefined",
    "upper",
    // Ansible-specific tests
    "match",
    "search",
    "regex",
    "version",
    "subset",
    "superset",
    "all",
    "any",
    "changed",
    "failed",
    "succeeded",
    "skipped",
    "file",
    "directory",
    "link",
    "exists",
    "abs",
  ],

  tokenizer: {
    root: [
      // Jinja2 comment blocks {# ... #}
      [/\{#/, "comment.jinja", "@jinjaComment"],

      // Jinja2 statement blocks {% ... %}
      [/\{%-?/, "delimiter.jinja.tag", "@jinjaTag"],

      // Jinja2 expression blocks {{ ... }}
      [/\{\{-?/, "delimiter.jinja.expr", "@jinjaExpr"],

      // Host language comments (! for Cisco, # for YAML/Python)
      [/^[!#].*$/, "comment"],

      // Host content — everything else is plain text
      [/./, "string.host"],
    ],

    jinjaComment: [
      [/#\}/, "comment.jinja", "@pop"],
      [/./, "comment.jinja"],
    ],

    jinjaTag: [
      [/-?%\}/, "delimiter.jinja.tag", "@pop"],
      { include: "jinjaCommon" },
    ],

    jinjaExpr: [
      [/-?\}\}/, "delimiter.jinja.expr", "@pop"],
      { include: "jinjaCommon" },
    ],

    jinjaCommon: [
      // Strings
      [/"/, "string.jinja", "@jinjaStringDouble"],
      [/'/, "string.jinja", "@jinjaStringSingle"],

      // Numbers
      [/\b\d+(\.\d+)?\b/, "number.jinja"],

      // Filter pipe
      [/\|/, "delimiter.pipe.jinja"],

      // Operators
      [/[=!<>]=?|~|[+\-*/%]|\*\*/, "operator.jinja"],

      // Dot accessor
      [/\./, "delimiter.dot.jinja"],

      // Keywords
      [
        /\b(for|endfor|if|elif|else|endif|block|endblock|extends|include|import|from|macro|endmacro|call|endcall|filter|endfilter|set|endset|raw|endraw|with|endwith|do|continue|break|as|in|not|and|or|is|recursive|scoped)\b/,
        "keyword.jinja",
      ],

      // Boolean / None
      [/\b(true|false|none|True|False|None)\b/, "keyword.constant.jinja"],

      // Loop variable
      [
        /\b(loop)\.(index|index0|revindex|revindex0|first|last|length|cycle|depth|depth0|previtem|nextitem|changed)\b/,
        "variable.predefined.jinja",
      ],

      // Identifiers (after pipe = filter, after "is" = test)
      [
        /[a-zA-Z_]\w*/,
        {
          cases: {
            "@filters": "function.filter.jinja",
            "@tests": "function.test.jinja",
            "@keywords": "keyword.jinja",
            "@default": "variable.jinja",
          },
        },
      ],

      // Brackets
      [/[{}()[\]]/, "delimiter.jinja"],

      // Comma
      [/,/, "delimiter.jinja"],

      // Whitespace
      [/\s+/, "white"],
    ],

    jinjaStringDouble: [
      [/[^"\\]+/, "string.jinja"],
      [/\\./, "string.escape.jinja"],
      [/"/, "string.jinja", "@pop"],
    ],

    jinjaStringSingle: [
      [/[^'\\]+/, "string.jinja"],
      [/\\./, "string.escape.jinja"],
      [/'/, "string.jinja", "@pop"],
    ],
  },
};

/**
 * Register the Jinja2 language with Monaco.
 */
export function registerJinja2Language(monacoInstance: typeof monaco): void {
  monacoInstance.languages.register({
    id: JINJA2_LANGUAGE_ID,
    extensions: [".j2", ".jinja", ".jinja2"],
    aliases: ["Jinja2", "Jinja", "j2"],
  });

  monacoInstance.languages.setLanguageConfiguration(
    JINJA2_LANGUAGE_ID,
    jinja2LanguageConfig,
  );

  monacoInstance.languages.setMonarchTokensProvider(
    JINJA2_LANGUAGE_ID,
    jinja2TokensProvider,
  );
}

/**
 * Register Jinja2 completion provider.
 */
export function registerJinja2Completions(monacoInstance: typeof monaco): void {
  monacoInstance.languages.registerCompletionItemProvider(JINJA2_LANGUAGE_ID, {
    triggerCharacters: ["|", " ", "{", "%"],

    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const lineContent = model.getLineContent(position.lineNumber);
      const textBefore = lineContent.substring(0, position.column - 1);

      const range: monaco.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const { CompletionItemKind, CompletionItemInsertTextRule } =
        monacoInstance.languages;
      const suggestions: monaco.languages.CompletionItem[] = [];

      // After pipe | — show filters
      if (textBefore.match(/\|\s*\w*$/)) {
        const filters: [string, string][] = [
          ["default", "default(${1:value})"],
          ["join", "join('${1:, }')"],
          ["upper", "upper"],
          ["lower", "lower"],
          ["trim", "trim"],
          ["replace", "replace('${1:old}', '${2:new}')"],
          ["length", "length"],
          ["first", "first"],
          ["last", "last"],
          ["sort", "sort"],
          ["reverse", "reverse"],
          ["unique", "unique"],
          ["int", "int"],
          ["float", "float"],
          ["string", "string"],
          ["list", "list"],
          ["capitalize", "capitalize"],
          ["title", "title"],
          ["truncate", "truncate(${1:80})"],
          ["indent", "indent(${1:4})"],
          ["tojson", "tojson"],
          ["to_yaml", "to_yaml"],
          ["to_json", "to_json"],
          ["to_nice_yaml", "to_nice_yaml"],
          ["regex_search", "regex_search('${1:pattern}')"],
          [
            "regex_replace",
            "regex_replace('${1:pattern}', '${2:replacement}')",
          ],
          ["ipaddr", "ipaddr"],
          ["ipv4", "ipv4"],
          ["ipsubnet", "ipsubnet(${1:24})"],
          ["bool", "bool"],
          ["ternary", "ternary('${1:true_val}', '${2:false_val}')"],
          ["map", "map(attribute='${1:name}')"],
          ["select", "select('${1:test}')"],
          ["reject", "reject('${1:test}')"],
          ["selectattr", "selectattr('${1:attr}', '${2:test}')"],
          ["groupby", "groupby('${1:attr}')"],
          ["batch", "batch(${1:3})"],
          ["flatten", "flatten"],
          ["combine", "combine(${1:other_dict})"],
          ["dict2items", "dict2items"],
          ["items2dict", "items2dict"],
          ["b64encode", "b64encode"],
          ["b64decode", "b64decode"],
          ["hash", "hash('${1:sha256}')"],
          ["comment", "comment"],
          ["mandatory", "mandatory"],
          ["type_debug", "type_debug"],
        ];
        for (const [label, insert] of filters) {
          suggestions.push({
            label,
            kind: CompletionItemKind.Function,
            detail: "Jinja2 filter",
            insertText: insert,
            insertTextRules: insert.includes("$")
              ? CompletionItemInsertTextRule.InsertAsSnippet
              : undefined,
            range,
          });
        }
        return { suggestions };
      }

      // Inside {% ... %} — show tags
      if (textBefore.match(/\{%-?\s*\w*$/)) {
        const tags: [string, string, string][] = [
          ["for", "for ${1:item} in ${2:items} %}", "For loop"],
          ["endfor", "endfor %}", "End for loop"],
          ["if", "if ${1:condition} %}", "If condition"],
          ["elif", "elif ${1:condition} %}", "Else if"],
          ["else", "else %}", "Else branch"],
          ["endif", "endif %}", "End if"],
          ["set", "set ${1:var} = ${2:value} %}", "Set variable"],
          ["block", "block ${1:name} %}", "Template block"],
          ["endblock", "endblock %}", "End block"],
          ["extends", "extends '${1:base.j2}' %}", "Extend template"],
          ["include", "include '${1:partial.j2}' %}", "Include template"],
          ["macro", "macro ${1:name}(${2:args}) %}", "Define macro"],
          ["endmacro", "endmacro %}", "End macro"],
          ["filter", "filter ${1:filtername} %}", "Filter block"],
          ["endfilter", "endfilter %}", "End filter"],
          ["raw", "raw %}", "Raw block (no processing)"],
          ["endraw", "endraw %}", "End raw"],
        ];
        for (const [label, insert, detail] of tags) {
          suggestions.push({
            label,
            kind: CompletionItemKind.Keyword,
            detail,
            insertText: insert,
            insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          });
        }
        return { suggestions };
      }

      // General context — show snippet templates
      const snippets: [string, string, string][] = [
        ["{{ expression }}", "{{ ${1:variable} }}", "Jinja2 expression"],
        ["{% tag %}", "{% ${1:tag} %}", "Jinja2 statement"],
        ["{# comment #}", "{# ${1:comment} #}", "Jinja2 comment"],
        [
          "for loop",
          "{% for ${1:item} in ${2:items} %}\n${3}\n{% endfor %}",
          "For loop block",
        ],
        ["if block", "{% if ${1:condition} %}\n${2}\n{% endif %}", "If block"],
        [
          "if/else",
          "{% if ${1:condition} %}\n${2}\n{% else %}\n${3}\n{% endif %}",
          "If/else block",
        ],
        [
          "macro",
          "{% macro ${1:name}(${2:args}) %}\n${3}\n{% endmacro %}",
          "Macro definition",
        ],
        [
          "block",
          "{% block ${1:name} %}\n${2}\n{% endblock %}",
          "Template block",
        ],
        [
          "interface template",
          "interface {{ ${1:interface_name} }}\n description {{ ${2:description} }}\n ip address {{ ${3:ip} }} {{ ${4:mask} }}\n no shutdown",
          "Cisco interface template",
        ],
        [
          "loop with index",
          "{% for ${1:item} in ${2:items} %}\n${3:{{ loop.index }}. {{ ${1} }}}\n{% endfor %}",
          "Loop with index",
        ],
      ];
      for (const [label, insert, detail] of snippets) {
        suggestions.push({
          label,
          kind: CompletionItemKind.Snippet,
          detail,
          insertText: insert,
          insertTextRules: CompletionItemInsertTextRule.InsertAsSnippet,
          range,
        });
      }

      return { suggestions };
    },
  });

  // Register a simple validation (marker) provider for unclosed blocks
  // This runs on model content change and adds warning markers
  let validationTimeout: ReturnType<typeof setTimeout> | null = null;
  monacoInstance.editor.onDidCreateModel((model) => {
    if (model.getLanguageId() !== JINJA2_LANGUAGE_ID) return;

    const validate = () => {
      const text = model.getValue();
      const markers: monaco.editor.IMarkerData[] = [];

      // Check for unclosed expression blocks {{ without }}
      let openExpr = 0;
      let openTag = 0;
      const lines = text.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Count opens and closes on this line
        const exprOpens = (line.match(/\{\{/g) || []).length;
        const exprCloses = (line.match(/\}\}/g) || []).length;
        const tagOpens = (line.match(/\{%/g) || []).length;
        const tagCloses = (line.match(/%\}/g) || []).length;

        openExpr += exprOpens - exprCloses;
        openTag += tagOpens - tagCloses;

        if (openExpr < 0) {
          markers.push({
            severity: monacoInstance.MarkerSeverity.Error,
            message: "Unexpected }}: no matching {{",
            startLineNumber: i + 1,
            startColumn: 1,
            endLineNumber: i + 1,
            endColumn: line.length + 1,
          });
          openExpr = 0;
        }
        if (openTag < 0) {
          markers.push({
            severity: monacoInstance.MarkerSeverity.Error,
            message: "Unexpected %}}: no matching {%",
            startLineNumber: i + 1,
            startColumn: 1,
            endLineNumber: i + 1,
            endColumn: line.length + 1,
          });
          openTag = 0;
        }
      }

      if (openExpr > 0) {
        markers.push({
          severity: monacoInstance.MarkerSeverity.Warning,
          message: `${openExpr} unclosed {{ expression(s)`,
          startLineNumber: lines.length,
          startColumn: 1,
          endLineNumber: lines.length,
          endColumn: lines[lines.length - 1].length + 1,
        });
      }
      if (openTag > 0) {
        markers.push({
          severity: monacoInstance.MarkerSeverity.Warning,
          message: `${openTag} unclosed {% tag(s)`,
          startLineNumber: lines.length,
          startColumn: 1,
          endLineNumber: lines.length,
          endColumn: lines[lines.length - 1].length + 1,
        });
      }

      monacoInstance.editor.setModelMarkers(model, "jinja2", markers);
    };

    model.onDidChangeContent(() => {
      if (validationTimeout) clearTimeout(validationTimeout);
      validationTimeout = setTimeout(validate, 500);
    });

    // Initial validation
    validate();
  });
}
