import { useState, useEffect } from "react";

const ATHLETE_URL = "https://trackleaders.com/6633ultra26i.php?name=Aaron_Rabinowitz";
const ATHLETE_NAME = "Aaron Rabinowitz";
const RACE_NAME = "6633 Northern Lights Ultra";
const TOTAL_MILES = 170.8;

const CHECKPOINTS = [
  { name: "Start", mile: 0 },
  { name: "Camp 1 – McPherson Community Hall", mile: 30.2 },
  { name: "Camp 2 (Approx)", mile: 64.3 },
  { name: "Camp 3 – Aklavik Moose Kerr School", mile: 98.1 },
  { name: "Camp 4 / Marathon Start", mile: 144.7 },
  { name: "Finish Line", mile: 170.8 },
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
  const dist = (next.mile - mile).toFixed(1);
  return `${reached.name} → ${next.name} (${dist} mi to next)`;
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

function progressPct(mile) {
  if (mile === null) return 0;
  return Math.min(100, (mile / TOTAL_MILES) * 100).toFixed(1);
}

export default function AaronTracker() {
  const [liveData, setLiveData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [narrative, setNarrative] = useState("");
  const [narrativeLoading, setNarrativeLoading] = useState(false);
  const [snapshots, setSnapshots] = useState([]);
  const [error, setError] = useState(null);
  const [lastFetched, setLastFetched] = useState(null);
  const [saveLabel, setSaveLabel] = useState("");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) setSnapshots(JSON.parse(saved));
    } catch {}
  }, []);

  async function fetchLiveData() {
    setLoading(true);
    setError(null);
    setNarrative("");
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          system: `You are a race data extractor. Fetch the athlete tracking page and return ONLY a JSON object with these exact keys: status, lastUpdate, currentSpeed, avgSpeed, routeMile, elevationGain, currentElevation, movingTime, stoppedTime, movingAvgSpeed. Use null for any missing values. No markdown, no explanation — raw JSON only.`,
          messages: [{ role: "user", content: `Fetch this page and extract the stats table for Aaron Rabinowitz: ${ATHLETE_URL}` }],
        }),
      });
      const json = await res.json();
      const text = json.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      const cleaned = text.replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      setLiveData(parsed);
      setLastFetched(new Date().toLocaleString());
    } catch (e) {
      setError("Could not fetch live data. The race may not have started yet, or the page is unavailable.");
    }
    setLoading(false);
  }

  async function generateNarrative() {
    if (!liveData) return;
    setNarrativeLoading(true);
    const mile = parseMile(liveData.routeMile);
    const pct = progressPct(mile);
    const checkpoint = getCheckpoint(mile);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 1000,
          system: `You are an enthusiastic ultra-endurance race commentator covering the 6633 Northern Lights Ultra — a brutal 170.8-mile self-supported foot race through Canada's Arctic, one of the world's toughest races. Write vivid, emotionally engaging daily updates. Be specific, concise (3-4 sentences), and inspirational. Reference the conditions (Arctic cold, remote terrain) when relevant.`,
          messages: [{
            role: "user",
            content: `Write a daily progress narrative for Aaron Rabinowitz (USA) based on this data:
- Race status: ${liveData.status}
- Route mile: ${liveData.routeMile} of 170.8 (${pct}% complete)
- Checkpoint status: ${checkpoint}
- Current speed: ${liveData.currentSpeed}
- Moving time: ${liveData.movingTime}
- Stopped time: ${liveData.stoppedTime}
- Current elevation: ${liveData.currentElevation}
- Elevation gain: ${liveData.elevationGain}
- Moving avg speed: ${liveData.movingAvgSpeed}`,
          }],
        }),
      });
      const json = await res.json();
      const text = json.content.filter((b) => b.type === "text").map((b) => b.text).join("");
      setNarrative(text);
    } catch {
      setNarrative("Could not generate narrative.");
    }
    setNarrativeLoading(false);
  }

  function saveSnapshot() {
    if (!liveData) return;
    const label = saveLabel.trim() || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const snap = { label, data: liveData, narrative, savedAt: new Date().toISOString() };
    const updated = [snap, ...snapshots].slice(0, 10);
    setSnapshots(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
    setSaveLabel("");
  }

  function deleteSnapshot(i) {
    const updated = snapshots.filter((_, idx) => idx !== i);
    setSnapshots(updated);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(updated)); } catch {}
  }

  const mile = liveData ? parseMile(liveData.routeMile) : null;
  const pct = progressPct(mile);

  return (
    <div style={{ minHeight: "100vh", background: "#0a0e1a", color: "#e8eaf6", fontFamily: "'Georgia', 'Times New Roman', serif", padding: "0" }}>
      <div style={{ background: "linear-gradient(135deg, #0d1b3e 0%, #0a0e1a 60%, #1a0a2e 100%)", borderBottom: "1px solid #1e3a6e", padding: "32px 24px 24px", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "radial-gradient(ellipse at 20% 50%, rgba(0,200,150,0.07) 0%, transparent 60%), radial-gradient(ellipse at 80% 20%, rgba(100,50,200,0.08) 0%, transparent 50%)", pointerEvents: "none" }} />
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: "11px", letterSpacing: "4px", color: "#4a9eff", textTransform: "uppercase", marginBottom: "8px" }}>Live Race Tracker</div>
          <h1 style={{ margin: 0, fontSize: "clamp(22px, 5vw, 36px)", fontWeight: "normal", letterSpacing: "1px", color: "#fff" }}>Aaron Rabinowitz</h1>
          <div style={{ color: "#7a9cc8", marginTop: "6px", fontSize: "14px" }}>{RACE_NAME} · 170.8 mi · Arctic Canada</div>
          <div style={{ display: "flex", gap: "12px", marginTop: "20px", flexWrap: "wrap" }}>
            <button onClick={fetchLiveData} disabled={loading} style={{ background: loading ? "#1e3a6e" : "linear-gradient(135deg, #1a5fc8, #0d3a8e)", color: "#fff", border: "none", borderRadius: "6px", padding: "10px 22px", fontSize: "13px", cursor: loading ? "not-allowed" : "pointer", letterSpacing: "1px", boxShadow: "0 2px 12px rgba(26,95,200,0.3)" }}>
              {loading ? "⟳ Fetching..." : "↻ Fetch Live Data"}
            </button>
            {liveData && (
              <button onClick={generateNarrative} disabled={narrativeLoading} style={{ background: narrativeLoading ? "#2a1a4e" : "linear-gradient(135deg, #5a1a9e, #3a0a6e)", color: "#e0d0ff", border: "none", borderRadius: "6px", padding: "10px 22px", fontSize: "13px", cursor: narrativeLoading ? "not-allowed" : "pointer", letterSpacing: "1px" }}>
                {narrativeLoading ? "✦ Writing..." : "✦ Generate Daily Narrative"}
              </button>
            )}
          </div>
          {lastFetched && <div style={{ color: "#4a7aaa", fontSize: "11px", marginTop: "10px" }}>Last fetched: {lastFetched}</div>}
        </div>
      </div>

      <div style={{ maxWidth: "860px", margin: "0 auto", padding: "24px 20px" }}>
        {error && <div style={{ background: "#1a0a0a", border: "1px solid #5a1a1a", borderRadius: "8px", padding: "16px", marginBottom: "20px", color: "#ff8080", fontSize: "14px" }}>⚠ {error}</div>}

        {liveData && (
          <div style={{ marginBottom: "28px" }}>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#4a9eff", textTransform: "uppercase", marginBottom: "14px" }}>Current Stats</div>
            <div style={{ background: "#111827", borderRadius: "10px", padding: "20px", marginBottom: "16px", border: "1px solid #1e3a6e" }}>
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
              <div style={{ marginTop: "14px", fontSize: "12px", color: "#5a8aaa" }}>📍 {getCheckpoint(mile)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: "12px" }}>
              {[
                { label: "Race Status", value: liveData.status, accent: liveData.status === "Active" ? "#00c896" : "#4a9eff" },
                { label: "Current Speed", value: liveData.currentSpeed },
                { label: "Moving Avg Speed", value: liveData.movingAvgSpeed },
                { label: "Moving Time", value: liveData.movingTime },
                { label: "Stopped Time", value: liveData.stoppedTime },
                { label: "Elevation Gain", value: liveData.elevationGain },
                { label: "Current Elevation", value: liveData.currentElevation },
                { label: "Last Update", value: liveData.lastUpdate },
              ].map(({ label, value, accent }) => (
                <div key={label} style={{ background: "#111827", borderRadius: "8px", padding: "14px", border: "1px solid #1e3a6e" }}>
                  <div style={{ fontSize: "10px", color: "#4a6a8a", letterSpacing: "2px", textTransform: "uppercase", marginBottom: "6px" }}>{label}</div>
                  <div style={{ fontSize: "15px", color: accent || "#e8eaf6", fontWeight: "500" }}>{value || "—"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {narrative && (
          <div style={{ background: "linear-gradient(135deg, #0d1b3e, #120a2e)", border: "1px solid #2a1a6e", borderRadius: "10px", padding: "24px", marginBottom: "28px", position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, right: 0, width: "200px", height: "200px", background: "radial-gradient(circle, rgba(100,50,200,0.08) 0%, transparent 70%)", pointerEvents: "none" }} />
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#a070ff", textTransform: "uppercase", marginBottom: "12px" }}>✦ Daily Narrative</div>
            <p style={{ margin: 0, lineHeight: "1.8", color: "#c8d4f0", fontSize: "15px", fontStyle: "italic" }}>{narrative}</p>
          </div>
        )}

        {liveData && (
          <div style={{ marginBottom: "32px", display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
            <input value={saveLabel} onChange={(e) => setSaveLabel(e.target.value)} placeholder={`Label (e.g. "Day 1 End")`} style={{ background: "#111827", border: "1px solid #1e3a6e", borderRadius: "6px", color: "#e8eaf6", padding: "9px 14px", fontSize: "13px", flex: "1", minWidth: "160px" }} />
            <button onClick={saveSnapshot} style={{ background: "linear-gradient(135deg, #1a6e3a, #0d4a26)", color: "#90ffbc", border: "none", borderRadius: "6px", padding: "9px 20px", fontSize: "13px", cursor: "pointer", letterSpacing: "1px" }}>+ Save Snapshot</button>
          </div>
        )}

        {snapshots.length > 0 && (
          <div>
            <div style={{ fontSize: "11px", letterSpacing: "3px", color: "#4a9eff", textTransform: "uppercase", marginBottom: "14px" }}>Saved Snapshots</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {snapshots.map((snap, i) => {
                const m = parseMile(snap.data.routeMile);
                const p = progressPct(m);
                return (
                  <div key={i} style={{ background: "#111827", border: "1px solid #1e3a6e", borderRadius: "10px", padding: "18px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                      <div>
                        <div style={{ fontWeight: "600", color: "#fff", fontSize: "15px" }}>{snap.label}</div>
                        <div style={{ fontSize: "11px", color: "#4a6a8a", marginTop: "2px" }}>{new Date(snap.savedAt).toLocaleString()}</div>
                      </div>
                      <button onClick={() => deleteSnapshot(i)} style={{ background: "none", border: "none", color: "#4a4a6a", cursor: "pointer", fontSize: "16px", padding: "0 4px" }}>×</button>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: snap.narrative ? "12px" : "0" }}>
                      {[["Route Mile", snap.data.routeMile], ["Progress", `${p}%`], ["Status", snap.data.status], ["Speed", snap.data.currentSpeed], ["Moving Time", snap.data.movingTime], ["Checkpoint", getCheckpoint(m).split("→")[0].replace("✅ ", "")]].map(([lbl, val]) => (
                        <div key={lbl}>
                          <div style={{ fontSize: "10px", color: "#4a6a8a", textTransform: "uppercase", letterSpacing: "1px" }}>{lbl}</div>
                          <div style={{ fontSize: "13px", color: "#c8d4f0", marginTop: "2px" }}>{val || "—"}</div>
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

        {!liveData && !loading && !error && (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "#2a4a6a" }}>
            <div style={{ fontSize: "48px", marginBottom: "16px" }}>❄</div>
            <div style={{ fontSize: "16px" }}>Hit "Fetch Live Data" to load Aaron's current progress</div>
            <div style={{ fontSize: "13px", marginTop: "8px", color: "#1e3a5a" }}>Race started March 18, 2026 at 12:00 PM MDT</div>
          </div>
        )}
      </div>
    </div>
  );
}
