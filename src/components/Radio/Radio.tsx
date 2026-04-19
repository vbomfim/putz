/**
 * Radio — Internet radio station browser & player.
 *
 * Uses the free radio-browser.info API to list, filter, and play
 * internet radio stations via HTML5 Audio API.
 *
 * @module Radio
 */
import { useState, useEffect, useRef, useCallback } from "react";
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

const COUNTRY_OPTIONS: { label: string; value: string }[] = [
  { label: "Brazil", value: "Brazil" },
  { label: "Argentina", value: "Argentina" },
  { label: "Portugal", value: "Portugal" },
  { label: "USA", value: "The United States Of America" },
  { label: "UK", value: "The United Kingdom Of Great Britain And Northern Ireland" },
  { label: "Germany", value: "Germany" },
  { label: "Japan", value: "Japan" },
  { label: "All", value: "" },
];

/** Fetch stations from radio-browser.info, filtering only working streams. */
async function fetchStations(
  country: string,
  search: string,
): Promise<RadioStation[]> {
  let url: string;
  if (search) {
    const params = new URLSearchParams({ name: search, limit: "50", order: "clickcount", reverse: "true" });
    if (country) params.set("country", country);
    url = `${API_BASE}/stations/search?${params}`;
  } else if (country) {
    url = `${API_BASE}/stations/bycountry/${encodeURIComponent(country)}?limit=50&order=clickcount&reverse=true`;
  } else {
    url = `${API_BASE}/stations/search?limit=50&order=clickcount&reverse=true`;
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data: RadioStation[] = await res.json();
  return data.filter((s) => s.lastcheckok === 1);
}

export function Radio() {
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [country, setCountry] = useState("Brazil");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [playingName, setPlayingName] = useState("");
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(80);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const loadStations = useCallback(
    async (c: string, q: string) => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchStations(c, q);
        setStations(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load stations");
        setStations([]);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

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
      window.dispatchEvent(new CustomEvent("putz-radio-change", { detail: { name: "", playing: false } }));
    };
  }, []);

  const handleSearch = () => {
    loadStations(country, search);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSearch();
  };

  const play = useCallback(
    (station: RadioStation) => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      const audio = new Audio(station.url_resolved || station.url);
      audio.volume = volume / 100;

      audio.addEventListener("error", () => {
        setError(`Could not play "${station.name}" — stream may be offline`);
        setPlayingId(null);
        setPlayingName("");
      });

      audio.play().catch(() => {
        setError(`Could not play "${station.name}" — stream may be offline`);
        setPlayingId(null);
        setPlayingName("");
      });

      audioRef.current = audio;
      setPlayingId(station.stationuuid);
      setPlayingName(station.name);
      setPaused(false);
      setError(null);
      window.dispatchEvent(new CustomEvent("putz-radio-change", { detail: { name: station.name, playing: true } }));
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
    setPaused(false);
    window.dispatchEvent(new CustomEvent("putz-radio-change", { detail: { name: "", playing: false } }));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setVolume(v);
    if (audioRef.current) {
      audioRef.current.volume = v / 100;
    }
  };

  return (
    <div className="radio">
      {/* ─── Toolbar ──────────────────────────────── */}
      <div className="radio__toolbar">
        <select
          value={country}
          onChange={(e) => setCountry(e.target.value)}
          aria-label="Country"
        >
          {COUNTRY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
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
      </div>

      {/* ─── Error ────────────────────────────────── */}
      {error && (
        <div className="radio__error">
          <span>{error}</span>
          <button className="radio__error-close" onClick={() => setError(null)} title="Dismiss">✕</button>
        </div>
      )}

      {/* ─── Station list ─────────────────────────── */}
      {loading ? (
        <div className="radio__loading">Loading stations…</div>
      ) : stations.length === 0 ? (
        <div className="radio__empty">No stations found</div>
      ) : (
        <div className="radio__list">
          {stations.map((station) => (
            <StationCard
              key={station.stationuuid}
              station={station}
              isPlaying={playingId === station.stationuuid}
              onPlay={play}
            />
          ))}
        </div>
      )}

      {/* ─── Player bar ───────────────────────────── */}
      {playingId && (
        <div className="radio__player">
          <span className="radio__player-icon">📻</span>
          <span className="radio__player-name">{playingName}</span>

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
        </div>
      )}
    </div>
  );
}

/* ─── Station Card (sub-component) ────────────────────── */

interface StationCardProps {
  station: RadioStation;
  isPlaying: boolean;
  onPlay: (station: RadioStation) => void;
}

function StationCard({ station, isPlaying, onPlay }: StationCardProps) {
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
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPlay(station); }}
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
