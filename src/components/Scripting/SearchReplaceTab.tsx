/**
 * SearchReplaceTab — Multi-file search and replace in a tab.
 *
 * VS Code-style interface: search input, replace input, options
 * (case sensitive, regex, file glob), results grouped by file
 * with line previews and replace/replace-all buttons.
 *
 * @module SearchReplaceTab
 */
import { useState, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../stores/layoutStore";
import "./Scripting.css";

interface FileMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface FileSearchResult {
  path: string;
  matches: FileMatch[];
}

interface SearchReplaceTabProps {
  /** Initial directory to search in. */
  initialDirectory?: string;
  regionId: string;
  tabId: string;
}

export function SearchReplaceTab({
  initialDirectory,
  regionId: _regionId,
  tabId: _tabId,
}: SearchReplaceTabProps) {
  const [searchText, setSearchText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [directory, setDirectory] = useState(initialDirectory || "");
  const [fileGlob, setFileGlob] = useState("*");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);
  const [results, setResults] = useState<FileSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isReplacing, setIsReplacing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const searchInputRef = useRef<HTMLInputElement>(null);
  const addEditorTab = useLayoutStore((s) => s.addEditorTab);

  const handleSearch = useCallback(async () => {
    if (!searchText.trim() || !directory.trim()) return;
    setIsSearching(true);
    setStatusMessage("");
    try {
      const res = await invoke<FileSearchResult[]>("file_search", {
        directory: directory.trim(),
        pattern: searchText,
        fileGlob: fileGlob || undefined,
        caseSensitive,
        useRegex,
        maxResults: 1000,
      });
      setResults(res);
      const total = res.reduce((sum, r) => sum + r.matches.length, 0);
      setStatusMessage(
        `${total} result${total !== 1 ? "s" : ""} in ${res.length} file${res.length !== 1 ? "s" : ""}`,
      );
      setCollapsedFiles(new Set());
    } catch (err: unknown) {
      setStatusMessage(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  }, [searchText, directory, fileGlob, caseSensitive, useRegex]);

  const handleReplaceInFile = useCallback(
    async (filePath: string) => {
      if (!replaceText && replaceText !== "") return;
      setIsReplacing(true);
      try {
        const count = await invoke<number>("file_replace", {
          path: filePath,
          pattern: searchText,
          replacement: replaceText,
          caseSensitive,
          useRegex,
        });
        setStatusMessage(
          `Replaced ${count} match${count !== 1 ? "es" : ""} in ${filePath.split("/").pop()}`,
        );
        // Remove this file from results
        setResults((prev) => prev.filter((r) => r.path !== filePath));
      } catch (err: unknown) {
        setStatusMessage(
          `Error: ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setIsReplacing(false);
      }
    },
    [searchText, replaceText, caseSensitive, useRegex],
  );

  const handleReplaceAll = useCallback(async () => {
    if (!searchText.trim() || !directory.trim()) return;
    setIsReplacing(true);
    try {
      const count = await invoke<number>("file_replace_all", {
        directory: directory.trim(),
        pattern: searchText,
        replacement: replaceText,
        fileGlob: fileGlob || undefined,
        caseSensitive,
        useRegex,
      });
      setStatusMessage(
        `Replaced ${count} match${count !== 1 ? "es" : ""} across all files`,
      );
      setResults([]);
    } catch (err: unknown) {
      setStatusMessage(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      setIsReplacing(false);
    }
  }, [searchText, replaceText, directory, fileGlob, caseSensitive, useRegex]);

  const toggleFileCollapse = useCallback((path: string) => {
    setCollapsedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const openFileInEditor = useCallback(
    (filePath: string) => {
      addEditorTab(undefined, filePath);
    },
    [addEditorTab],
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") handleSearch();
    },
    [handleSearch],
  );

  /** Highlight matched text in a line */
  const renderMatchLine = (match: FileMatch) => {
    const { lineContent, matchStart, matchEnd } = match;
    const before = lineContent.substring(0, matchStart);
    const matched = lineContent.substring(matchStart, matchEnd);
    const after = lineContent.substring(matchEnd);
    return (
      <span className="search-result__line-text">
        <span>{before}</span>
        <span className="search-result__highlight">{matched}</span>
        <span>{after}</span>
      </span>
    );
  };

  return (
    <div className="search-replace-tab" data-testid="search-replace-tab">
      {/* Search inputs */}
      <div className="search-replace-tab__inputs">
        <div className="search-replace-tab__row">
          <input
            ref={searchInputRef}
            className="search-replace-tab__input"
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            placeholder="Search"
            autoFocus
          />
          <button
            className="search-replace-tab__btn search-replace-tab__btn--primary"
            onClick={handleSearch}
            disabled={isSearching || !searchText.trim() || !directory.trim()}
          >
            {isSearching ? "…" : "🔍"}
          </button>
        </div>
        <div className="search-replace-tab__row">
          <input
            className="search-replace-tab__input"
            type="text"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            placeholder="Replace"
          />
          <button
            className="search-replace-tab__btn"
            onClick={handleReplaceAll}
            disabled={isReplacing || results.length === 0}
            title="Replace all"
          >
            {isReplacing ? "…" : "⟳"}
          </button>
        </div>
        <div className="search-replace-tab__row search-replace-tab__row--options">
          <input
            className="search-replace-tab__input search-replace-tab__input--small"
            type="text"
            value={directory}
            onChange={(e) => setDirectory(e.target.value)}
            placeholder="Directory"
          />
          <input
            className="search-replace-tab__input search-replace-tab__input--tiny"
            type="text"
            value={fileGlob}
            onChange={(e) => setFileGlob(e.target.value)}
            placeholder="*.cfg"
            title="File pattern (e.g. *.cfg, *.txt)"
          />
          <label className="search-replace-tab__option" title="Case sensitive">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Aa
          </label>
          <label className="search-replace-tab__option" title="Use regex">
            <input
              type="checkbox"
              checked={useRegex}
              onChange={(e) => setUseRegex(e.target.checked)}
            />
            .*
          </label>
        </div>
      </div>

      {/* Status */}
      {statusMessage && (
        <div className="search-replace-tab__status">{statusMessage}</div>
      )}

      {/* Results */}
      <div className="search-replace-tab__results">
        {results.map((fileResult) => {
          const isCollapsed = collapsedFiles.has(fileResult.path);
          const fileName = fileResult.path.split("/").pop() || fileResult.path;
          const dirPath = fileResult.path.substring(
            0,
            fileResult.path.lastIndexOf("/"),
          );

          return (
            <div key={fileResult.path} className="search-result__file">
              <div
                className="search-result__file-header"
                onClick={() => toggleFileCollapse(fileResult.path)}
              >
                <span className="search-result__chevron">
                  {isCollapsed ? "▸" : "▾"}
                </span>
                <span
                  className="search-result__filename"
                  onClick={(e) => {
                    e.stopPropagation();
                    openFileInEditor(fileResult.path);
                  }}
                  title={fileResult.path}
                >
                  {fileName}
                </span>
                <span className="search-result__dir">{dirPath}</span>
                <span className="search-result__count">
                  {fileResult.matches.length}
                </span>
                <button
                  className="search-result__replace-file"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleReplaceInFile(fileResult.path);
                  }}
                  disabled={isReplacing}
                  title="Replace all in this file"
                >
                  ⟳
                </button>
              </div>
              {!isCollapsed && (
                <div className="search-result__matches">
                  {fileResult.matches.map((match, idx) => (
                    <div
                      key={idx}
                      className="search-result__match"
                      onClick={() => openFileInEditor(fileResult.path)}
                    >
                      <span className="search-result__line-num">
                        {match.lineNumber}
                      </span>
                      {renderMatchLine(match)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {results.length === 0 && !isSearching && statusMessage && (
          <div className="search-replace-tab__empty">No results</div>
        )}
      </div>
    </div>
  );
}
