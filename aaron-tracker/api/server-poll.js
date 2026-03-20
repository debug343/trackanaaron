import { readFile, writeFile } from "./github-store.js";
import webPush from "web-push";

if (process.env.VAPID_PUBLIC_KEY) {
  webPush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:admin@trackanaaron.vercel.app").trim(),
    process.env.VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim()
  );
}

const SITE_URL = "https://trackanaaron.vercel.app";
const TRACKLEAD_URL = "https://trackleaders.com/6633ultra26i.php?name=Aaron_Rabinowitz";
const TOTAL_MILES = 170.8;
const MIN_MILE_DELTA = 0.5;       // must move at least this far to push
const MIN_PUSH_INTERVAL_MS = 20 * 60 * 1000; // no more than once per 20 min

const CHECKPOINTS = [
  { name: "Eagle Plains",  mile: 0 },
  { name: "Fort McPherson", mile: 30 },
  { name: "Peel River",    mile: 64 },
  { name: "Aklavik",       mile: 92 },
  { name: "Camp 4",        mile: 154 },
  { name: "Inuvik",        mile: 170.8 },
];

function parseAthleteData(html) {
  const data = { routeMile: null, currentSpeed: null, movingAvgSpeed: null, status: null };
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const key = match[1].replace(/<[^>]+>/g, "").trim();
    const val = match[2].replace(/<[^>]+>/g, "").trim();
    if (key === "Route mile")          data.routeMile = val;
    else if (key === "Current speed")  data.currentSpeed = val;
    else if (key === "Moving Average Speed") data.movingAvgSpeed = val;
    else if (key === "Race Status")    data.status = val;
  }
  return data;
}

function getNextCheckpoint(mile) {
  for (const cp of CHECKPOINTS) {
    if (cp.mile > mile) return cp;
  }
  return null;
}

async function sendWebPush(title, body) {
  const { data: subs, sha } = await readFile("data/push-subscriptions.json");
  const list = subs || [];
  if (list.length === 0) return { sent: 0, removed: 0 };

  const payload = JSON.stringify({ title, body, url: SITE_URL });
  const results = await Promise.allSettled(
    list.map((sub) => webPush.sendNotification(sub, payload))
  );

  const gone = new Set();
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      const code = r.reason?.statusCode;
      if (code === 404 || code === 410) gone.add(list[i].endpoint);
    }
  });
  if (gone.size > 0) {
    const pruned = list.filter((s) => !gone.has(s.endpoint));
    try { await writeFile("data/push-subscriptions.json", pruned, sha); } catch {}
  }
  return { sent: results.filter((r) => r.status === "fulfilled").length, removed: gone.size };
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  // Auth — Bearer token must match CRON_SECRET env var
  const secret = process.env.CRON_SECRET;
  const auth = req.headers["authorization"] || "";
  if (!secret || auth !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    // 1. Fetch live data from Tracklead
    const response = await fetch(TRACKLEAD_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; tracker/1.0)", "Accept": "text/html" },
    });
    if (!response.ok) return res.status(502).json({ error: `Tracklead returned ${response.status}` });
    const html = await response.text();
    const parsed = parseAthleteData(html);

    const routeMile = parseFloat(parsed.routeMile);
    if (isNaN(routeMile)) {
      return res.status(200).json({ pushed: false, reason: "no_mile_data", raw: parsed.routeMile });
    }

    // 2. Load stored state
    const { data: state, sha } = await readFile("data/notify-state.json");
    const lastPushMile = state?.lastAutoPushMile ?? null;
    const lastPushAt   = state?.lastAutoPushAt ? new Date(state.lastAutoPushAt) : null;
    const now = new Date();

    // 3. Rate-limit checks
    if (lastPushAt && (now - lastPushAt) < MIN_PUSH_INTERVAL_MS) {
      return res.status(200).json({ pushed: false, reason: "rate_limited", nextPushIn: `${Math.round((MIN_PUSH_INTERVAL_MS - (now - lastPushAt)) / 60000)}m` });
    }
    if (lastPushMile !== null && Math.abs(routeMile - lastPushMile) < MIN_MILE_DELTA) {
      return res.status(200).json({ pushed: false, reason: "no_movement", currentMile: routeMile, lastMile: lastPushMile });
    }

    // 4. Build notification content
    const pct = ((routeMile / TOTAL_MILES) * 100).toFixed(1);
    const next = getNextCheckpoint(routeMile);
    const locationStr = next
      ? `${(next.mile - routeMile).toFixed(1)} mi to ${next.name}`
      : "approaching finish 🏁";
    const speedStr  = parsed.movingAvgSpeed ? ` · avg ${parsed.movingAvgSpeed}` : "";
    const currentStr = parsed.currentSpeed  ? ` · now ${parsed.currentSpeed}`   : "";
    const title = "🏃 Aaron Update";
    const body  = `Mile ${routeMile.toFixed(1)} · ${pct}% · ${locationStr}${speedStr}${currentStr}`;

    // 5. Send push
    const pushResult = await sendWebPush(title, body);

    // 6. Persist updated state
    await writeFile("data/notify-state.json", {
      ...(state || {}),
      lastAutoPushMile: routeMile,
      lastAutoPushAt:   now.toISOString(),
    }, sha);

    return res.status(200).json({
      pushed: true,
      sent:   pushResult.sent,
      removed: pushResult.removed,
      mile:   routeMile,
      body,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
