/**
 * Radio — Internet radio station browser & player.
 *
 * Uses the free radio-browser.info API to list, filter, and play
 * internet radio stations via HTML5 Audio API.
 *
 * @module Radio
 */
import React, { useState, useEffect, useRef, useCallback } from "react";
import "./Radio.css";

/** Shape of a station returned by radio-browser.info. */
interface RadioStation {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved: string;
  favicon: string;
  tags: string;
  country: string;
  codec: string;
  bitrate: number;
  votes: number;
  clickcount: number;
  lastcheckok: number;
}

const API_BASE = "https://de1.api.radio-browser.info/json";

/** Country entry from the API. */
interface CountryEntry {
  name: string;
  stationcount: number;
}

/** Fetch country list sorted by station count. */
async function fetchCountries(): Promise<CountryEntry[]> {
  const res = await fetch(
    `${API_BASE}/countries?order=stationcount&reverse=true`,
  );
  if (!res.ok) return [];
  const data: CountryEntry[] = await res.json();
  return data
    .filter((c) => c.stationcount >= 20)
    .sort((a, b) => a.name.localeCompare(b.name));
}

const PAGE_SIZE = 50;

/** Fetch stations from radio-browser.info, filtering only working streams. */
async function fetchStations(
  country: string,
  search: string,
  offset: number = 0,
): Promise<RadioStation[]> {
  let url: string;
  if (search) {
    const params = new URLSearchParams({
      name: search,
      limit: String(PAGE_SIZE),
      offset: String(offset),
      order: "clickcount",
      reverse: "true",
    });
    if (country) params.set("country", country);
    url = `${API_BASE}/stations/search?${params}`;
  } else if (country) {
    url = `${API_BASE}/stations/bycountry/${encodeURIComponent(country)}?limit=${PAGE_SIZE}&offset=${offset}&order=clickcount&reverse=true`;
  } else {
    url = `${API_BASE}/stations/search?limit=${PAGE_SIZE}&offset=${offset}&order=clickcount&reverse=true`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: RadioStation[] = await res.json();
  return data.filter((s) => s.lastcheckok === 1);
}

const FAVORITES_KEY = "putz-radio-favorites";

function loadFavorites(): Map<string, RadioStation> {
  try {
    const raw = localStorage.getItem(FAVORITES_KEY);
    if (!raw) return new Map();
    const arr: RadioStation[] = JSON.parse(raw);
    return new Map(arr.map((s) => [s.stationuuid, s]));
  } catch {
    return new Map();
  }
}

function saveFavorites(favs: Map<string, RadioStation>): void {
  localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favs.values()]));
}

