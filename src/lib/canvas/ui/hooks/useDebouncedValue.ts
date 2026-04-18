/**
 * useDebouncedValue — delays updating a value until a pause in changes.
 *
 * Used by StencilPalette to debounce the search input, avoiding
 * re-filtering on every keystroke.
 *
 * @module
 */

import { useState, useEffect } from 'react';

/**
 * Returns a debounced version of the input value.
 *
 * The returned value only updates after `delay` milliseconds
 * have passed since the last change to `value`.
 *
 * @param value - The value to debounce.
 * @param delay - Debounce delay in milliseconds.
 * @returns The debounced value.
 */
export function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
