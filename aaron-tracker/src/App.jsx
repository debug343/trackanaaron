import { useState, useEffect } from "react";

// ── Web Push helpers ──────────────────────────────────────────────────────────
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;
}
function urlBase64ToUint8Array(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

const ATHLETE_NAME = "Aaron Rabinowitz";
const RACE_NAME = "6633 Northern Lights Ultra";
const TOTAL_MILES = 170.8;
const DONATE_URL = "https://africanmissionhealthcare.org/donation/ssmr/?utm_source=ig&utm_medium=social&utm_content=link_in_bio";
const RACE_INFO_URL = "https://www.6633ultra.com/pages/northern-lights-ultra-race-details";
const MAP_URL = "https://trackleaders.com/6633ultra26f.php";

const CHECKPOINTS = [
  { name: "Start – Eagle Plains", mile: 0, day: "Day 1 · Mar 17" },
  { name: "Fort McPherson", mile: 30, day: "Day 2 · Mar 18" },
  { name: "Peel River / Camp 2", mile: 64, day: "Day 3 · Mar 19" },
  { name: "Aklavik / Camp 3", mile: 92, day: "Day 4 · Mar 20" },
  { name: "Camp 4 – Longest Stage End", mile: 154, day: "Day 5 · Mar 21" },
  { name: "Finish – Inuvik", mile: 170.8, day: "Day 5 · Mar 21" },
];

const STORAGE_KEY = "aaron_tracker_snapshots";

function getCheckpoint(mile) {
  if (mile === null || mile === undefined || isNaN(mile)) return "Off Route / Pre-Start";
  let reached = CHECKPOINTS[0];
  for (const cp of CHECKPOINTS) {
    if (mile >= cp.mile) reached = cp;
    else break;
  }
  const next = CHECKPOINTS[CHECKPOINTS.indexOf(reached) + 1];
  if (!next) return `✅ ${reached.name}`;
  return `${reached.name} → ${next.name} (${(next.mile - mile).toFixed(1)} mi to next)`;
}

function parseAthleteData(html) {
  const data = {
    status: null, lastUpdate: null, currentSpeed: null, avgSpeed: null,
    routeMile: null, elevationGain: null, currentElevation: null,
    movingTime: null, stoppedTime: null, movingAvgSpeed: null,
  };
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const key = match[1].replace(/<[^>]+>/g, "").trim();
    const val = match[2].replace(/<[^>]+>/g, "").trim();
    if (key === "Race Status") data.status = val;
    else if (key === "Last Update Rec'd") data.lastUpdate = val;
    else if (key === "Current speed") data.currentSpeed = val;
    else if (key === "Average speed") data.avgSpeed = val;
    else if (key === "Route mile") data.routeMile = val;
    else if (key === "Elevation Gain") data.elevationGain = val;
    else if (key === "Current Elevation") data.currentElevation = val;
    else if (key === "Moving Time") data.movingTime = val;
    else if (key === "Stopped Time") data.stoppedTime = val;
    else if (key === "Moving Average Speed") data.movingAvgSpeed = val;
  }
  return data;
}

function parseMile(routeMile) {
  if (!routeMile || routeMile === "Off Route") return null;
  const m = parseFloat(routeMile);
  return isNaN(m) ? null : m;
}

