import { readFile, writeFile } from "./github-store.js";
import webPush from "web-push";

// Configure VAPID once at module level
if (process.env.VAPID_PUBLIC_KEY) {
  webPush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:admin@trackanaaron.vercel.app").trim(),
    process.env.VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim()
  );
}

const SITE_URL = "https://trackanaaron.vercel.app";
const TOTAL_MILES = 170.8;
const MIN_MILE_DELTA = 0.5;            // only push if Aaron moved >= 0.5 miles
const MIN_PUSH_INTERVAL_MS = 25 * 60 * 1000; // at least 25 min between auto-pushes

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

  const routeMile = parseFloat(req.body?.routeMile);
  if (isNaN(routeMile)) return res.status(400).json({ error: "Missing routeMile" });

  try {
    const { data: state, sha } = await readFile("data/notify-state.json");
    const lastPushMile = state?.lastAutoPushMile ?? null;
    const lastPushAt = state?.lastAutoPushAt ? new Date(state.lastAutoPushAt) : null;
    const now = new Date();

    // Rate limit: at most once per 25 minutes regardless of how many browsers call this
    if (lastPushAt && (now - lastPushAt) < MIN_PUSH_INTERVAL_MS) {
      return res.status(200).json({ pushed: false, reason: "rate_limited" });
    }

    // Skip push if Aaron hasn't moved enough since last auto-push
    if (lastPushMile !== null && Math.abs(routeMile - lastPushMile) < MIN_MILE_DELTA) {
      return res.status(200).json({ pushed: false, reason: "no_movement" });
    }

    const pct = ((routeMile / TOTAL_MILES) * 100).toFixed(1);
    const title = "🏃 Aaron Update";
    const body = `Mile ${routeMile.toFixed(1)} of ${TOTAL_MILES} · ${pct}% complete`;

    const pushResult = await sendWebPush(title, body);

    // Record last auto-push so we don't spam
    await writeFile("data/notify-state.json", {
      ...(state || {}),
      lastAutoPushMile: routeMile,
      lastAutoPushAt: now.toISOString(),
    }, sha);

    return res.status(200).json({ pushed: true, sent: pushResult.sent });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
