/**
 * Terraform/HCL language definition for Monaco Editor.
 *
 * Provides syntax highlighting for:
 * - Resource, data, variable, output, locals, module, provider blocks
 * - Terraform built-in functions
 * - String interpolation ${...}
 * - Comments (# and //)
 * - Type keywords (string, number, bool, list, map, object, set)
 * - Common provider resources (aws_, azurerm_, google_)
 *
 * @module terraformHcl
 */
import type * as monaco from "monaco-editor";

export const TERRAFORM_LANGUAGE_ID = "terraform";

export const terraformLanguageConfig: monaco.languages.LanguageConfiguration = {
  comments: {
    lineComment: "#",
    blockComment: ["/*", "*/"],
  },
  brackets: [
    ["{", "}"],
    ["[", "]"],
    ["(", ")"],
  ],
  autoClosingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
  ],
  surroundingPairs: [
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "(", close: ")" },
    { open: '"', close: '"' },
  ],
  indentationRules: {
    increaseIndentPattern: /^\s*(resource|data|variable|output|locals|module|provider|terraform|dynamic|content|provisioner|connection|backend|lifecycle|for_each|count)\b.*\{\s*$/,
    decreaseIndentPattern: /^\s*\}/,
  },
};

export const terraformTokensProvider: monaco.languages.IMonarchLanguage = {
  defaultToken: "",
  ignoreCase: false,

  // Top-level block keywords
  blockKeywords: [
    "resource", "data", "variable", "output", "locals",
    "module", "provider", "terraform", "backend",
    "provisioner", "connection", "dynamic", "content",
    "moved", "import", "check",
  ],

  // Meta-arguments
  metaArguments: [
    "for_each", "count", "depends_on", "lifecycle",
    "create_before_destroy", "prevent_destroy",
    "ignore_changes", "replace_triggered_by",
    "providers", "source", "version",
  ],

  // Type keywords
  typeKeywords: [
    "string", "number", "bool", "list", "map",
    "set", "object", "tuple", "any", "optional",
    "null", "true", "false",
  ],

  // Built-in functions
  builtinFunctions: [
    "abs", "ceil", "floor", "log", "max", "min", "pow", "signum",
    "chomp", "format", "formatlist", "indent", "join", "lower",
    "regex", "regexall", "replace", "split", "strrev", "substr",
    "title", "trim", "trimprefix", "trimsuffix", "trimspace", "upper",
    "alltrue", "anytrue", "chunklist", "coalesce", "coalescelist",
    "compact", "concat", "contains", "distinct", "element", "flatten",
    "index", "keys", "length", "lookup", "matchkeys", "merge",
    "one", "range", "reverse", "setintersection", "setproduct",
    "setsubtract", "setunion", "slice", "sort", "sum", "transpose",
    "values", "zipmap",
    "base64decode", "base64encode", "base64gzip", "csvdecode",
    "jsondecode", "jsonencode", "textdecodebase64", "textencodebase64",
    "urlencode", "yamldecode", "yamlencode",
    "abspath", "dirname", "pathexpand", "basename", "file",
    "fileexists", "fileset", "filebase64", "templatefile",
    "formatdate", "timeadd", "timecmp", "timestamp", "plantimestamp",
    "base64sha256", "base64sha512", "bcrypt", "filebase64sha256",
    "filebase64sha512", "filemd5", "filesha1", "filesha256",
    "filesha512", "md5", "rsadecrypt", "sha1", "sha256", "sha512",
    "uuid", "uuidv5",
    "cidrhost", "cidrnetmask", "cidrsubnet", "cidrsubnets",
    "can", "nonsensitive", "sensitive", "tobool", "tolist",
    "tomap", "tonumber", "toset", "tostring", "try", "type",
    "endswith", "startswith",
  ],

  tokenizer: {
    root: [
      // Line comments
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],

      // Block comments
      [/\/\*/, "comment", "@blockComment"],

      // String interpolation
      [/"/, "string", "@string"],

      // Heredoc
      [/<<-?\s*(\w+)/, { token: "string.heredoc", next: "@heredoc.$1" }],

      // Numbers
      [/\b\d+(\.\d+)?\b/, "number"],

      // Block keywords (resource, data, variable, etc.)
      [/\b(resource|data|variable|output|locals|module|provider|terraform|backend|provisioner|connection|dynamic|content|moved|import|check)\b/, "keyword.block"],

      // Meta-arguments
      [/\b(for_each|count|depends_on|lifecycle|create_before_destroy|prevent_destroy|ignore_changes|replace_triggered_by|providers|source|version)\b/, "keyword.meta"],

      // Control flow
      [/\b(for|in|if|else|endif|endfor)\b/, "keyword.control"],

      // Type keywords
      [/\b(string|number|bool|list|map|set|object|tuple|any|optional)\b/, "type"],

      // Boolean and null
      [/\b(true|false|null)\b/, "keyword.constant"],

      // Built-in functions (followed by paren)
      [/\b([a-z]\w*)\s*\(/, {
        cases: {
          "$1@builtinFunctions": { token: "function.builtin", next: "@pop" },
          "@default": { token: "function", next: "@pop" },
        },
      }],

      // Resource type references (aws_instance, azurerm_resource_group, google_compute_instance)
      [/\b(aws|azurerm|google|azuread|helm|kubernetes|vault|consul|nomad|tfe|tls|random|null|local|external|archive|http|dns|time)_\w+\b/, "type.resource"],

      // Attribute references (var., local., module., data., each., self., count.)
      [/\b(var|local|module|data|each|self|count|path|terraform)\b(?=\.)/, "variable.predefined"],

      // Identifiers
      [/[a-zA-Z_]\w*/, "identifier"],

      // Operators
      [/[=!<>]=?|&&|\|\||[+\-*/%]/, "operator"],
      [/=>/, "operator.arrow"],

      // Braces
      [/[{}()[\]]/, "@brackets"],

      // Whitespace
      [/\s+/, "white"],
    ],

    string: [
      [/\$\{/, { token: "delimiter.interpolation", next: "@interpolation" }],
      [/[^"$\\]+/, "string"],
      [/\\./, "string.escape"],
      [/"/, "string", "@pop"],
    ],

    interpolation: [
      [/\}/, { token: "delimiter.interpolation", next: "@pop" }],
      { include: "root" },
    ],

    heredoc: [
      [/^(\s*)(\w+)$/, {
        cases: {
          "$2==$S2": { token: "string.heredoc", next: "@pop" },
          "@default": "string.heredoc",
        },
      }],
      [/.*/, "string.heredoc"],
    ],

    blockComment: [
      [/\*\//, "comment", "@pop"],
      [/./, "comment"],
    ],
  },
};

/**
 * Register the Terraform/HCL language with Monaco.
 */
export function registerTerraformLanguage(monacoInstance: typeof monaco): void {
  monacoInstance.languages.register({
    id: TERRAFORM_LANGUAGE_ID,
    extensions: [".tf", ".tfvars", ".hcl"],
    aliases: ["Terraform", "HCL", "tf"],
  });

  monacoInstance.languages.setLanguageConfiguration(
    TERRAFORM_LANGUAGE_ID,
    terraformLanguageConfig,
  );

  monacoInstance.languages.setMonarchTokensProvider(
    TERRAFORM_LANGUAGE_ID,
    terraformTokensProvider,
  );
}