// Returns "YYYY-MM-DD" in Inuvik local time (MDT = UTC-6)
function getInuvikDateStr(isoStr) {
  const d = new Date(new Date(isoStr).getTime() - 6 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function progressPct(mile) {
  if (mile === null) return 0;
  return Math.min(100, (mile / TOTAL_MILES) * 100).toFixed(1);
}

const ROUTE_WAYPOINTS = [
  [0,    66.534, -136.706],
  [30,   67.437, -134.884],
  [64,   67.700, -134.500],
  [92,   68.222, -135.012],
  [154,  68.480, -135.800],
  [170.8,68.360, -133.723],
];

function getRouteCoords(mile) {
  const m = parseFloat(mile);
  if (isNaN(m)) return [66.534, -136.706];
  for (let i = 0; i < ROUTE_WAYPOINTS.length - 1; i++) {
    const [m0, lat0, lng0] = ROUTE_WAYPOINTS[i];
    const [m1, lat1, lng1] = ROUTE_WAYPOINTS[i + 1];
    if (m >= m0 && m <= m1) {
      const t = (m - m0) / (m1 - m0);
      return [lat0 + t * (lat1 - lat0), lng0 + t * (lng1 - lng0)];
    }
  }
  return [68.360, -133.723];
}

function describeWeather(code) {
  if (code === 0) return { icon: "☀️", desc: "Clear" };
  if (code <= 3)  return { icon: "⛅", desc: "Partly Cloudy" };
  if (code <= 48) return { icon: "🌫️", desc: "Fog" };
  if (code <= 55) return { icon: "🌦️", desc: "Drizzle" };
  if (code <= 65) return { icon: "🌧️", desc: "Rain" };
  if (code <= 77) return { icon: "❄️", desc: "Snow" };
  if (code <= 82) return { icon: "🌧️", desc: "Rain Showers" };
  if (code <= 86) return { icon: "🌨️", desc: "Snow Showers" };
  return { icon: "⛈️", desc: "Storm" };
}

// Elevation in feet, digitised from trackleaders 6633ultra26f profile
const ELEV_POINTS = [
  [0,70],[2,35],[4,22],[6,20],[10,21],[15,22],[20,24],[25,27],[30,35],
  [33,35],[36,33],[38,28],[40,20],[42,24],[44,28],[46,14],[48,26],
  [50,12],[52,24],[54,10],[56,22],[58,8],[60,15],[62,8],[64,6],
  [70,7],[80,5],[90,7],[92,7],[95,10],[99,13],[100,5],[101,50],
  [110,50],[120,50],[128,50],[130,50],[131,10],[133,8],[135,40],
  [140,40],[145,38],[148,35],[150,25],[152,65],[153.5,55],[155,68],
  [157,28],[162,22],[166,20],[170.8,20],
];

const STAGES = [
  { n: 1, start: 0,   end: 30,    label: "Eagle Plains → Ft McPherson" },
  { n: 2, start: 30,  end: 64,    label: "Ft McPherson → Peel River" },
  { n: 3, start: 64,  end: 92,    label: "Peel River → Aklavik" },
  { n: 4, start: 92,  end: 154,   label: "Aklavik → Camp 4" },
  { n: 5, start: 154, end: 170.8, label: "Camp 4 → Inuvik" },
];

const ELEV_CHECKPOINTS = [
  { name: "Eagle Plains", mile: 0 },
  { name: "Ft McPherson", mile: 30 },
  { name: "Peel River", mile: 64 },
  { name: "Aklavik", mile: 92 },
  { name: "Camp 4", mile: 154 },
  { name: "Inuvik", mile: 170.8 },
];

function interpolateElev(mile) {
  for (let i = 0; i < ELEV_POINTS.length - 1; i++) {
    const [m0, e0] = ELEV_POINTS[i], [m1, e1] = ELEV_POINTS[i + 1];
    if (mile >= m0 && mile <= m1) return e0 + ((mile - m0) / (m1 - m0)) * (e1 - e0);
  }
  return null;
}

function ElevationProfile({ currentMile, dailyStats = [] }) {
  const W = 860, H = 210, padL = 34, padR = 10, padT = 46, padB = 48;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const maxElev = 85;
  const toX = (m) => padL + (m / 170.8) * plotW;
  const toY = (e) => padT + plotH - (e / maxElev) * plotH;
  const base = padT + plotH;

  const linePts = ELEV_POINTS.map(([m, e]) => `${toX(m).toFixed(1)},${toY(e).toFixed(1)}`).join(" ");
  const areaD = `M ${toX(0)},${base} ` +
    ELEV_POINTS.map(([m, e]) => `L ${toX(m).toFixed(1)},${toY(e).toFixed(1)}`).join(" ") +
    ` L ${toX(170.8)},${base} Z`;

  const curElev = currentMile !== null ? interpolateElev(currentMile) : null;
  const stageBg = ["rgba(26,95,200,0.07)", "rgba(0,200,150,0.06)", "rgba(100,50,200,0.06)", "rgba(26,95,200,0.07)", "rgba(0,200,150,0.06)"];
  const DAY_COLORS = ["#f0a040", "#c060f0", "#40d0a0", "#f06080", "#80d040", "#60b0f0"];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", display: "block" }}>
      <defs>
        <linearGradient id="eg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4a9eff" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#4a9eff" stopOpacity="0.05" />
        </linearGradient>
      </defs>

      {/* Stage background bands */}
      {STAGES.map((s, i) => {
        const x1 = toX(s.start), x2 = toX(s.end);
        const midX = (x1 + x2) / 2;
        const dist = (s.end - s.start).toFixed(1).replace(".0", "");
        return (
          <g key={s.n}>
            <rect x={x1} y={padT} width={x2 - x1} height={plotH} fill={stageBg[i]} />
            <text x={midX} y={14} textAnchor="middle" fill="#4a9eff" fontSize="10" fontFamily="Georgia,serif" fontWeight="bold">Stage {s.n}</text>
            <text x={midX} y={26} textAnchor="middle" fill="#2a4a6a" fontSize="9" fontFamily="Georgia,serif">{dist} mi</text>
          </g>
        );
      })}

      {/* Elevation grid lines */}
      {[20, 40, 60, 80].map(ft => (
        <g key={ft}>
          <line x1={padL} y1={toY(ft)} x2={padL + plotW} y2={toY(ft)} stroke="#1e2a4e" strokeWidth="0.5" />
          <text x={padL - 4} y={toY(ft) + 3} textAnchor="end" fill="#2a4a6a" fontSize="8.5" fontFamily="Georgia,serif">{ft}ft</text>
        </g>
      ))}

      {/* Elevation fill + line */}
      <path d={areaD} fill="url(#eg)" />
      <polyline points={linePts} fill="none" stroke="#4a9eff" strokeWidth="1.8" strokeLinejoin="round" />

      {/* Checkpoint dividers + labels */}
      {ELEV_CHECKPOINTS.map(({ name, mile }, idx) => {
        const x = toX(mile);
        const elev = interpolateElev(mile) ?? 0;
        const y = toY(elev);
        return (
          <g key={mile}>
            <line x1={x} y1={padT} x2={x} y2={base} stroke="#2a4a8a" strokeWidth={idx === 0 || idx === ELEV_CHECKPOINTS.length - 1 ? 1 : 0.8} strokeDasharray={idx === 0 || idx === ELEV_CHECKPOINTS.length - 1 ? "none" : "3 3"} />
            <circle cx={x} cy={y} r="3.5" fill="#4a9eff" stroke="#0a0e1a" strokeWidth="1" />
            <text x={x} y={base + 14} textAnchor="middle" fill="#4a7aaa" fontSize="9" fontFamily="Georgia,serif">{name}</text>
            <text x={x} y={base + 24} textAnchor="middle" fill="#2a4a6a" fontSize="8" fontFamily="Georgia,serif">{mile === 170.8 ? "170.8" : mile} mi</text>
          </g>
        );
      })}

      {/* Day end markers */}
      {dailyStats.map((ds, i) => {
        const x = toX(ds.endMile);
        const y = toY(interpolateElev(ds.endMile) ?? 0);
        const r = 5;
        const color = DAY_COLORS[i % DAY_COLORS.length];
        return (
          <g key={ds.dateStr}>
            <polygon points={`${x},${y-r} ${x+r},${y} ${x},${y+r} ${x-r},${y}`} fill={color} stroke="#0a0e1a" strokeWidth="1" opacity="0.9" />
            <text x={x} y={y-r-4} textAnchor="middle" fill={color} fontSize="8" fontFamily="Georgia,serif" fontWeight="bold">D{ds.dayNum}</text>
          </g>
        );
      })}

      {/* Aaron's position */}
      {curElev !== null && (
        <g>
          <line x1={toX(currentMile)} y1={padT} x2={toX(currentMile)} y2={base} stroke="#00c896" strokeWidth="1" strokeDasharray="2 2" strokeOpacity="0.5" />
          <text x={toX(currentMile)} y={toY(curElev) + 4} textAnchor="middle" fill="#00c896" fontSize="14" fontFamily="sans-serif">▲</text>
          <text x={toX(currentMile)} y={toY(curElev) - 7} textAnchor="middle" fill="#00c896" fontSize="9" fontFamily="Georgia,serif">Aaron · {parseFloat(currentMile).toFixed(1)}mi</text>
        </g>
      )}
    </svg>
  );
}

const card = { background: "#111827", borderRadius: "10px", padding: "20px", border: "1px solid #1e3a6e" };
const sectionTitle = { fontSize: "11px", letterSpacing: "3px", color: "#4a9eff", textTransform: "uppercase", marginBottom: "14px", textAlign: "center" };
const statLabel = { fontSize: "10px", color: "#4a6a8a", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" };
// fontSize 16px is required to prevent iOS Safari auto-zoom on input focus
const inputStyle = { background: "#111827", border: "1px solid #1e3a6e", borderRadius: "6px", color: "#e8eaf6", padding: "10px 14px", fontSize: "16px", fontFamily: "inherit" };

// ── Race progress helpers ────────────────────────────────────────────────────

// Returns where an athlete is relative to checkpoints
function getAthleteContext(routeMile) {
  const m = parseFloat(routeMile);
  if (isNaN(m)) return { atCamp: false, label: "off route", stage: 1 };
  // Within 1.5 mi of a checkpoint = "at camp"
  for (const cp of CHECKPOINTS) {
    if (Math.abs(m - cp.mile) <= 1.5) {
      const name = cp.name.replace("Start – ", "").split(" /")[0].split(" –")[0].trim();
      return { atCamp: true, label: name, stage: CHECKPOINTS.indexOf(cp) };
    }
  }
  // Find current stage
  for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
    if (m >= CHECKPOINTS[i].mile && m < CHECKPOINTS[i + 1].mile) {
      return { atCamp: false, label: `Stage ${i + 1}`, stage: i + 1 };
    }
  }
  return { atCamp: false, label: "Stage 5", stage: 5 };
}

// Night-aware weather icon
function getWeatherIcon(weatherIcon, isNight) {
  if (!isNight) return weatherIcon;
  if (weatherIcon === "☀️") return "🌙";
  if (weatherIcon === "⛅") return "🌑";
  return weatherIcon; // fog, snow, rain, storm look the same at night
}

function parseSpeedMph(speedStr) {
  if (!speedStr) return null;
  const m = parseFloat(speedStr);
  if (isNaN(m) || m <= 0) return null;
  return speedStr.toLowerCase().includes("km") ? m * 0.621371 : m;
}

function getNextCampInfo(mile, movingAvgSpeed) {
  if (mile === null) return null;
  let next = null;
  for (const cp of CHECKPOINTS) {
    if (cp.mile > mile) { next = cp; break; }
  }
  if (!next) return null;
  const remaining = next.mile - mile;
  const speed = parseSpeedMph(movingAvgSpeed);
  const eta = (speed && speed > 0.1)
    ? new Date(Date.now() + (remaining / speed) * 3600000)
    : null;
  return { name: next.name, remaining: remaining.toFixed(1), eta };
}

function formatTimeUntil(date) {
  if (!date) return null;
  const mins = Math.round((date - new Date()) / 60000);
  if (mins <= 0) return null;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatCountdown(secs) {
  if (secs === null || secs === undefined) return "";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function AaronTracker() {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [saveLabel, setSaveLabel] = useState("");

  const [journalEntries, setJournalEntries] = useState([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPwd, setAdminPwd] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newText, setNewText] = useState("");
  const [newEmbed, setNewEmbed] = useState("");
  const [postingEntry, setPostingEntry] = useState(false);
  const [entryError, setEntryError] = useState("");
  const [sendingUpdate, setSendingUpdate] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const [testEmail, setTestEmail] = useState("");
  const [weather, setWeather] = useState(null);
  const [leaderboard, setLeaderboard] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editText, setEditText] = useState("");
  const [editEmbed, setEditEmbed] = useState("");

  const [subEmail, setSubEmail] = useState("");
  const [subStatus, setSubStatus] = useState("");
  const [subLoading, setSubLoading] = useState(false);

  const [shareCopied, setShareCopied] = useState(false);
  const [nextRefreshIn, setNextRefreshIn] = useState(null); // seconds until next auto-refresh

  const [notifState, setNotifState] = useState("loading"); // loading|unsupported|ios-not-installed|denied|prompt|granted
  const [vapidPublicKey, setVapidPublicKey] = useState(null);
  const [pushSubscription, setPushSubscription] = useState(null);

  const [comments, setComments] = useState([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentName, setCommentName] = useState("");
  const [commentText, setCommentText] = useState("");
  const [commentVerify, setCommentVerify] = useState("");
  const [commentFormLoadedAt] = useState(() => Date.now());
  const [commentWebsite, setCommentWebsite] = useState("");
  const [commentStatus, setCommentStatus] = useState("");
  const [trackHistory, setTrackHistory] = useState([]);
  const [followerCount, setFollowerCount] = useState(null);
  const [restMode, setRestMode] = useState(false);
  const [restNote, setRestNote] = useState("");
  const [restSince, setRestSince] = useState(null);
  const [restModeLoading, setRestModeLoading] = useState(false);
  const [restNoteInput, setRestNoteInput] = useState("");
  const restModeRef = React.useRef(false);
  const [raceUpdate, setRaceUpdate] = useState("");
  const [raceUpdateAt, setRaceUpdateAt] = useState(null);
  const [raceUpdateInput, setRaceUpdateInput] = useState("");
  const [raceUpdateLoading, setRaceUpdateLoading] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSnapshots(JSON.parse(saved));
    } catch {}
    fetchJournal();
    fetchLiveData();
    fetchComments();
    fetch("/api/track-history").then(r => r.json()).then(d => setTrackHistory(d.points || [])).catch(() => {});
    fetch("/api/stats").then(r => r.json()).then(d => {
      setFollowerCount(d.total || 0);
      setRestMode(d.restMode || false);
      restModeRef.current = d.restMode || false;
      setRestNote(d.restNote || "");
      setRestSince(d.restSince || null);
      setRaceUpdate(d.raceUpdate || "");
      setRaceUpdateAt(d.raceUpdateAt || null);
    }).catch(() => {});

    // Web Push init
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return setNotifState("unsupported");
      }
      if (isIOS() && !isStandalone()) {
        return setNotifState("ios-not-installed");
      }
      if (Notification.permission === "denied") {
        return setNotifState("denied");
      }
      try {
        const keyRes = await fetch("/api/vapid-public-key");
        const { key } = await keyRes.json();
        if (!key) return setNotifState("unsupported");
        setVapidPublicKey(key);
        const reg = await navigator.serviceWorker.register("/sw.js");
        await navigator.serviceWorker.ready;
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          setPushSubscription(existing);
          setNotifState("granted");
        } else {
          setNotifState("prompt");
        }
      } catch {
        setNotifState("unsupported");
      }
    })();

    // Auto-refresh live data every 11 minutes (skipped when rest mode is active)
    const REFRESH_MS = 11 * 60 * 1000;
    setNextRefreshIn(REFRESH_MS / 1000);
    const refreshInterval = setInterval(() => {
      if (!restModeRef.current) {
        fetchLiveData();
        setNextRefreshIn(REFRESH_MS / 1000);
      }
    }, REFRESH_MS);
    const countdownInterval = setInterval(() => {
      setNextRefreshIn((prev) => (prev !== null ? Math.max(0, prev - 1) : null));
    }, 1000);

    return () => {
      clearInterval(refreshInterval);
      clearInterval(countdownInterval);
    };
  }, []);

  async function fetchLiveData() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/trackleaders?name=Aaron_Rabinowitz");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const html = await res.text();
      const parsed = parseAthleteData(html);
      if (!Object.values(parsed).some((v) => v !== null))
        throw new Error("Page loaded but no stats found. The race may not have started yet.");
      setLiveData(parsed);
      setLastFetched(new Date().toLocaleString());
      // Fetch weather + sunset time for Aaron's current location
      try {
        const [lat, lng] = getRouteCoords(parsed.routeMile);
        const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}&current=temperature_2m,weather_code,wind_speed_10m&daily=sunrise,sunset&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto`);
        const wJson = await wRes.json();
        const c = wJson.current;
        const { icon, desc } = describeWeather(c.weather_code);
        const sunsetStr = wJson.daily?.sunset?.[0] ?? null;
        const sunriseStr = wJson.daily?.sunrise?.[0] ?? null;
        // Open-Meteo returns local-time strings (no TZ offset). Attach the UTC offset
        // from the response so Date parses it as the correct UTC moment, not browser local.
        const utcOffsetSec = wJson.utc_offset_seconds ?? 0;
        const timezone = wJson.timezone ?? "America/Inuvik";
        const toDate = (str) => {
          if (!str) return null;
          const sign = utcOffsetSec >= 0 ? "+" : "-";
          const abs = Math.abs(utcOffsetSec);
          const oh = String(Math.floor(abs / 3600)).padStart(2, "0");
          const om = String(Math.floor((abs % 3600) / 60)).padStart(2, "0");
          return new Date(`${str}:00${sign}${oh}:${om}`);
        };
        const sunsetAt = toDate(sunsetStr);
        const sunriseAt = toDate(sunriseStr);
        const weatherCode = c.weather_code;
        setWeather({ tempF: Math.round(c.temperature_2m), tempC: Math.round((c.temperature_2m - 32) * 5 / 9), windMph: Math.round(c.wind_speed_10m), icon, desc, sunsetAt, sunriseAt, timezone, weatherCode });
      } catch {}
      // Fetch leaderboard
      try {
        const lRes = await fetch("/api/leaderboard");
        const lJson = await lRes.json();
        setLeaderboard(lJson);
      } catch {}
    } catch (e) {
      setError(e.message || "Could not fetch live data.");
    }
    setLoading(false);
  }

  async function toggleRestMode(enable) {
    setRestModeLoading(true);
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPwd, restMode: enable, restNote: restNoteInput }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setRestMode(enable);
      restModeRef.current = enable;
      setRestNote(restNoteInput);
      setRestSince(enable ? new Date().toISOString() : null);
    } catch (e) {
      alert("Rest mode error: " + e.message);
    }
    setRestModeLoading(false);
  }

  async function saveRaceUpdate() {
    setRaceUpdateLoading(true);
    try {
      const res = await fetch("/api/stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: adminPwd, raceUpdate: raceUpdateInput.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed");
      setRaceUpdate(raceUpdateInput.trim());
      setRaceUpdateAt(raceUpdateInput.trim() ? new Date().toISOString() : null);
    } catch (e) {
      alert("Error saving update: " + e.message);
    }
    setRaceUpdateLoading(false);
  }

  async function generateNarrative() {
    if (!liveData) return;
    setNarrativeLoading(true);
    const mile = parseMile(liveData.routeMile);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system: `You are an enthusiastic ultra-endurance race commentator covering the 6633 Northern Lights Ultra — a brutal 170.8-mile self-supported foot race through Canada's Arctic, one of the world's toughest races. Write vivid, emotionally engaging updates. Be specific, concise (3-4 sentences), and inspirational. Reference the conditions (Arctic cold, remote terrain) when relevant.`,
          messages: [{
            role: "user",
            content: `Write a progress narrative for Aaron Rabinowitz based on this data:\n- Race status: ${liveData.status}\n- Route mile: ${liveData.routeMile} of 170.8 (${progressPct(mile)}% complete)\n- Checkpoint: ${getCheckpoint(mile)}\n- Current speed: ${liveData.currentSpeed}\n- Moving time: ${liveData.movingTime}\n- Stopped time: ${liveData.stoppedTime}\n- Elevation gain: ${liveData.elevationGain}\n- Moving avg speed: ${liveData.movingAvgSpeed}${(() => { const ds = dailyStats[getInuvikDateStr(new Date().toISOString())]; return ds ? `\n- Today so far: ${ds.milesCovered} miles (mi ${ds.startMile.toFixed(1)} → ${ds.endMile.toFixed(1)}), avg speed ${ds.avgSpeed || "unknown"} mph` : ""; })()}`,
          }],
        }),
      });
      const json = await res.json();
      const text = json.content?.filter((b) => b.type === "text").map((b) => b.text).join("") || "";
      setNewText(text || "Could not generate narrative.");
    } catch {
      setNewText("Could not generate narrative.");
    }
    setNarrativeLoading(false);
  }

  function saveSnapshot() {
    if (!liveData) return;
    const label = saveLabel.trim() || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const updated = [{ label, data: liveData, savedAt: new Date().toISOString() }, ...snapshots].slice(0, 10);
    setSnapshots(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
    setSaveLabel("");
  }

  function deleteSnapshot(i) {
    const updated = snapshots.filter((_, idx) => idx !== i);
    setSnapshots(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
  }

  async function fetchJournal() {
    setJournalLoading(true);
    try {
      const res = await fetch("/api/journal");
      const data = await res.json();
      setJournalEntries(data.entries || []);
    } catch {}
    setJournalLoading(false);
  }

  async function postJournalEntry() {
    if (!newText.trim()) return;
    setPostingEntry(true);
    setEntryError("");
    try {
      const res = await fetch("/api/journal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle.trim(), text: newText.trim(), embed: newEmbed.trim(), password: adminPwd, raceData: liveData || null }),
      });
      if (res.status === 401) { setEntryError("Wrong password."); setIsAdmin(false); }
      else if (!res.ok) { setEntryError("Failed to post."); }
      else { setNewTitle(""); setNewText(""); setNewEmbed(""); fetchJournal(); }
    } catch { setEntryError("Network error."); }
    setPostingEntry(false);
  }

  async function saveEditEntry(id) {
    if (!editText.trim()) return;
    try {
      await fetch("/api/journal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, title: editTitle, text: editText, embed: editEmbed, password: adminPwd }),
      });
      setEditingId(null);
      fetchJournal();
    } catch {}
  }

  async function deleteJournalEntry(id) {
    try {
      await fetch("/api/journal", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, password: adminPwd }),
      });
      fetchJournal();
    } catch {}
  }

  async function sendUpdateNow(test = false) {
    setSendingUpdate(true);
    setSendStatus("");
    try {
      const body = { type: "evening", password: adminPwd };
      if (test) body.testEmail = testEmail.trim();
      const res = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      setSendStatus(res.ok ? (test ? `Test sent to ${data.to}` : `Sent to ${data.sent} subscriber${data.sent !== 1 ? "s" : ""}`) : data.error || "Failed");
    } catch { setSendStatus("Network error"); }
    setSendingUpdate(false);
  }

  async function handleEnableNotifications() {
    if (!vapidPublicKey) return;
    setNotifState("loading");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") { setNotifState("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
      await fetch("/api/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(sub.toJSON()),
      });
      setPushSubscription(sub);
      setNotifState("granted");
    } catch {
      setNotifState(Notification.permission === "denied" ? "denied" : "prompt");
    }
  }

  async function handleDisableNotifications() {
    if (!pushSubscription) return;
    try {
      const endpoint = pushSubscription.endpoint;
      await pushSubscription.unsubscribe();
      await fetch("/api/push-subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      setPushSubscription(null);
      setNotifState("prompt");
    } catch {}
  }

  async function fetchComments() {
    setCommentsLoading(true);
    try {
      const res = await fetch("/api/comments");
      const data = await res.json();
      setComments(data.comments || []);
    } catch {}
    setCommentsLoading(false);
  }

  async function submitComment(e) {
    e.preventDefault();
    setCommentStatus("sending");
    try {
      const res = await fetch("/api/comments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: commentName.trim(),
          text: commentText.trim(),
          verifyWord: commentVerify.trim(),
          formLoadedAt: commentFormLoadedAt,
          website: commentWebsite,
        }),
      });
      if (res.ok) {
        setCommentStatus("sent");
        setCommentName(""); setCommentText(""); setCommentVerify("");
      } else {
        const d = await res.json();
        setCommentStatus(d.error || "Could not submit. Please try again.");
      }
    } catch { setCommentStatus("Network error."); }
  }

  async function approveComment(id) {
    await fetch("/api/comments", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: adminPwd }),
    });
    fetchComments();
    fetchAllComments();
  }

  async function deleteComment(id) {
    await fetch("/api/comments", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: adminPwd }),
    });
    fetchComments();
    fetchAllComments();
  }

  const [allComments, setAllComments] = useState([]);
  async function fetchAllComments() {
    if (!adminPwd) return;
    try {
      const res = await fetch(`/api/comments?all=1&password=${encodeURIComponent(adminPwd)}`);
      const data = await res.json();
      setAllComments(data.comments || []);
    } catch {}
  }

  async function handleShare() {
    const shareData = {
      title: `${ATHLETE_NAME} — ${RACE_NAME}`,
      text: `Aaron Rabinowitz is racing 170.8 miles through Canada's Arctic in the 6633 Northern Lights Ultra — and raising money for South Sudan Medical Relief. Follow his live progress here:`,
      url: "https://trackanaaron.vercel.app",
    };
    if (navigator.share) {
      try { await navigator.share(shareData); } catch {}
    } else {
      try {
        await navigator.clipboard.writeText("https://trackanaaron.vercel.app");
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2500);
      } catch {
        window.prompt("Copy this link:", "https://trackanaaron.vercel.app");
      }
    }
  }

  async function submitSubscribe(e) {
    e.preventDefault();
    setSubLoading(true);
    setSubStatus("");
    try {
      const res = await fetch("/api/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: subEmail }),
      });
      setSubStatus(res.ok ? "You're subscribed! You'll get morning, evening, and milestone updates." : "Error subscribing — try again.");
      if (res.ok) setSubEmail("");
    } catch { setSubStatus("Network error."); }
    setSubLoading(false);
  }

  const mile = liveData ? parseMile(liveData.routeMile) : null;
  const pct = progressPct(mile);

  // Group track history into per-day stats (Inuvik local time = UTC-6)
  const dailyStats = (() => {
    if (!trackHistory.length) return {};
    const byDay = {};
    for (const pt of trackHistory) {
      const day = getInuvikDateStr(pt.t);
      if (!byDay[day]) byDay[day] = { miles: [], speeds: [] };
      byDay[day].miles.push(pt.m);
      const s = parseFloat(pt.avg);
      if (!isNaN(s) && s > 0) byDay[day].speeds.push(s);
    }
    const RACE_START_MS = new Date("2026-03-17T12:00:00Z").getTime();
    const result = {};
    for (const [dateStr, d] of Object.entries(byDay)) {
      const dayNum = Math.round((new Date(dateStr + "T12:00:00Z") - RACE_START_MS) / 86400000) + 1;
      const avgSpd = d.speeds.length ? (d.speeds.reduce((a, b) => a + b, 0) / d.speeds.length).toFixed(1) : null;
      result[dateStr] = {
        dayNum, dateStr,
        startMile: Math.min(...d.miles),
        endMile:   Math.max(...d.miles),
        milesCovered: parseFloat((Math.max(...d.miles) - Math.min(...d.miles)).toFixed(1)),
        avgSpeed: avgSpd,
        pointCount: d.miles.length,
      };
    }
    return result;
  })();
  const dailyStatsList = Object.values(dailyStats).sort((a, b) => a.dayNum - b.dayNum);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e8eaf6", fontFamily: "'Georgia', 'Times New Roman', serif" }}>

      {/* ── HEADER ── */}
      <div style={{ background: "linear-gradient(135deg, #0d1b3e 0%, #0a0e1a 60%, #1a0a2e 100%)", borderBottom: "1px solid #1e3a6e", padding: "36px 24px 32px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse at 20% 50%, rgba(0,200,150,0.07) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(100,50,200,0.08) 0%, transparent 50%)", pointerEvents: "none" }} />
        <div style={{ position: "relative", maxWidth: "860px", margin: "0 auto" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#4a9eff", textTransform: "uppercase", marginBottom: "8px" }}>Live Race Tracker</div>
            <h1 style={{ margin: "0 0 6px", fontSize: "clamp(26px, 5vw, 42px)", fontWeight: "normal", color: "#fff" }}>{ATHLETE_NAME}</h1>
            <div style={{ color: "#7a9cc8", fontSize: "14px", marginBottom: "20px" }}>{RACE_NAME} · 170.8 mi · Arctic Canada · March 18–22, 2026</div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "14px", flexWrap: "wrap" }}>
              <button onClick={handleShare} style={{ background: "rgba(255,255,255,0.06)", border: "1px solid #1e3a6e", borderRadius: "20px", color: shareCopied ? "#00c896" : "#7a9cc8", padding: "9px 20px", fontSize: "13px", cursor: "pointer", letterSpacing: "1px", fontFamily: "inherit" }}>
                {shareCopied ? "✓ Link Copied!" : "⎘ Share Aaron's Race"}
              </button>
              {followerCount !== null && followerCount > 0 && (
                <div style={{ fontSize: "12px", color: "#4a6a8a", letterSpacing: "1px" }}>
                  👥 {followerCount} following
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "36px 20px" }}>

        {/* ── RACE UPDATE BANNER ── */}
        {raceUpdate && (
          <div style={{ marginBottom: "24px", background: "linear-gradient(135deg, #1a0e00, #2a1800)", border: "1px solid #c8780040", borderRadius: "10px", padding: "14px 18px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
            <span style={{ fontSize: "20px", flexShrink: 0, marginTop: "1px" }}>📢</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#c87800", textTransform: "uppercase", marginBottom: "4px" }}>Race Update</div>
              <div style={{ color: "#f0d090", fontSize: "14px", lineHeight: "1.6" }}>{raceUpdate}</div>
              {raceUpdateAt && <div style={{ fontSize: "11px", color: "#6a4a20", marginTop: "4px" }}>{new Date(raceUpdateAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "America/Inuvik" })} Inuvik time</div>}
            </div>
          </div>
        )}

        {/* ── ABOUT ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>What is he up to now?!</div>
          <div style={{ ...card, lineHeight: "1.9", fontSize: "15px", color: "#c8d4f0" }}>
            <p style={{ margin: "0 0 14px" }}>
              Whether you know Aaron as a friend, a brother, a son, a grandson, or an uncle — we're all here for the same reason: to follow along and cheer him on as he does something truly remarkable.
            </p>
            <p style={{ margin: "0 0 14px" }}>
              Aaron is running the <strong style={{ color: "#fff" }}>6633 Northern Lights Ultra</strong> — 170.8 miles of self-supported racing through Canada's Arctic, from Eagle Plains, Yukon to Inuvik, Northwest Territories. He's carrying an emergency beacon and a satellite phone so he can check in at each checkpoint, and we can all follow his progress right here.
            </p>
            <p style={{ margin: "0 0 20px" }}>
              He's doing this in support of <strong style={{ color: "#fff" }}>South Sudan Medical Relief (SSMR)</strong> — an incredible organization that has spent decades delivering critical medical care to communities in Old Fangak, Jonglei State, South Sudan. If you feel moved to support their work, please consider donating below.
            </p>
            {/* Photo strip */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "8px" }}>
              {["/aaron-thumbsup.jpeg", "/aaron-goodluck.jpeg", "/aaron-facetime.jpeg", "/aaron-packing.jpeg"].map((src, i) => (
                <div key={i} style={{ height: "clamp(70px, 20vw, 140px)", borderRadius: "8px", overflow: "hidden", border: "1px solid #1e3a6e", boxShadow: "0 3px 12px rgba(0,0,0,0.5)" }}>
                  <img src={src} alt="Aaron" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── ELEVATION ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Course Elevation Profile</div>
          <div style={{ ...card, padding: "16px 12px 8px" }}>
            <ElevationProfile currentMile={mile} dailyStats={dailyStatsList} />
          </div>
        </div>

        {/* ── DONATE ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Support the Cause</div>
          <div style={{ ...card, background: "linear-gradient(135deg, #0d1b3e, #120a2e)", border: "1px solid #2a1a6e" }}>
            <p style={{ margin: "0 0 6px", color: "#c8d4f0", fontSize: "15px", lineHeight: "1.8" }}>
              Your donation directly supports South Sudan Medical Relief's mission to provide vital healthcare to one of the world's most underserved communities.
            </p>
            <p style={{ margin: "0 0 20px", color: "#7a9cc8", fontSize: "13px" }}>
              💬 When donating, please mention <strong style={{ color: "#a0c4ff" }}>Aaron Rabinowitz</strong> in the donation comment box so he gets credit for inspiring your gift.
            </p>
            <div style={{ display: "flex", gap: "12px", flexWrap: "wrap", alignItems: "center" }}>
              <a href={DONATE_URL} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", background: "linear-gradient(135deg, #1a6e3a, #0d4a26)", color: "#90ffbc", textDecoration: "none", padding: "12px 28px", borderRadius: "6px", fontSize: "14px", letterSpacing: "1px" }}>
                Donate to SSMR →
              </a>
              <a href="https://www.southsudanmedicalrelief.org" target="_blank" rel="noopener noreferrer" style={{ color: "#4a7aaa", fontSize: "13px", textDecoration: "none" }}>About SSMR →</a>
              <a href={RACE_INFO_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#4a7aaa", fontSize: "13px", textDecoration: "none" }}>About the race →</a>
            </div>
          </div>
        </div>

        {/* ── CURRENT STATUS ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Aaron's Current Status</div>
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px", flexWrap: "wrap", justifyContent: "center" }}>
            <button onClick={fetchLiveData} disabled={loading} style={{ background: loading ? "#1e3a6e" : "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "12px 28px", fontSize: "15px", cursor: loading ? "not-allowed" : "pointer", letterSpacing: "1px", boxShadow: "0 2px 12px rgba(26,95,200,0.3)", minHeight: "48px" }}>
              {loading ? "⟳ Refreshing..." : "↻ Refresh"}
            </button>
          </div>
          {restMode && (
            <div style={{ background: "linear-gradient(135deg, #1a1200, #2a1e00)", border: "1px solid #5a3a00", borderRadius: "10px", padding: "14px 18px", marginBottom: "16px", display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "24px" }}>🏕️</span>
              <div>
                <div style={{ color: "#f0c060", fontWeight: "600", fontSize: "14px" }}>Aaron is at camp — resting</div>
                {restNote && <div style={{ color: "#a08040", fontSize: "12px", marginTop: "2px" }}>{restNote}</div>}
                {restSince && <div style={{ color: "#6a5020", fontSize: "11px", marginTop: "2px" }}>Since {new Date(restSince).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: "America/Inuvik" })} Inuvik time</div>}
              </div>
              <div style={{ marginLeft: "auto", color: "#6a5020", fontSize: "11px", textAlign: "right" }}>Stats show last recorded position<br/>Auto-refresh paused</div>
            </div>
          )}
          <div style={{ color: "#4a7aaa", fontSize: "11px", marginBottom: "16px", display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {lastFetched && <span>Last fetched: {lastFetched}</span>}
            {!restMode && nextRefreshIn !== null && <span style={{ color: "#2a4a5a" }}>Auto-refresh in {formatCountdown(nextRefreshIn)}</span>}
            {restMode && <span style={{ color: "#5a4020" }}>⏸ Auto-refresh paused (rest mode)</span>}
          </div>
          {error && <div style={{ background: "#1a0a0a", border: "1px solid #5a1a1a", borderRadius: "8px", padding: "16px", marginBottom: "16px", color: "#ff8080", fontSize: "14px" }}>⚠ {error}</div>}

          {!liveData && !loading && !error && (
            <div style={{ ...card, textAlign: "center", padding: "48px 20px", color: "#2a4a6a" }}>
              <div style={{ fontSize: "40px", marginBottom: "14px" }}>❄</div>
              <div style={{ fontSize: "15px" }}>Loading Aaron's current position...</div>
            </div>
          )}

          {liveData && <>
            <div style={{ ...card, marginBottom: "16px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "8px", fontSize: "13px" }}>
                <span style={{ color: "#7a9cc8" }}>Route Progress</span>
                <span style={{ color: "#fff", fontWeight: "bold" }}>{mile !== null ? `${mile} mi` : "Off Route"} <span style={{ color: "#4a9eff" }}>/ {TOTAL_MILES} mi</span></span>
              </div>
              <div style={{ background: "#0a0e1a", borderRadius: "4px", height: "8px", overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: "4px", width: `${pct}%`, background: "linear-gradient(90deg, #1a5fc8, #00c896)", transition: "width 0.8s ease" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "6px", fontSize: "11px", color: "#4a6a8a" }}>
                <span>Start</span><span style={{ color: "#4a9eff" }}>{pct}%</span><span>Finish</span>
              </div>
              <div style={{ marginTop: "14px", fontSize: "12px", color: "#5a8aaa", overflowWrap: "break-word", wordBreak: "break-word" }}>📍 {getCheckpoint(mile)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "12px", marginBottom: "16px" }}>
              {/* 1. Race Status */}
              <div style={{ ...card, ...(restMode ? { background: "#1a1200", borderColor: "#5a3a00" } : {}) }}>
                <div style={statLabel}>Race Status</div>
                {restMode
                  ? <div style={{ fontSize: "15px", color: "#f0c060", fontWeight: "500" }}>🏕️ At Camp</div>
                  : <div style={{ fontSize: "15px", color: liveData.status === "Active" ? "#00c896" : "#4a9eff", fontWeight: "500" }}>{liveData.status || "—"}</div>
                }
                {restMode && restNote && <div style={{ fontSize: "11px", color: "#a08040", marginTop: "2px" }}>{restNote}</div>}
              </div>
              {/* 2. Current Speed */}
              <div style={card}>
                <div style={statLabel}>Current Speed</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.currentSpeed || "—"}</div>
              </div>
              {/* 3. Conditions + Sunset */}
              {weather && (() => {
                const now = new Date();
                const isNight = (weather.sunsetAt && now > weather.sunsetAt) ||
                                (weather.sunriseAt && now < weather.sunriseAt);
                const isSnow = weather.weatherCode >= 71 && weather.weatherCode <= 77;
                const isHighWind = weather.windMph >= 20;
                const displayIcon = getWeatherIcon(weather.icon, isNight);
                const tz = weather.timezone || "America/Inuvik";
                const tileStyle = {
                  ...card,
                  ...(isNight ? { background: "#0a0e20", borderColor: "#1a2a5e" } : {}),
                  ...(isSnow ? { borderColor: "#2a5a9e" } : {}),
                };
                return (
                  <div style={tileStyle}>
                    <div style={statLabel}>Conditions at Location</div>
                    <div style={{ fontSize: "22px", marginBottom: "2px" }}>{displayIcon}</div>
                    <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{weather.tempF}°F / {weather.tempC}°C</div>
                    <div style={{ fontSize: "12px", color: isHighWind ? "#f0a040" : "#7a9cc8", marginTop: "2px" }}>
                      {weather.desc}{isHighWind ? " 💨" : ""} · {weather.windMph} mph wind
                    </div>
                    <div style={{ fontSize: "11px", color: "#4a6a8a", marginTop: "6px", borderTop: "1px solid #1e2a4e", paddingTop: "6px" }}>
                      {isNight ? (() => {
                        const sunriseTime = weather.sunriseAt ? weather.sunriseAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : null;
                        return <span>🌙 Night{sunriseTime ? <span style={{ color: "#4a6a8a" }}> · sunrise {sunriseTime}</span> : null}</span>;
                      })() : (() => {
                        const sunsetTime = weather.sunsetAt ? weather.sunsetAt.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : null;
                        const until = formatTimeUntil(weather.sunsetAt);
                        return sunsetTime ? <span>🌅 Sunset {sunsetTime}{until ? <span style={{ color: "#7a9cc8" }}> · in {until}</span> : null}</span> : null;
                      })()}
                    </div>
                  </div>
                );
              })()}
              {/* 4-5. Next Camp + Est. Arrival */}
              {mile !== null && (() => {
                const nc = getNextCampInfo(mile, liveData.movingAvgSpeed);
                if (!nc) return null;
                const arrivalTime = nc.eta ? nc.eta.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }) : null;
                const until = nc.eta ? formatTimeUntil(nc.eta) : null;
                return (<>
                  <div style={card}>
                    <div style={statLabel}>Next Camp</div>
                    <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{nc.remaining} mi</div>
                    <div style={{ fontSize: "11px", color: "#7a9cc8", marginTop: "2px" }}>{nc.name.split(" /")[0].split("–")[0].trim()}</div>
                  </div>
                  {arrivalTime && (
                    <div style={card}>
                      <div style={statLabel}>Est. Arrival</div>
                      <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{arrivalTime}</div>
                      {until && <div style={{ fontSize: "11px", color: "#7a9cc8", marginTop: "2px" }}>in {until}</div>}
                    </div>
                  )}
                </>);
              })()}
              {/* 6. Current Elevation */}
              <div style={card}>
                <div style={statLabel}>Current Elevation</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.currentElevation || "—"}</div>
              </div>
              {/* 5. Elevation Gain */}
              <div style={card}>
                <div style={statLabel}>Elevation Gain</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.elevationGain || "—"}</div>
              </div>
              {/* 8+. Race Position + Leader + Field */}
              {leaderboard?.athletes?.length > 0 && leaderboard.aaronRank > 0 && (() => {
                const aaron = leaderboard.athletes[leaderboard.aaronRank - 1];
                const leader = leaderboard.athletes[0];
                const ahead = leaderboard.aaronRank > 1 ? leaderboard.athletes[leaderboard.aaronRank - 2] : null;
                const aheadCtx = ahead ? getAthleteContext(ahead.routeMile) : null;
                const leaderCtx = getAthleteContext(leader.routeMile);
                const gapToAhead = ahead ? (ahead.routeMile - aaron.routeMile).toFixed(1) : null;
                const gapToLeader = (leader.routeMile - aaron.routeMile).toFixed(1);
                return (<>
                  <div style={card}>
                    <div style={statLabel}>Race Position</div>
                    <div style={{ fontSize: "22px", color: "#4a9eff", fontWeight: "bold" }}>
                      #{leaderboard.aaronRank} <span style={{ fontSize: "12px", color: "#4a6a8a" }}>of {leaderboard.remaining}</span>
                    </div>
                    {leaderboard.aaronRank === 1 && (
                      <div style={{ fontSize: "12px", color: "#00c896", marginTop: "6px" }}>Leading the field 🏆</div>
                    )}
                    {ahead && aheadCtx && (
                      <div style={{ fontSize: "12px", color: "#7a9cc8", marginTop: "6px", lineHeight: "1.5" }}>
                        <span style={{ color: "#c8d4f0" }}>{ahead.name.split(" ")[0]}</span>
                        {aheadCtx.atCamp
                          ? <span style={{ color: "#4a9eff" }}> · at {aheadCtx.label}</span>
                          : <span> · {gapToAhead} mi ahead</span>
                        }
                      </div>
                    )}
                  </div>
                  {leaderboard.aaronRank > 1 && (
                    <div style={card}>
                      <div style={statLabel}>Leader</div>
                      <div style={{ fontSize: "14px", color: "#e8eaf6", fontWeight: "600", marginBottom: "4px" }}>
                        {leader.name.split(" ")[0]} {leader.name.split(" ").slice(-1)[0]}
                      </div>
                      {leaderCtx.atCamp ? (<>
                        <div style={{ fontSize: "13px", color: "#4a9eff" }}>at {leaderCtx.label}</div>
                        <div style={{ fontSize: "11px", color: "#4a6a8a", marginTop: "3px" }}>{gapToLeader} mi ahead</div>
                      </>) : (<>
                        <div style={{ fontSize: "13px", color: "#e8eaf6" }}>{gapToLeader} mi ahead</div>
                        <div style={{ fontSize: "11px", color: "#4a6a8a", marginTop: "3px" }}>{leaderCtx.label}</div>
                      </>)}
                    </div>
                  )}
                  <div style={card}>
                    <div style={statLabel}>Field Remaining</div>
                    <div style={{ fontSize: "22px", color: "#e8eaf6", fontWeight: "500" }}>{leaderboard.remaining} <span style={{ fontSize: "12px", color: "#4a6a8a" }}>/ {leaderboard.total} started</span></div>
                    <div style={{ fontSize: "12px", color: "#ff8080", marginTop: "4px" }}>{leaderboard.scratched} scratched</div>
                  </div>
                </>);
              })()}
              {/* Remaining stats */}
              <div style={card}>
                <div style={statLabel}>Moving Avg Speed</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.movingAvgSpeed || "—"}</div>
              </div>
              <div style={card}>
                <div style={statLabel}>Moving Time</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.movingTime || "—"}</div>
              </div>
              <div style={card}>
                <div style={statLabel}>Stopped Time</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.stoppedTime || "—"}</div>
              </div>
              <div style={card}>
                <div style={statLabel}>Last Update</div>
                <div style={{ fontSize: "15px", color: "#e8eaf6", fontWeight: "500" }}>{liveData.lastUpdate || "—"}</div>
              </div>
            </div>
          </>}

          {liveData && isAdmin && (
            <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
              <input value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} placeholder={`Label (e.g. "Day 1 End")`} style={{ ...inputStyle, flex: "1", minWidth: "160px" }} />
              <button onClick={saveSnapshot} style={{ background: "linear-gradient(135deg, #1a6e3a, #0d4a26)", color: "#90ffbc", border: "none", borderRadius: "6px", padding: "9px 20px", fontSize: "13px", cursor: "pointer" }}>+ Save Snapshot</button>
            </div>
          )}

          {snapshots.length > 0 && (
            <div style={{ marginTop: "20px" }}>
              <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#2a4a6a", textTransform: "uppercase", marginBottom: "12px" }}>Saved Snapshots</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {snapshots.map((snap, i) => {
                  const m = parseMile(snap.data.routeMile);
                  return (
                    <div key={i} style={card}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px" }}>
                        <div>
                          <div style={{ fontWeight: "600", color: "#fff", fontSize: "14px" }}>{snap.label}</div>
                          <div style={{ fontSize: "11px", color: "#4a6a8a", marginTop: "2px" }}>{new Date(snap.savedAt).toLocaleString()}</div>
                        </div>
                        <button onClick={() => deleteSnapshot(i)} style={{ background: "none", border: "none", color: "#4a4a6a", cursor: "pointer", fontSize: "16px" }}>×</button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(90px, 1fr))", gap: "8px" }}>
                        {[["Mile", snap.data.routeMile], ["Progress", `${progressPct(m)}%`], ["Status", snap.data.status], ["Speed", snap.data.currentSpeed], ["Moving Time", snap.data.movingTime], ["Checkpoint", getCheckpoint(m).split("→")[0].replace("✅ ", "")]].map(([lbl, val]) => (
                          <div key={lbl}>
                            <div style={{ fontSize: "10px", color: "#4a6a8a", textTransform: "uppercase", letterSpacing: "1px" }}>{lbl}</div>
                            <div style={{ fontSize: "12px", color: "#c8d4f0", marginTop: "2px" }}>{val || "—"}</div>
                          </div>
                        ))}
                      </div>
                      {snap.narrative && (
                        <div style={{ borderTop: "1px solid #1e2a4e", paddingTop: "10px", marginTop: "10px" }}>
                          <p style={{ margin: 0, fontSize: "13px", color: "#8a9abf", fontStyle: "italic", lineHeight: "1.7" }}>{snap.narrative}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── MAP ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Course Map & All Athletes</div>
          <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #1e3a6e", background: "#111827" }}>
            <iframe src={MAP_URL} title="6633 Ultra Race Map" style={{ width: "100%", height: "clamp(300px, 60vw, 500px)", border: "none", display: "block" }} loading="lazy" />
          </div>
          <div style={{ marginTop: "8px", fontSize: "11px", color: "#2a4a6a", textAlign: "right" }}>
            Map via <a href={MAP_URL} target="_blank" rel="noopener noreferrer" style={{ color: "#2a4a8a", textDecoration: "none" }}>trackleaders.com</a>
          </div>
        </div>

        {/* ── JOURNAL ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Race Journal</div>
          <p style={{ color: "#4a7aaa", fontSize: "14px", margin: "0 0 20px", lineHeight: "1.6" }}>Daily notes and updates from Aaron's team throughout the race.</p>

          {/* Race Update admin card */}
          {isAdmin && <div style={{ ...card, marginBottom: "16px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: raceUpdate ? "#c87800" : "#7a9cc8", textTransform: "uppercase", marginBottom: "12px" }}>📢 Race Update</div>
            <div style={{ fontSize: "13px", color: "#8a9cc8", marginBottom: "10px" }}>
              Shown as a banner above the About section for all visitors. Clear to remove.
            </div>
            <textarea
              value={raceUpdateInput}
              onChange={e => setRaceUpdateInput(e.target.value)}
              placeholder={raceUpdate || "e.g. Delayed start today due to extreme windchill — expected to resume at 2 PM MDT"}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", lineHeight: "1.6", width: "100%", boxSizing: "border-box", marginBottom: "10px" }}
            />
            <div style={{ display: "flex", gap: "8px" }}>
              <button onClick={saveRaceUpdate} disabled={raceUpdateLoading} style={{ background: "linear-gradient(135deg, #7a4a00, #4a2a00)", color: "#f0d090", border: "none", borderRadius: "6px", padding: "10px 18px", fontSize: "14px", cursor: raceUpdateLoading ? "not-allowed" : "pointer", minHeight: "44px", flex: 1 }}>
                {raceUpdateLoading ? "Saving..." : "Post Update"}
              </button>
              {raceUpdate && <button onClick={async () => {
                setRaceUpdateLoading(true);
                try {
                  const res = await fetch("/api/stats", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: adminPwd, raceUpdate: "" }) });
                  if (res.ok) { setRaceUpdate(""); setRaceUpdateAt(null); setRaceUpdateInput(""); }
                } catch {}
                setRaceUpdateLoading(false);
              }} disabled={raceUpdateLoading} style={{ background: "none", border: "1px solid #3a2a1a", borderRadius: "6px", color: "#6a4a20", padding: "10px 14px", fontSize: "13px", cursor: "pointer", minHeight: "44px" }}>
                Clear
              </button>}
            </div>
            {raceUpdate && <div style={{ fontSize: "11px", color: "#6a4a20", marginTop: "8px" }}>Current: "{raceUpdate}"</div>}
          </div>}

          {/* Admin write panel */}
          {isAdmin && <div style={{ ...card, marginBottom: "16px", background: restMode ? "#1a1200" : "#0d1520", borderColor: restMode ? "#5a3a00" : "#1e3a6e" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: restMode ? "#f0c060" : "#7a9cc8", textTransform: "uppercase", marginBottom: "12px" }}>🏕️ Rest Mode</div>
            <div style={{ fontSize: "13px", color: "#8a9cc8", marginBottom: "10px" }}>
              {restMode
                ? "Aaron is shown as resting. Auto-refresh and push notifications are paused."
                : "Enable when Aaron is at camp so viewers see a resting state instead of stale active data."}
            </div>
            {!restMode && (
              <input value={restNoteInput} onChange={e => setRestNoteInput(e.target.value)} placeholder="Note (optional) e.g. Sleeping at Fort McPherson" style={{ ...inputStyle, marginBottom: "10px" }} />
            )}
            <button onClick={() => toggleRestMode(!restMode)} disabled={restModeLoading} style={{ background: restMode ? "linear-gradient(135deg, #1a5fc8, #0d3a8e)" : "linear-gradient(135deg, #5a3a00, #3a2000)", color: restMode ? "#fff" : "#f0c060", border: "none", borderRadius: "6px", padding: "10px 20px", fontSize: "14px", cursor: restModeLoading ? "not-allowed" : "pointer", minHeight: "44px" }}>
              {restModeLoading ? "Saving..." : restMode ? "▶ Resume Active Mode" : "🏕️ Enable Rest Mode"}
            </button>
          </div>}

          {isAdmin && <div style={{ ...card, marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#00c896", textTransform: "uppercase", marginBottom: "16px" }}>✓ New Entry</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginBottom: "14px" }}>
              <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Title (optional)" style={inputStyle} />
              <textarea value={newText} onChange={(e) => setNewText(e.target.value)} placeholder="Write a journal entry..." rows={5} style={{ ...inputStyle, lineHeight: "1.7", resize: "vertical", width: "100%", boxSizing: "border-box" }} />
              {liveData && (
                <button onClick={generateNarrative} disabled={narrativeLoading} style={{ alignSelf: "flex-start", background: narrativeLoading ? "#2a1a4e" : "linear-gradient(135deg, #5a1a9e, #3a0a6e)", color: "#e0d0ff", border: "none", borderRadius: "5px", padding: "8px 16px", fontSize: "13px", cursor: narrativeLoading ? "not-allowed" : "pointer", letterSpacing: "1px", minHeight: "40px" }}>
                  {narrativeLoading ? "✦ Writing..." : "✦ Generate Narrative from Live Data"}
                </button>
              )}
              <textarea value={newEmbed} onChange={(e) => setNewEmbed(e.target.value)} placeholder="Embed HTML (optional — paste iframe code)" rows={3} style={{ ...inputStyle, lineHeight: "1.5", resize: "vertical", fontSize: "11px", fontFamily: "monospace" }} />
            </div>
            {liveData && <div style={{ fontSize: "12px", color: "#4a7aaa", marginBottom: "10px" }}>Current race snapshot will be attached.</div>}
            {entryError && <div style={{ color: "#ff6060", fontSize: "12px", marginBottom: "10px" }}>{entryError}</div>}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center", marginBottom: "12px" }}>
              <button onClick={postJournalEntry} disabled={postingEntry || !newText.trim()} style={{ background: "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "12px 22px", fontSize: "15px", cursor: "pointer", minHeight: "48px", flex: "1" }}>
                {postingEntry ? "Posting..." : "Post Entry"}
              </button>
              <button onClick={() => sendUpdateNow(false)} disabled={sendingUpdate} style={{ background: "none", border: "1px solid #1e3a6e", borderRadius: "6px", color: "#4a9eff", padding: "12px 18px", fontSize: "14px", cursor: "pointer", minHeight: "48px", flex: "1" }}>
                {sendingUpdate ? "Sending..." : "Send to All Subscribers"}
              </button>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
              <input value={testEmail} onChange={(e) => setTestEmail(e.target.value)} placeholder="your@email.com" style={{ ...inputStyle, flex: "1", minWidth: "160px" }} />
              <button onClick={() => sendUpdateNow(true)} disabled={sendingUpdate || !testEmail.trim()} style={{ background: "none", border: "1px solid #2a4a6a", borderRadius: "6px", color: "#7a9cc8", padding: "12px 14px", fontSize: "14px", cursor: "pointer", minHeight: "48px" }}>
                Send Test
              </button>
            </div>
            {sendStatus && <div style={{ fontSize: "12px", color: "#00c896", marginTop: "8px" }}>{sendStatus}</div>}
          </div>}

          {journalLoading && <div style={{ color: "#4a6a8a", fontSize: "14px" }}>Loading...</div>}
          {!journalLoading && journalEntries.length === 0 && (
            <div style={{ ...card, textAlign: "center", padding: "40px 20px", color: "#2a4a6a", marginBottom: "24px" }}>
              <div style={{ fontSize: "32px", marginBottom: "10px" }}>📖</div>
              <div>No journal entries yet — check back once the race starts.</div>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {journalEntries.map((entry) => (
              <div key={entry.id} style={card}>
                {editingId === entry.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} placeholder="Title" style={inputStyle} />
                    <textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={5} style={{ ...inputStyle, lineHeight: "1.7", resize: "vertical" }} />
                    <textarea value={editEmbed} onChange={(e) => setEditEmbed(e.target.value)} placeholder="Embed HTML (optional — paste iframe code)" rows={3} style={{ ...inputStyle, lineHeight: "1.5", resize: "vertical", fontSize: "11px", fontFamily: "monospace" }} />
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button onClick={() => saveEditEntry(entry.id)} style={{ background: "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "8px 18px", fontSize: "13px", cursor: "pointer" }}>Save</button>
                      <button onClick={() => setEditingId(null)} style={{ background: "none", border: "1px solid #1e3a6e", borderRadius: "6px", color: "#4a9eff", padding: "8px 14px", fontSize: "13px", cursor: "pointer" }}>Cancel</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontWeight: "600", color: "#fff", fontSize: "16px", marginBottom: "3px" }}>{entry.title}</div>
                        <div style={{ fontSize: "11px", color: "#4a6a8a" }}>{new Date(entry.createdAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</div>
                      </div>
                      {isAdmin && (
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button onClick={() => { setEditingId(entry.id); setEditTitle(entry.title); setEditText(entry.text); setEditEmbed(entry.embed || ""); }} style={{ background: "none", border: "1px solid #1e3a6e", borderRadius: "5px", color: "#4a9eff", cursor: "pointer", fontSize: "13px", padding: "6px 12px", minHeight: "36px" }}>Edit</button>
                          <button onClick={() => deleteJournalEntry(entry.id)} style={{ background: "none", border: "1px solid #2a2a4a", borderRadius: "5px", color: "#4a4a6a", cursor: "pointer", fontSize: "18px", padding: "4px 10px", minHeight: "36px" }}>×</button>
                        </div>
                      )}
                    </div>
                    <p style={{ margin: "0 0 12px", lineHeight: "1.8", color: "#c8d4f0", fontSize: "15px" }}>{entry.text}</p>
                    {entry.embed && (
                      <div style={{ margin: "12px 0", display: "flex", justifyContent: "center" }} dangerouslySetInnerHTML={{ __html: entry.embed }} />
                    )}
                    {entry.raceData?.routeMile && (
                      <div style={{ borderTop: "1px solid #1e2a4e", paddingTop: "10px", display: "flex", gap: "24px", flexWrap: "wrap" }}>
                        {[["Mile", entry.raceData.routeMile], ["Status", entry.raceData.status], ["Speed", entry.raceData.currentSpeed]].map(([lbl, val]) => val && (
                          <div key={lbl}>
                            <div style={{ fontSize: "10px", color: "#4a6a8a", textTransform: "uppercase", letterSpacing: "1px" }}>{lbl}</div>
                            <div style={{ fontSize: "13px", color: "#7a9cc8", marginTop: "2px" }}>{val}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(() => {
                      const ds = dailyStats[getInuvikDateStr(entry.createdAt)];
                      if (!ds) return null;
                      return (
                        <div style={{ borderTop: "1px solid #1e2a4e", paddingTop: "10px", marginTop: "10px" }}>
                          <div style={{ fontSize: "10px", color: "#4a6a8a", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "6px" }}>Day {ds.dayNum} Recap</div>
                          <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                            {[
                              ["Miles", `${ds.milesCovered} mi`],
                              ["Route", `${ds.startMile.toFixed(1)} → ${ds.endMile.toFixed(1)}`],
                              ds.avgSpeed ? ["Avg Speed", `${ds.avgSpeed} mph`] : null,
                            ].filter(Boolean).map(([lbl, val]) => (
                              <div key={lbl}>
                                <div style={{ fontSize: "10px", color: "#4a6a8a", textTransform: "uppercase", letterSpacing: "1px" }}>{lbl}</div>
                                <div style={{ fontSize: "13px", color: "#7a9cc8", marginTop: "2px" }}>{val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </>
                )}
              </div>
            ))}
          </div>

        </div>

        {/* ── COMMENTS ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={sectionTitle}>Leave a Message for Aaron</div>
          <p style={{ color: "#4a7aaa", fontSize: "14px", margin: "0 0 20px", lineHeight: "1.6" }}>Cheer him on from wherever you are — messages are reviewed before they appear.</p>

          {commentStatus === "sent" ? (
            <div style={{ ...card, marginBottom: "24px", textAlign: "center", padding: "28px", color: "#00c896", fontSize: "15px" }}>
              ✓ Thanks! Your message is under review and will appear shortly.
            </div>
          ) : (
            <form onSubmit={submitComment} style={{ ...card, marginBottom: "24px" }}>
              {/* Honeypot — hidden from real users, visible to bots */}
              <div style={{ position: "absolute", left: "-9999px", height: "1px", overflow: "hidden" }}>
                <input tabIndex={-1} autoComplete="off" value={commentWebsite} onChange={(e) => setCommentWebsite(e.target.value)} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <input value={commentName} onChange={(e) => setCommentName(e.target.value)} placeholder="Your name" required maxLength={80} style={inputStyle} />
                <textarea value={commentText} onChange={(e) => setCommentText(e.target.value)} placeholder="Your message for Aaron..." required maxLength={1000} rows={4} style={{ ...inputStyle, resize: "vertical", lineHeight: "1.7", width: "100%", boxSizing: "border-box" }} />
                <div>
                  <div style={{ fontSize: "13px", color: "#4a7aaa", marginBottom: "8px" }}>Type the word <strong style={{ color: "#7aaacc" }}>arctic</strong> to confirm you're human:</div>
                  <input value={commentVerify} onChange={(e) => setCommentVerify(e.target.value)} placeholder="arctic" required style={{ ...inputStyle, width: "160px" }} />
                </div>
                {commentStatus && commentStatus !== "sending" && (
                  <div style={{ color: "#ff8080", fontSize: "13px" }}>{commentStatus}</div>
                )}
                <button type="submit" disabled={commentStatus === "sending"} style={{ background: "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "12px 22px", fontSize: "15px", cursor: "pointer", minHeight: "48px", alignSelf: "flex-start" }}>
                  {commentStatus === "sending" ? "Sending..." : "Post Message"}
                </button>
              </div>
            </form>
          )}

          {/* Admin pending approvals */}
          {isAdmin && (() => {
            const pending = allComments.filter((c) => !c.approved);
            if (!pending.length) return null;
            return (
              <div style={{ marginBottom: "20px" }}>
                <div style={{ fontSize: "11px", letterSpacing: "2px", color: "#ff8080", textTransform: "uppercase", marginBottom: "10px" }}>Pending ({pending.length})</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {pending.map((c) => (
                    <div key={c.id} style={{ ...card, border: "1px solid #3a2a1a" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "6px" }}>
                        <div style={{ fontWeight: "600", color: "#fff", fontSize: "14px" }}>{c.name}</div>
                        <div style={{ display: "flex", gap: "8px" }}>
                          <button onClick={() => approveComment(c.id)} style={{ background: "none", border: "1px solid #1a4a2a", borderRadius: "5px", color: "#00c896", cursor: "pointer", fontSize: "12px", padding: "4px 10px" }}>Approve</button>
                          <button onClick={() => deleteComment(c.id)} style={{ background: "none", border: "1px solid #2a1a1a", borderRadius: "5px", color: "#ff8080", cursor: "pointer", fontSize: "12px", padding: "4px 10px" }}>Delete</button>
                        </div>
                      </div>
                      <p style={{ margin: 0, color: "#8a9abf", fontSize: "13px", lineHeight: "1.7" }}>{c.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          {commentsLoading && <div style={{ color: "#4a6a8a", fontSize: "14px" }}>Loading...</div>}
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {comments.map((c) => (
              <div key={c.id} style={{ ...card, position: "relative" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "8px", gap: "12px" }}>
                  <div style={{ fontWeight: "600", color: "#fff", fontSize: "15px" }}>{c.name}</div>
                  <div style={{ fontSize: "11px", color: "#4a6a8a", flexShrink: 0 }}>{new Date(c.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                </div>
                <p style={{ margin: 0, color: "#c8d4f0", fontSize: "14px", lineHeight: "1.8" }}>{c.text}</p>
                {isAdmin && (
                  <button onClick={() => deleteComment(c.id)} style={{ position: "absolute", top: "12px", right: "12px", background: "none", border: "none", color: "#4a4a6a", cursor: "pointer", fontSize: "18px", padding: "2px 6px" }}>×</button>
                )}
              </div>
            ))}
            {!commentsLoading && comments.length === 0 && (
              <div style={{ ...card, textAlign: "center", padding: "32px 20px", color: "#2a4a6a" }}>
                <div style={{ fontSize: "28px", marginBottom: "8px" }}>💬</div>
                <div>No messages yet — be the first to cheer Aaron on!</div>
              </div>
            )}
          </div>
        </div>

        {/* ── FACEBOOK ── */}
        <div style={{ marginBottom: "40px" }}>
          <div style={{ ...sectionTitle, display: "flex", alignItems: "center", justifyContent: "center", gap: "10px" }}>
            <span>6633 Arctic Ultra — Race Updates</span>
            <a href="https://www.facebook.com/6633ArcticUltra" target="_blank" rel="noopener noreferrer" style={{ fontSize: "10px", color: "#4a9eff", textDecoration: "none", border: "1px solid #1e3a6e", borderRadius: "4px", padding: "2px 8px", letterSpacing: "1px" }}>Facebook →</a>
          </div>
          <div style={{ borderRadius: "10px", overflow: "hidden", border: "1px solid #1e3a6e", background: "#111827", display: "flex", justifyContent: "center", padding: "16px" }}>
            <iframe
              src="https://www.facebook.com/plugins/page.php?href=https%3A%2F%2Fwww.facebook.com%2F6633ArcticUltra%2F&tabs=timeline&width=500&height=600&small_header=true&adapt_container_width=true&hide_cover=false&show_facepile=false"
              width="100%"
              height="600"
              style={{ border: "none", overflow: "hidden", maxWidth: "500px", display: "block" }}
              scrolling="no"
              allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            />
          </div>
        </div>

        {/* ── PUSH NOTIFICATIONS ── */}
        {notifState !== "unsupported" && notifState !== "loading" && (
          <div style={{ ...card, background: "linear-gradient(135deg, #0d1b3e, #0a0e1a)", marginBottom: "16px" }}>
            <h2 style={{ margin: "0 0 4px", fontSize: "18px", fontWeight: "normal", color: "#fff" }}>🔔 Get Notified</h2>

            {notifState === "ios-not-installed" && (
              <>
                <p style={{ margin: "0 0 16px", color: "#4a7aaa", fontSize: "13px", lineHeight: "1.6" }}>
                  iPhone requires adding this page to your Home Screen before notifications work (iOS 16.4+, Safari only).
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "16px" }}>
                  {[
                    ["1", "Safari", "Open this page in Safari (not Chrome)"],
                    ["2", "↑ Share", "Tap the Share button in the bottom toolbar"],
                    ["3", "Add to Home Screen", "Scroll down and tap Add to Home Screen"],
                    ["4", "Open & Enable", "Open the app from your Home Screen, then tap Enable Notifications here"],
                  ].map(([num, label, desc]) => (
                    <div key={num} style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                      <div style={{ flexShrink: 0, width: "24px", height: "24px", borderRadius: "50%", background: "#1a3a6e", border: "1px solid #2a5aae", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", color: "#4a9eff", fontWeight: "bold", marginTop: "1px" }}>{num}</div>
                      <div>
                        <div style={{ fontSize: "13px", color: "#fff", fontWeight: "600", marginBottom: "1px" }}>{label}</div>
                        <div style={{ fontSize: "12px", color: "#4a7aaa", lineHeight: "1.5" }}>{desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: "11px", color: "#2a4a6a" }}>Works on iPhone and iPad · Requires iOS 16.4+</div>
              </>
            )}

            {notifState === "denied" && (
              <>
                <p style={{ margin: "0 0 12px", color: "#ff8080", fontSize: "13px", lineHeight: "1.6" }}>
                  Notifications are blocked for this site. To re-enable:
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginBottom: "12px" }}>
                  <div style={{ fontSize: "13px", color: "#7a9cc8" }}>
                    <strong style={{ color: "#c8d4f0" }}>Chrome / Edge:</strong> Tap the 🔒 lock icon in the address bar → Site settings → Notifications → Allow
                  </div>
                  <div style={{ fontSize: "13px", color: "#7a9cc8" }}>
                    <strong style={{ color: "#c8d4f0" }}>Firefox:</strong> Tap the shield icon → Connection Secure → More Information → Permissions → Notifications → Allow
                  </div>
                  <div style={{ fontSize: "13px", color: "#7a9cc8" }}>
                    <strong style={{ color: "#c8d4f0" }}>Safari (Mac):</strong> Safari menu → Settings for This Website → Notifications → Allow
                  </div>
                </div>
                <div style={{ fontSize: "11px", color: "#4a4a6a" }}>Then reload this page</div>
              </>
            )}

            {notifState === "prompt" && (
              <>
                <p style={{ margin: "0 0 6px", color: "#4a7aaa", fontSize: "13px", lineHeight: "1.6" }}>
                  Receive push alerts directly in your browser — no app or email needed.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "16px" }}>
                  {["Morning & evening race updates", "Auto-alerts when Aaron's position changes", "Milestone & checkpoint notifications"].map((item) => (
                    <div key={item} style={{ fontSize: "12px", color: "#4a6a8a" }}>· {item}</div>
                  ))}
                </div>
                <button onClick={handleEnableNotifications} style={{ background: "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "12px 28px", fontSize: "15px", cursor: "pointer", letterSpacing: "1px", minHeight: "48px", display: "block", marginBottom: "10px" }}>
                  Enable Notifications
                </button>
                <div style={{ fontSize: "11px", color: "#2a4a6a" }}>Works in Chrome, Firefox, Edge, and Safari on Mac · No sign-up required</div>
              </>
            )}

            {notifState === "granted" && (
              <>
                <p style={{ margin: "0 0 6px", color: "#00c896", fontSize: "13px", lineHeight: "1.6" }}>
                  ✓ Notifications active — you'll be alerted for updates and when Aaron moves.
                </p>
                <div style={{ display: "flex", flexDirection: "column", gap: "4px", marginBottom: "14px" }}>
                  {["Morning & evening race updates", "Auto-alerts when Aaron's position changes"].map((item) => (
                    <div key={item} style={{ fontSize: "12px", color: "#2a6a4a" }}>· {item}</div>
                  ))}
                </div>
                <button onClick={handleDisableNotifications} style={{ background: "none", border: "1px solid #2a4a6a", color: "#4a7aaa", borderRadius: "6px", padding: "10px 18px", fontSize: "13px", cursor: "pointer", minHeight: "44px" }}>
                  Turn Off Notifications
                </button>
              </>
            )}
          </div>
        )}

        {/* ── SUBSCRIBE ── */}
        <div style={{ ...card, background: "linear-gradient(135deg, #0d1b3e, #0a0e1a)" }}>
          <h2 style={{ margin: "0 0 8px", fontSize: "18px", fontWeight: "normal", color: "#fff" }}>Get Race Updates</h2>
          <p style={{ margin: "0 0 18px", color: "#4a7aaa", fontSize: "14px", lineHeight: "1.6" }}>
            Subscribe to receive email updates on Aaron's progress — morning check-ins, evening recaps, and alerts when he reaches key milestones.
          </p>
          {subStatus ? (
            <div style={{ color: "#00c896", fontSize: "14px", lineHeight: "1.6" }}>{subStatus}</div>
          ) : (
            <form onSubmit={submitSubscribe} style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
              <input type="email" value={subEmail} onChange={(e) => setSubEmail(e.target.value)} placeholder="your@email.com" required style={{ ...inputStyle, flex: "1", minWidth: "200px" }} />
              <button type="submit" disabled={subLoading} style={{ background: "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "10px 22px", fontSize: "13px", cursor: "pointer", letterSpacing: "1px" }}>
                {subLoading ? "Subscribing..." : "Subscribe"}
              </button>
            </form>
          )}
        </div>

      </div>

      {/* ── ADMIN LOGIN ── hidden at the bottom for staff use */}
      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "0 20px 40px", textAlign: "center" }}>
        <div style={{ borderTop: "1px solid #0d1520", paddingTop: "24px" }}>
          {!isAdmin ? (
            <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
              <input
                type="password"
                value={adminPwd}
                onChange={(e) => setAdminPwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { setIsAdmin(true); fetchAllComments(); } }}
                placeholder="·····"
                style={{ background: "rgba(255,255,255,0.02)", border: "1px solid #0d1520", borderRadius: "6px", color: "#1a2a3a", padding: "10px 12px", fontSize: "16px", width: "80px", fontFamily: "inherit" }}
              />
              <button
                onClick={() => { setIsAdmin(true); fetchAllComments(); }}
                style={{ background: "none", border: "1px solid #0d1520", borderRadius: "6px", color: "#1a2a3a", padding: "10px 14px", fontSize: "14px", cursor: "pointer", minHeight: "44px" }}
              >🔒</button>
            </div>
          ) : (
            <div style={{ fontSize: "11px", color: "#2a4a3a", letterSpacing: "2px" }}>✓ admin</div>
          )}
        </div>
      </div>

    </div>
  );
}
