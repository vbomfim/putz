/**
 * useSearch — Hook for terminal scrollback search.
 *
 * Integrates with xterm.js @xterm/addon-search to provide
 * find next/previous, case sensitivity, and regex support.
 *
 * The hook manages the SearchAddon lifecycle and provides
 * a simple API for the SearchBar component.
 *
 * @module useSearch
 */
import { useCallback, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { SearchAddon } from "@xterm/addon-search";

interface UseSearchOptions {
  /** Reference to the xterm Terminal instance. */
  terminal: Terminal | null;
}

interface UseSearchReturn {
  /** Whether the search bar is visible. */
  isSearchOpen: boolean;
  /** Whether the search has matching results. */
  hasResults: boolean;
  /** Whether case-sensitive mode is on. */
  caseSensitive: boolean;
  /** Whether regex mode is on. */
  useRegex: boolean;
  /** Open the search bar. */
  openSearch: () => void;
  /** Close the search bar and clear highlights. */
  closeSearch: () => void;
  /** Find the next occurrence of the term. */
  findNext: (term: string) => void;
  /** Find the previous occurrence of the term. */
  findPrevious: (term: string) => void;
  /** Toggle case-sensitive search. */
  toggleCaseSensitive: () => void;
  /** Toggle regex search. */
  toggleRegex: () => void;
}

/**
 * Hook that manages the search addon lifecycle for xterm.js.
 *
 * The SearchAddon is loaded lazily on first search open and
 * disposed on terminal cleanup.
 */
export function useSearch({ terminal }: UseSearchOptions): UseSearchReturn {
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [hasResults, setHasResults] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [useRegex, setUseRegex] = useState(false);

  // Lazily initialize the search addon
  const getSearchAddon = useCallback(() => {
    if (!terminal) return null;

    if (!searchAddonRef.current) {
      const addon = new SearchAddon();
      terminal.loadAddon(addon);
      searchAddonRef.current = addon;
    }

    return searchAddonRef.current;
  }, [terminal]);

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
  }, []);

  const closeSearch = useCallback(() => {
    setIsSearchOpen(false);
    setHasResults(false);

    // Clear search decorations
    const addon = searchAddonRef.current;
    if (addon) {
      addon.clearDecorations();
    }
  }, []);

  const findNext = useCallback(
    (term: string) => {
      const addon = getSearchAddon();
      if (!addon || !term) {
        setHasResults(false);
        return;
      }

      const found = addon.findNext(term, {
        caseSensitive,
        regex: useRegex,
        incremental: true,
      });
      setHasResults(!!found);
    },
    [getSearchAddon, caseSensitive, useRegex],
  );

  const findPrevious = useCallback(
    (term: string) => {
      const addon = getSearchAddon();
      if (!addon || !term) {
        setHasResults(false);
        return;
      }

      const found = addon.findPrevious(term, {
        caseSensitive,
        regex: useRegex,
        incremental: true,
      });
      setHasResults(!!found);
    },
    [getSearchAddon, caseSensitive, useRegex],
  );

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => !prev);
  }, []);

  const toggleRegex = useCallback(() => {
    setUseRegex((prev) => !prev);
  }, []);

  return {
    isSearchOpen,
    hasResults,
    caseSensitive,
    useRegex,
    openSearch,
    closeSearch,
    findNext,
    findPrevious,
    toggleCaseSensitive,
    toggleRegex,
  };
}