export function Radio() {
  const [poweredOn, setPoweredOn] = useState(true);
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [countries, setCountries] = useState<CountryEntry[]>([]);
  const [favorites, setFavorites] =
    useState<Map<string, RadioStation>>(loadFavorites);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("⭐ Favorites");
  const [minBitrate, setMinBitrate] = useState(0);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingName, setPlayingName] = useState("");
  const playingStationRef = useRef<RadioStation | null>(null);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const toggleFavorite = useCallback((station: RadioStation) => {
    setFavorites((prev) => {
      const next = new Map(prev);
      if (next.has(station.stationuuid)) {
        next.delete(station.stationuuid);
      } else {
        next.set(station.stationuuid, station);
      }
      saveFavorites(next);
      return next;
    });
  }, []);

  const addCustomStation = () => {
    if (!addName.trim() || !addUrl.trim()) return;
    const station: RadioStation = {
      stationuuid: `custom-${Date.now()}`,
      name: addName.trim(),
      url: addUrl.trim(),
      url_resolved: addUrl.trim(),
      favicon: "",
      tags: "custom",
      country: "",
      codec: "",
      bitrate: 0,
      votes: 0,
      clickcount: 0,
      lastcheckok: 1,
    };
    setFavorites((prev) => {
      const next = new Map(prev);
      next.set(station.stationuuid, station);
      saveFavorites(next);
      // Update stations list directly if viewing favorites
      if (country === "⭐ Favorites") {
        const favList = [...next.values()];
        const filtered = search
          ? favList.filter((s) =>
              s.name.toLowerCase().includes(search.toLowerCase()),
            )
          : favList;
        setStations(filtered);
      }
      return next;
    });
    setAddName("");
    setAddUrl("");
    setShowAddForm(false);
  };

  // Fetch country list on mount
  useEffect(() => {
    fetchCountries().then(setCountries);
  }, []);

  const favoritesRef = useRef(favorites);
  favoritesRef.current = favorites;

  const loadStations = useCallback(async (c: string, q: string) => {
    // Favorites: load from local storage
    if (c === "⭐ Favorites") {
      const favList = [...favoritesRef.current.values()];
      const filtered = q
        ? favList.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()))
        : favList;
      setStations(filtered);
      setHasMore(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setHasMore(true);
    try {
      const data = await fetchStations(c, q, 0);
      setStations(data);
      setHasMore(data.length >= PAGE_SIZE);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stations");
      setStations([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const data = await fetchStations(country, search, stations.length);
      setStations((prev) => [...prev, ...data]);
      setHasMore(data.length >= PAGE_SIZE);
    } catch {
      /* ignore */
    }
    setLoadingMore(false);
  }, [country, search, stations.length, loadingMore, hasMore]);

  // Auto-load more when bitrate filter leaves too few visible results
  const minVisibleCount = 12;
  useEffect(() => {
    if (loading || loadingMore || !hasMore || minBitrate === 0) return;
    const visible = stations.filter((s) => s.bitrate >= minBitrate);
    if (visible.length < minVisibleCount && stations.length > 0) {
      loadMore();
    }
  }, [stations, minBitrate, loading, loadingMore, hasMore, loadMore]);

  // Load on mount and when country changes
  useEffect(() => {
    loadStations(country, "");
    setSearch("");
  }, [country, loadStations]);

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
        audioRef.current = null;
      }
      window.dispatchEvent(
        new CustomEvent("putz-radio-change", {
          detail: { name: "", playing: false },
        }),
      );
    };
  }, []);

  const handleSearch = () => {
    loadStations(country, search);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  // Drag-to-reorder for favorites (pointer-based — WKWebView blocks HTML5 DnD)
  const isFavView = country === "⭐ Favorites";
  const dragSrcIdx = useRef<number>(-1);
  const [dropIdx, setDropIdx] = useState<number>(-1);
  const isDragging = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<HTMLDivElement | null>(null);

  const handlePointerDown = (idx: number) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const tag = (e.target as HTMLElement).closest("button");
    if (tag) return; // don't drag from buttons
    dragSrcIdx.current = idx;
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    isDragging.current = false;
  };

  const handleListPointerMove = useCallback((e: React.PointerEvent) => {
    if (dragSrcIdx.current < 0) return;
    const dx = e.clientX - dragStartPos.current.x;
    const dy = e.clientY - dragStartPos.current.y;

    if (!isDragging.current) {
      if (Math.abs(dx) + Math.abs(dy) < 8) return;
      isDragging.current = true;
      // Create ghost
      const cards = e.currentTarget.querySelectorAll("[data-idx]");
      const srcCard = cards[dragSrcIdx.current] as HTMLElement | undefined;
      if (srcCard) {
        const ghost = document.createElement("div");
        ghost.className = "radio__drag-ghost";
        ghost.textContent =
          srcCard.querySelector(".radio__card-name")?.textContent || "";
        ghost.style.width = srcCard.offsetWidth + "px";
        document.body.appendChild(ghost);
        ghostRef.current = ghost;
        srcCard.style.opacity = "0.3";
      }
    }

    // Move ghost
    if (ghostRef.current) {
      ghostRef.current.style.left = e.clientX + 12 + "px";
      ghostRef.current.style.top = e.clientY - 16 + "px";
    }

    // Find drop target
    const cards = e.currentTarget.querySelectorAll("[data-idx]");
    let closest = -1;
    let closestDist = Infinity;
    cards.forEach((card) => {
      const rect = card.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dist = Math.abs(e.clientX - cx) + Math.abs(e.clientY - cy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = Number((card as HTMLElement).dataset.idx);
      }
    });
    if (!isNaN(closest) && closest !== dragSrcIdx.current) {
      setDropIdx(closest);
    }
  }, []);

  const finishDrag = useCallback(() => {
    if (ghostRef.current) {
      ghostRef.current.remove();
      ghostRef.current = null;
    }
    // Restore opacity
    document.querySelectorAll(".radio__card").forEach((c) => {
      (c as HTMLElement).style.opacity = "";
    });

    if (
      isDragging.current &&
      dragSrcIdx.current >= 0 &&
      dropIdx >= 0 &&
      dragSrcIdx.current !== dropIdx
    ) {
      const fromIdx = dragSrcIdx.current;
      const toIdx = dropIdx;
      setStations((prev) => {
        const reordered = [...prev];
        const [moved] = reordered.splice(fromIdx, 1);
        reordered.splice(toIdx, 0, moved!);
        const newFavs = new Map<string, RadioStation>();
        reordered.forEach((s) => newFavs.set(s.stationuuid, s));
        favorites.forEach((s, id) => {
          if (!newFavs.has(id)) newFavs.set(id, s);
        });
        saveFavorites(newFavs);
        setFavorites(newFavs);
        return reordered;
      });
    }
    dragSrcIdx.current = -1;
    isDragging.current = false;
    setDropIdx(-1);
  }, [dropIdx, favorites]);

  const handleListPointerUp = useCallback(() => {
    finishDrag();
  }, [finishDrag]);

  const errorHandlerRef = useRef<(() => void) | null>(null);

  const play = useCallback(
    (station: RadioStation) => {
      if (audioRef.current) {
        if (errorHandlerRef.current) {
          audioRef.current.removeEventListener(
            "error",
            errorHandlerRef.current,
          );
        }
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      const audio = new Audio(station.url_resolved || station.url);
      audio.volume = volume / 100;

      const onError = () => {
        if (audioRef.current === audio) {
          setError(`Could not play "${station.name}" — stream may be offline`);
          setPlayingId(null);
          setPaused(true);
        }
      };
      errorHandlerRef.current = onError;
      audio.addEventListener("error", onError);

      audio.play().catch(() => {
        if (audioRef.current === audio) {
          setError(`Could not play "${station.name}" — stream may be offline`);
          setPlayingId(null);
          setPaused(true);
        }
      });

      audioRef.current = audio;
      setPlayingId(station.stationuuid);
      setPlayingName(station.name);
      playingStationRef.current = station;
      setPaused(false);
      setError(null);
      window.dispatchEvent(
        new CustomEvent("putz-radio-change", {
          detail: { name: station.name, playing: true },
        }),
      );
    },
    [volume],
  );

  const togglePause = () => {
    if (!audioRef.current) return;
    if (paused) {
      audioRef.current.play().catch(console.error);
      setPaused(false);
    } else {
      audioRef.current.pause();
      setPaused(true);
    }
  };

  const stop = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }
    setPlayingId(null);
    setPlayingName("");
    playingStationRef.current = null;
    setPaused(false);
    window.dispatchEvent(
      new CustomEvent("putz-radio-change", {
        detail: { name: "", playing: false },
      }),
    );
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v / 100;
    }
  };

  const togglePower = () => {
    if (poweredOn) {
      stop();
    }
    setPoweredOn((p) => !p);
  };

  return (
    <div className={`radio ${poweredOn ? "radio--on" : "radio--off"}`}>
      {/* ─── Power Switch ─────────────────────────── */}
      <div className="radio__power-panel">
        <button
          type="button"
          className={`radio__power-switch ${poweredOn ? "radio__power-switch--on" : ""}`}
          onClick={togglePower}
          title={poweredOn ? "Power off" : "Power on"}
        >
          <span className="radio__power-knob" />
        </button>
        <span
          className={`radio__power-led ${poweredOn ? "radio__power-led--on" : ""}`}
        />
        <span className="radio__power-label">PUTZ STEREO</span>
      </div>

      {!poweredOn && (
        <div className="radio__off-screen">
          <span className="radio__off-brand">FM / AM / WEB</span>
        </div>
      )}

      {poweredOn && (
        <>
          {/* ─── Toolbar ──────────────────────────────── */}
          <div className="radio__toolbar">
            <select
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              aria-label="Country"
            >
              <option value="⭐ Favorites">
                ⭐ Favorites ({favorites.size})
              </option>
              <option value="">🌍 All Countries</option>
              {countries.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.stationcount})
                </option>
              ))}
            </select>

            <select
              value={minBitrate}
              onChange={(e) => setMinBitrate(Number(e.target.value))}
              aria-label="Quality"
            >
              <option value={0}>Any quality</option>
              <option value={64}>≥ 64 kbps</option>
              <option value={128}>≥ 128 kbps (Good)</option>
              <option value={192}>≥ 192 kbps (High)</option>
              <option value={256}>≥ 256 kbps (Very High)</option>
              <option value={320}>≥ 320 kbps (Best)</option>
            </select>

            <input
              type="text"
              placeholder="Search stations…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={handleKeyDown}
              aria-label="Search"
            />

            <button type="button" onClick={handleSearch}>
              Search
            </button>

            <button
              type="button"
              className="radio__toolbar-add"
              onClick={() => setShowAddForm((v) => !v)}
              title="Add custom station"
            >
              ➕
            </button>
          </div>

          {/* ─── Add Custom Station Form ─────────────── */}
          {showAddForm && (
            <div className="radio__add-form">
              <input
                type="text"
                placeholder="Station name"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                aria-label="Station name"
              />
              <input
                type="text"
                placeholder="Stream URL (e.g. https://…/stream)"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addCustomStation();
                }}
                aria-label="Stream URL"
              />
              <button
                type="button"
                onClick={addCustomStation}
                disabled={!addName.trim() || !addUrl.trim()}
              >
                Add to Favorites
              </button>
              <button
                type="button"
                className="radio__add-form-cancel"
                onClick={() => setShowAddForm(false)}
              >
                ✕
              </button>
            </div>
          )}

          {/* ─── Error ────────────────────────────────── */}
          {error && (
            <div className="radio__error">
              <span>{error}</span>
              <button
                className="radio__error-close"
                onClick={() => setError(null)}
                title="Dismiss"
              >
                ✕
              </button>
            </div>
          )}

          {/* ─── Station list ─────────────────────────── */}
          {loading ? (
            <div className="radio__loading">Loading stations…</div>
          ) : stations.length === 0 ? (
            <div className="radio__empty">No stations found</div>
          ) : (
            (() => {
              const filtered =
                minBitrate > 0
                  ? stations.filter((s) => s.bitrate >= minBitrate)
                  : stations;
              return filtered.length === 0 ? (
                <div className="radio__empty">
                  No stations at this quality level
                </div>
              ) : (
                <div
                  className={`radio__list ${isFavView ? "radio__list--reorderable" : ""}`}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    if (
                      el.scrollTop + el.clientHeight >=
                      el.scrollHeight - 100
                    ) {
                      loadMore();
                    }
                  }}
                  onPointerMove={isFavView ? handleListPointerMove : undefined}
                  onPointerUp={isFavView ? handleListPointerUp : undefined}
                  onPointerLeave={isFavView ? handleListPointerUp : undefined}
                >
                  {filtered.map((station, idx) => (
                    <React.Fragment key={station.stationuuid}>
                      {isFavView &&
                        dropIdx === idx &&
                        dragSrcIdx.current > idx && (
                          <div className="radio__drop-indicator" />
                        )}
                      <StationCard
                        station={station}
                        isPlaying={playingId === station.stationuuid}
                        isFavorite={favorites.has(station.stationuuid)}
                        dataIdx={isFavView ? idx : undefined}
                        onPlay={play}
                        onToggleFavorite={toggleFavorite}
                        onPointerDown={
                          isFavView ? handlePointerDown(idx) : undefined
                        }
                      />
                      {isFavView &&
                        dropIdx === idx &&
                        dragSrcIdx.current < idx && (
                          <div className="radio__drop-indicator" />
                        )}
                    </React.Fragment>
                  ))}
                  {hasMore && (
                    <button
                      className="radio__load-more"
                      onClick={loadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore
                        ? "Loading…"
                        : `Load more (${stations.length} loaded)`}
                    </button>
                  )}
                </div>
              );
            })()
          )}

          {/* ─── Player bar ───────────────────────────── */}
          {playingName && (
            <div className="radio__player">
              <span className="radio__player-icon">📻</span>
              <span className="radio__player-name">{playingName}</span>
              {playingStationRef.current && (
                <button
                  type="button"
                  className={`radio__card-fav ${favorites.has(playingStationRef.current.stationuuid) ? "radio__card-fav--active" : ""}`}
                  onClick={() => {
                    if (playingStationRef.current)
                      toggleFavorite(playingStationRef.current);
                  }}
                  title={
                    favorites.has(playingStationRef.current.stationuuid)
                      ? "Remove from favorites"
                      : "Add to favorites"
                  }
                >
                  {favorites.has(playingStationRef.current.stationuuid)
                    ? "★"
                    : "☆"}
                </button>
              )}

              <button
                type="button"
                className="radio__player-btn"
                onClick={togglePause}
                title={paused ? "Resume" : "Pause"}
              >
                {paused ? "▶" : "⏸"}
              </button>

              <button
                type="button"
                className="radio__player-btn"
                onClick={stop}
                title="Stop"
              >
                ⏹
              </button>

              <div className="radio__player-volume">
                <span>🔊</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={volume}
                  onChange={handleVolumeChange}
                  aria-label="Volume"
                />
              </div>
              {playingStationRef.current &&
                playingStationRef.current.bitrate > 0 && (
                  <span className="radio__player-bitrate">
                    {playingStationRef.current.bitrate}kbps
                  </span>
                )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Station Card (sub-component) ────────────────────── */

interface StationCardProps {
  station: RadioStation;
  isPlaying: boolean;
  isFavorite: boolean;
  dataIdx?: number;
  onPlay: (station: RadioStation) => void;
  onToggleFavorite: (station: RadioStation) => void;
  onPointerDown?: (e: React.PointerEvent) => void;
}

function StationCard({
  station,
  isPlaying,
  isFavorite,
  dataIdx,
  onPlay,
  onToggleFavorite,
  onPointerDown,
}: StationCardProps) {
  const [imgError, setImgError] = useState(false);

  const codec = station.codec || "";
  const bitrate = station.bitrate ? `${station.bitrate}kbps` : "";
  const meta = [codec, bitrate].filter(Boolean).join(" ");

  return (
    <div
      className={`radio__card ${isPlaying ? "radio__card--playing" : ""}`}
      onClick={() => onPlay(station)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onPlay(station);
      }}
      onPointerDown={onPointerDown}
      data-idx={dataIdx}
    >
      <div className="radio__card-header">
        {station.favicon && !imgError ? (
          <img
            className="radio__card-favicon"
            src={station.favicon}
            alt=""
            onError={() => setImgError(true)}
            loading="lazy"
          />
        ) : (
          <span className="radio__card-favicon-fallback">📻</span>
        )}
        <span className="radio__card-name" title={station.name}>
          {station.name}
        </span>
        <button
          type="button"
          className={`radio__card-fav ${isFavorite ? "radio__card-fav--active" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite(station);
          }}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
        >
          {isFavorite ? "★" : "☆"}
        </button>
      </div>
      {station.tags && (
        <span className="radio__card-tags" title={station.tags}>
          {station.tags}
        </span>
      )}
      <div className="radio__card-meta">
        <span>{meta}</span>
        <button
          type="button"
          className="radio__card-play"
          onClick={(e) => {
            e.stopPropagation();
            onPlay(station);
          }}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>
      </div>
    </div>
  );
}
