import { readFile, writeFile } from "./_github-store.js";
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
const MIN_MILE_DELTA = 0.5;
const MIN_PUSH_INTERVAL_MS = 20 * 60 * 1000;

const CHECKPOINTS = [
  { name: "Eagle Plains",   mile: 0 },
  { name: "Fort McPherson", mile: 30 },
  { name: "Peel River",     mile: 64 },
  { name: "Aklavik",        mile: 92 },
  { name: "Camp 4",         mile: 154 },
  { name: "Inuvik",         mile: 170.8 },
];

function parseAthleteData(html) {
  const data = { routeMile: null, currentSpeed: null, movingAvgSpeed: null, status: null };
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const key = match[1].replace(/<[^>]+>/g, "").trim();
    const val = match[2].replace(/<[^>]+>/g, "").trim();
    if (key === "Route mile")               data.routeMile = val;
    else if (key === "Current speed")       data.currentSpeed = val;
    else if (key === "Moving Average Speed") data.movingAvgSpeed = val;
    else if (key === "Race Status")         data.status = val;
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

    // 2. Parallel reads — notify-state (movement/push gate) + track-history (append target)
    const [
      { data: state, sha: stateSha },
      { data: histPoints, sha: histSha },
    ] = await Promise.all([
      readFile("data/notify-state.json"),
      readFile("data/track-history.json"),
    ]);

    const lastMile     = state?.lastMile ?? null;          // movement gate (independent of push)
    const lastPushMile = state?.lastAutoPushMile ?? null;  // push delta gate
    const lastPushAt   = state?.lastAutoPushAt ? new Date(state.lastAutoPushAt) : null;
    const inRestMode   = state?.restMode === true;
    const now = new Date();

    // 3. Movement check — uses lastMile, not lastAutoPushMile, so history records even when
    //    push is rate-limited
    if (lastMile !== null && Math.abs(routeMile - lastMile) < MIN_MILE_DELTA) {
      return res.status(200).json({ pushed: false, reason: "no_movement", currentMile: routeMile, lastMile });
    }

    // 3b. Rest mode — suppress push unless Aaron has moved ≥1 mile (auto-resume)
    if (inRestMode) {
      const restAtMile = state?.restAtMile ?? null;
      const autoResumed = restAtMile !== null && Math.abs(routeMile - restAtMile) >= 1.0;

      if (!autoResumed) {
        // Still resting — record history, skip push
        const points = histPoints || [];
        points.push({ t: now.toISOString(), m: routeMile, sp: parsed.currentSpeed || null, avg: parsed.movingAvgSpeed || null, st: parsed.status || null });
        await Promise.all([
          writeFile("data/track-history.json", points, histSha),
          writeFile("data/notify-state.json", { ...(state || {}), lastMile: routeMile, updatedAt: now.toISOString() }, stateSha),
        ]);
        return res.status(200).json({ pushed: false, reason: "rest_mode", historyRecorded: true, mile: routeMile });
      }

      // Auto-resume: Aaron has moved — clear rest mode and fall through to send push
      const pct = ((routeMile / TOTAL_MILES) * 100).toFixed(1);
      const next = getNextCheckpoint(routeMile);
      const locationStr = next ? `${(next.mile - routeMile).toFixed(1)} mi to ${next.name}` : "approaching finish 🏁";
      const speedStr   = parsed.movingAvgSpeed ? ` · avg ${parsed.movingAvgSpeed}` : "";
      const currentStr = parsed.currentSpeed   ? ` · now ${parsed.currentSpeed}`   : "";
      const title = "🏃 Aaron is back on the trail!";
      const body  = `Mile ${routeMile.toFixed(1)} · ${pct}% · ${locationStr}${speedStr}${currentStr}`;

      const points = histPoints || [];
      points.push({ t: now.toISOString(), m: routeMile, sp: parsed.currentSpeed || null, avg: parsed.movingAvgSpeed || null, st: parsed.status || null });

      const pushResult = await sendWebPush(title, body);
      await Promise.all([
        writeFile("data/track-history.json", points, histSha),
        writeFile("data/notify-state.json", {
          ...(state || {}),
          restMode: false, restNote: "", restSince: null, restAtMile: null,
          lastMile: routeMile, updatedAt: now.toISOString(),
          lastAutoPushMile: routeMile, lastAutoPushAt: now.toISOString(),
        }, stateSha),
      ]);
      return res.status(200).json({ pushed: true, autoResumed: true, sent: pushResult.sent, mile: routeMile, body });
    }

    // 4. Append data point to track history
    const points = histPoints || [];
    points.push({
      t:   now.toISOString(),
      m:   routeMile,
      sp:  parsed.currentSpeed    || null,
      avg: parsed.movingAvgSpeed  || null,
      st:  parsed.status          || null,
    });
    await writeFile("data/track-history.json", points, histSha);

    // 5. Push rate-limit check
    const rateLimited    = lastPushAt && (now - lastPushAt) < MIN_PUSH_INTERVAL_MS;
    const belowPushDelta = lastPushMile !== null && Math.abs(routeMile - lastPushMile) < MIN_MILE_DELTA;

    if (!rateLimited && !belowPushDelta) {
      // 6. Build and send push notification
      const pct = ((routeMile / TOTAL_MILES) * 100).toFixed(1);
      const next = getNextCheckpoint(routeMile);
      const locationStr = next
        ? `${(next.mile - routeMile).toFixed(1)} mi to ${next.name}`
        : "approaching finish 🏁";
      const speedStr   = parsed.movingAvgSpeed ? ` · avg ${parsed.movingAvgSpeed}` : "";
      const currentStr = parsed.currentSpeed   ? ` · now ${parsed.currentSpeed}`   : "";
      const title = "🏃 Aaron Update";
      const body  = `Mile ${routeMile.toFixed(1)} · ${pct}% · ${locationStr}${speedStr}${currentStr}`;
      const pushResult = await sendWebPush(title, body);

      await writeFile("data/notify-state.json", {
        ...(state || {}),
        lastMile:         routeMile,
        updatedAt:        now.toISOString(),
        lastAutoPushMile: routeMile,
        lastAutoPushAt:   now.toISOString(),
      }, stateSha);

      return res.status(200).json({ pushed: true, sent: pushResult.sent, removed: pushResult.removed, mile: routeMile, body });
    } else {
      // Movement recorded to history, but push skipped
      await writeFile("data/notify-state.json", {
        ...(state || {}),
        lastMile:  routeMile,
        updatedAt: now.toISOString(),
      }, stateSha);

      return res.status(200).json({
        pushed: false,
        reason: rateLimited ? "rate_limited" : "push_delta",
        historyRecorded: true,
        mile: routeMile,
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
