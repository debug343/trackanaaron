import { readFile, writeFile } from "./_github-store.js";
import webPush from "web-push";

// Configure VAPID once at module level (cold-start safe)
if (process.env.VAPID_PUBLIC_KEY) {
  webPush.setVapidDetails(
    (process.env.VAPID_SUBJECT || "mailto:admin@trackanaaron.vercel.app").trim(),
    process.env.VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim()
  );
}

async function sendWebPush(title, body) {
  const { data: subs, sha } = await readFile("data/push-subscriptions.json");
  const list = subs || [];
  if (list.length === 0) return { sent: 0, removed: 0 };

  const payload = JSON.stringify({ title, body, url: SITE_URL });
  const results = await Promise.allSettled(
    list.map((sub) => webPush.sendNotification(sub, payload))
  );

  // Collect gone (404/410) endpoints to prune from storage
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

const SITE_URL = "https://trackanaaron.vercel.app";
const ATHLETE_NAME = "Aaron Rabinowitz";
const RACE_NAME = "6633 Northern Lights Ultra";
const TOTAL_MILES = 170.8;
const DONATE_URL = "https://africanmissionhealthcare.org/donation/ssmr/";

const CHECKPOINTS = [
  { name: "Eagle Plains", mile: 0 },
  { name: "Fort McPherson", mile: 30 },
  { name: "Peel River / Camp 2", mile: 64 },
  { name: "Aklavik / Camp 3", mile: 92 },
  { name: "Camp 4", mile: 154 },
  { name: "Inuvik (Finish)", mile: 170.8 },
];

function parseAthleteData(html) {
  const data = {
    status: null, lastUpdate: null, currentSpeed: null,
    routeMile: null, movingTime: null, stoppedTime: null, movingAvgSpeed: null,
  };
  const rowRegex = /<tr[^>]*>\s*<td[^>]*>(.*?)<\/td>\s*<td[^>]*>(.*?)<\/td>\s*<\/tr>/gi;
  let match;
  while ((match = rowRegex.exec(html)) !== null) {
    const key = match[1].replace(/<[^>]+>/g, "").trim();
    const val = match[2].replace(/<[^>]+>/g, "").trim();
    if (key === "Race Status") data.status = val;
    else if (key === "Last Update Rec'd") data.lastUpdate = val;
    else if (key === "Current speed") data.currentSpeed = val;
    else if (key === "Route mile") data.routeMile = val;
    else if (key === "Moving Time") data.movingTime = val;
    else if (key === "Stopped Time") data.stoppedTime = val;
    else if (key === "Moving Average Speed") data.movingAvgSpeed = val;
  }
  return data;
}

function progressPct(routeMile) {
  const m = parseFloat(routeMile);
  if (isNaN(m)) return "0";
  return Math.min(100, (m / TOTAL_MILES) * 100).toFixed(1);
}

function getNextStage(routeMile) {
  const m = parseFloat(routeMile);
  if (isNaN(m)) return null;
  for (let i = 0; i < CHECKPOINTS.length - 1; i++) {
    if (m < CHECKPOINTS[i + 1].mile) {
      return {
        from: CHECKPOINTS[i].name,
        to: CHECKPOINTS[i + 1].name,
        remaining: (CHECKPOINTS[i + 1].mile - m).toFixed(1),
        stageTotal: (CHECKPOINTS[i + 1].mile - CHECKPOINTS[i].mile).toFixed(0),
        stageNum: i + 1,
      };
    }
  }
  return null;
}

// Use Inuvik local date (MDT = UTC-6) — the evening cron fires at 3:03 AM UTC
// which is 9:03 PM the *previous* calendar day in Inuvik, so UTC dates don't match.
function inuvikDateStr(isoStr) {
  const d = new Date(new Date(isoStr).getTime() - 6 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function todaysJournalEntries(entries) {
  const today = inuvikDateStr(new Date().toISOString());
  return (entries || []).filter((e) => e.createdAt && inuvikDateStr(e.createdAt) === today);
}

function buildConclusionEmail(recipientEmail, { routeMile, movingTime, stoppedTime }) {
  const token = Buffer.from(recipientEmail).toString("base64url");
  const unsubUrl = `${SITE_URL}/api/subscribe?email=${encodeURIComponent(recipientEmail)}&token=${token}`;
  const subject = `🏁 Race Update — ${ATHLETE_NAME}`;
  const pct = routeMile ? ((parseFloat(routeMile) / TOTAL_MILES) * 100).toFixed(1) : null;

  const html = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:Georgia,serif;color:#e8eaf6">
<div style="max-width:540px;margin:0 auto;padding:20px 16px">
  <div style="background:linear-gradient(135deg,#0d1b3e,#0a0e1a);border:1px solid #1e3a6e;border-radius:12px;padding:28px">
    <div style="font-size:10px;letter-spacing:4px;color:#4a9eff;text-transform:uppercase;margin-bottom:6px">2026 Race · Complete</div>
    <h1 style="margin:0 0 4px;font-size:20px;font-weight:normal;color:#fff">${ATHLETE_NAME}</h1>
    <div style="color:#7a9cc8;font-size:13px;margin-bottom:20px">${RACE_NAME} · Arctic Canada</div>

    <div style="background:#111827;border-radius:8px;padding:20px;margin-bottom:16px">
      <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px">Race Summary</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Distance</div>
          <div style="font-size:22px;color:#4a9eff;font-weight:bold;margin-top:2px">${routeMile || "66.4"} mi</div>
          ${pct ? `<div style="font-size:11px;color:#4a6a8a">${pct}% of 170.8 mi</div>` : ""}
        </div>
        <div>
          <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Result</div>
          <div style="font-size:15px;color:#f0a040;margin-top:4px">Medical Withdrawal</div>
          <div style="font-size:11px;color:#4a6a8a">Day 3 · Peel River</div>
        </div>
        ${movingTime ? `<div><div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Moving Time</div><div style="font-size:14px;color:#e8eaf6;margin-top:4px">${movingTime}</div></div>` : ""}
        ${stoppedTime ? `<div><div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px">Stopped Time</div><div style="font-size:14px;color:#e8eaf6;margin-top:4px">${stoppedTime}</div></div>` : ""}
      </div>
    </div>

    <div style="background:#0d2a1e;border:1px solid #1e4a3e;border-radius:8px;padding:16px;margin-bottom:20px">
      <div style="font-size:14px;color:#c8d4f0;line-height:1.7">
        Aaron covered ${routeMile || "66.4"} miles through Canada's Arctic in 3 days before a medical withdrawal — and he wasn't alone. The race was ultimately cancelled due to extreme weather; no one reached the finish line. Aaron's grit through impossible conditions is something to be proud of.<br><br>
        Thank you so much for following along and cheering him on. The full story is on the tracker — including his race journal.
      </div>
    </div>

    <div style="text-align:center;margin-bottom:20px">
      <a href="${SITE_URL}" style="background:linear-gradient(135deg,#1a5fc8,#0d3a8e);color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:13px;letter-spacing:1px;display:inline-block">Read the Full Story →</a>
    </div>
    <div style="border-top:1px solid #1e3a6e;padding-top:16px;text-align:center">
      <div style="font-size:12px;color:#7a9cc8;margin-bottom:8px">Aaron ran in support of South Sudan Medical Relief</div>
      <a href="${DONATE_URL}" style="color:#00c896;font-size:13px;text-decoration:none">Donate to SSMR →</a>
    </div>
  </div>
  <div style="text-align:center;margin-top:12px;font-size:11px;color:#2a3a5a">
    <a href="${unsubUrl}" style="color:#2a3a5a">Unsubscribe</a>
  </div>
</div>
</body></html>`;

  return { subject, html };
}

function buildEmail(data, type, recipientEmail, { dayMiles, dayAvgSpeed, journalEntries }) {
  const pct = progressPct(data.routeMile);
  const nextStage = getNextStage(data.routeMile);
  const token = Buffer.from(recipientEmail).toString("base64url");
  const unsubUrl = `${SITE_URL}/api/subscribe?email=${encodeURIComponent(recipientEmail)}&token=${token}`;

  const subject =
    type === "morning" ? `☀️ Morning Update — ${ATHLETE_NAME}`
    : `🌙 Evening Update — ${ATHLETE_NAME}`;

  const statRow = (label, value) => value ? `
    <tr>
      <td style="padding:6px 10px 6px 0;font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:1px;width:45%;vertical-align:top">${label}</td>
      <td style="padding:6px 0;font-size:14px;color:#e8eaf6">${value}</td>
    </tr>` : "";

  const nextStageHtml = nextStage ? `
    <div style="background:#0d1b3e;border:1px solid #1e3a6e;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:2px;margin-bottom:6px">Stage ${nextStage.stageNum} · Next Checkpoint</div>
      <div style="font-size:15px;color:#fff;margin-bottom:2px">${nextStage.to}</div>
      <div style="font-size:13px;color:#4a9eff">${nextStage.remaining} mi remaining <span style="color:#2a4a6a">/ ${nextStage.stageTotal} mi total stage</span></div>
    </div>` : "";

  const dayStatsHtml = (type === "evening" && dayMiles !== null && !isNaN(dayMiles) && dayMiles > 0) ? `
    <div style="background:#0d2a1e;border:1px solid #1e4a3e;border-radius:8px;padding:14px;margin-bottom:16px">
      <div style="font-size:10px;color:#00c896;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Today's Progress</div>
      <div style="font-size:22px;color:#fff;font-weight:bold;margin-bottom:4px">${dayMiles.toFixed(1)} <span style="font-size:13px;color:#00c896">miles covered today</span></div>
      ${dayAvgSpeed ? `<div style="font-size:13px;color:#4a9eff">Avg moving speed: ${dayAvgSpeed} mph</div>` : ""}
    </div>` : "";

  const journalHtml = (type === "evening" && journalEntries.length > 0) ? `
    <div style="border-top:1px solid #1e3a6e;padding-top:16px;margin-bottom:16px">
      <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:2px;margin-bottom:12px">Today's Journal</div>
      ${journalEntries.map((e) => `
        <div style="margin-bottom:14px">
          ${e.title ? `<div style="font-size:13px;font-weight:bold;color:#fff;margin-bottom:4px">${e.title}</div>` : ""}
          <div style="font-size:14px;color:#c8d4f0;line-height:1.7">${e.text.replace(/\n/g, "<br>")}</div>
        </div>`).join("")}
    </div>` : "";

  const html = `<!DOCTYPE html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0a0e1a;font-family:Georgia,serif;color:#e8eaf6">
<div style="max-width:540px;margin:0 auto;padding:20px 16px">
  <div style="background:linear-gradient(135deg,#0d1b3e,#0a0e1a);border:1px solid #1e3a6e;border-radius:12px;padding:28px">
    <div style="font-size:10px;letter-spacing:4px;color:#4a9eff;text-transform:uppercase;margin-bottom:6px">Live Race Tracker</div>
    <h1 style="margin:0 0 4px;font-size:20px;font-weight:normal;color:#fff">${ATHLETE_NAME}</h1>
    <div style="color:#7a9cc8;font-size:13px;margin-bottom:20px">${RACE_NAME} · Arctic Canada</div>

    <div style="background:#111827;border-radius:8px;padding:16px;margin-bottom:16px">
      <div style="font-size:10px;color:#4a6a8a;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px">Route Progress</div>
      <div style="font-size:26px;color:#fff;font-weight:bold">${data.routeMile || "—"} <span style="font-size:14px;color:#4a9eff">/ ${TOTAL_MILES} mi</span></div>
      <div style="background:#0a0e1a;border-radius:4px;height:6px;margin:10px 0;overflow:hidden">
        <div style="height:100%;border-radius:4px;width:${pct}%;background:linear-gradient(90deg,#1a5fc8,#00c896)"></div>
      </div>
      <div style="font-size:12px;color:#4a9eff">${pct}% complete</div>
    </div>

    ${dayStatsHtml}
    ${nextStageHtml}

    <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
      ${statRow("Race Status", data.status)}
      ${type === "evening" && dayAvgSpeed ? statRow("Today's Avg Speed", `${dayAvgSpeed} mph`) : statRow("Moving Avg Speed", data.movingAvgSpeed)}
      ${statRow("Total Moving Time", data.movingTime)}
      ${statRow("Total Stopped Time", data.stoppedTime)}
      ${statRow("Last Update", data.lastUpdate)}
    </table>

    ${journalHtml}

    <div style="text-align:center;margin-bottom:20px">
      <a href="${SITE_URL}" style="background:linear-gradient(135deg,#1a5fc8,#0d3a8e);color:#fff;text-decoration:none;padding:12px 28px;border-radius:6px;font-size:13px;letter-spacing:1px;display:inline-block">View Live Tracker →</a>
    </div>
    <div style="border-top:1px solid #1e3a6e;padding-top:16px;text-align:center">
      <a href="${DONATE_URL}" style="color:#00c896;font-size:13px;text-decoration:none">Donate to South Sudan Medical Relief →</a>
    </div>
  </div>
  <div style="text-align:center;margin-top:12px;font-size:11px;color:#2a3a5a">
    <a href="${unsubUrl}" style="color:#2a3a5a">Unsubscribe</a>
  </div>
</div>
</body></html>`;

  return { subject, html };
}

export default async function handler(req, res) {
  const cronAuth = req.headers["authorization"];
  const isCron = cronAuth === `Bearer ${process.env.CRON_SECRET}`;
  const isAdmin = req.body?.password === process.env.ADMIN_PASSWORD;

  if (!isCron && !isAdmin) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const type = req.query.type || req.body?.type || "update";

  // ── Conclusion notification (race complete) ──────────────────────────────
  if (type === "conclusion") {
    try {
      // Fetch final stats from Tracklead
      const trackRes = await fetch(
        "https://trackleaders.com/6633ultra26i.php?name=Aaron_Rabinowitz",
        { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } }
      );
      const html = await trackRes.text();
      const data = parseAthleteData(html);

      // Web push
      const pushResult = await sendWebPush(
        "🏁 Race update — Aaron Rabinowitz",
        `Medical withdrawal after 66.4 miles in 3 days. The race was cancelled due to extreme weather — no one finished. Read the full story.`
      ).catch(() => ({ sent: 0, removed: 0 }));

      // Email all subscribers
      const { data: subscribers } = await readFile("data/subscribers.json");
      const list = subscribers || [];
      const testEmail = req.body?.testEmail;
      if (testEmail) {
        const { subject, html: htmlBody } = buildConclusionEmail(testEmail, { routeMile: data.routeMile, movingTime: data.movingTime, stoppedTime: data.stoppedTime });
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev", to: testEmail, subject: `[TEST] ${subject}`, html: htmlBody }),
        });
        return res.status(200).json({ ok: r.ok, test: true, to: testEmail });
      }

      let sent = 0;
      for (const email of list) {
        const { subject, html: htmlBody } = buildConclusionEmail(email, { routeMile: data.routeMile, movingTime: data.movingTime, stoppedTime: data.stoppedTime });
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev", to: email, subject, html: htmlBody }),
        });
        if (r.ok) sent++;
      }
      return res.status(200).json({ ok: true, sent, total: list.length, pushSent: pushResult.sent });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  try {
    const trackRes = await fetch(
      "https://trackleaders.com/6633ultra26i.php?name=Aaron_Rabinowitz",
      { headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html" } }
    );
    const html = await trackRes.text();
    const data = parseAthleteData(html);
    const hasData = Object.values(data).some((v) => v !== null);
    if (!hasData) return res.status(200).json({ ok: false, reason: "No race data" });

    const currentMile = parseFloat(data.routeMile) || 0;

    // Load state file
    const { data: state, sha: stateSha } = await readFile("data/notify-state.json");

    // Morning: save day-start snapshot (use Inuvik date so evening cron matches)
    let dayMiles = null;
    const inuvikToday = inuvikDateStr(new Date().toISOString());
    if (type === "morning") {
      await writeFile("data/notify-state.json", {
        ...(state || {}),
        dayStartMile: currentMile,
        dayStartDate: inuvikToday,
        lastMile: currentMile,
        updatedAt: new Date().toISOString(),
      }, stateSha);
    }

    // Evening: compute miles covered today (compare Inuvik dates — cron fires at
    // 3:03 AM UTC = 9:03 PM MDT, so UTC date is already tomorrow vs morning's UTC date)
    if (type === "evening") {
      if (state?.dayStartDate === inuvikToday && typeof state?.dayStartMile === "number") {
        dayMiles = currentMile - state.dayStartMile;
      }
      await writeFile("data/notify-state.json", {
        ...(state || {}),
        lastMile: currentMile,
        updatedAt: new Date().toISOString(),
      }, stateSha);
    }

    // Fetch today's journal entries + day stats from track history for evening email
    let journalEntries = [];
    let dayAvgSpeed = null;
    if (type === "evening") {
      const [{ data: journal }, { data: histPoints }] = await Promise.all([
        readFile("data/journal.json"),
        readFile("data/track-history.json"),
      ]);
      // Use dayStartDate from state (the morning's Inuvik date) rather than
      // current clock — evening emails sent after midnight Inuvik would otherwise
      // match the wrong day.
      const reportDate = state?.dayStartDate || inuvikToday;
      journalEntries = (journal || []).filter(
        (e) => e.createdAt && inuvikDateStr(e.createdAt) === reportDate
      );

      // Compute day avg speed from track history using the same report date
      const todayPoints = (histPoints || []).filter(
        (pt) => pt.avg && inuvikDateStr(pt.t) === reportDate
      );
      if (todayPoints.length > 0) {
        const speeds = todayPoints.map((pt) => parseFloat(pt.avg)).filter((s) => !isNaN(s) && s > 0);
        if (speeds.length > 0) {
          dayAvgSpeed = (speeds.reduce((a, b) => a + b, 0) / speeds.length).toFixed(1);
        }
      }
    }

    // Test mode: send only to a single address, skip subscriber list
    const testEmail = req.body?.testEmail;
    if (testEmail) {
      const { subject, html: htmlBody } = buildEmail(data, type, testEmail, { dayMiles, dayAvgSpeed, journalEntries });
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev", to: testEmail, subject: `[TEST] ${subject}`, html: htmlBody }),
      });
      return res.status(200).json({ ok: emailRes.ok, test: true, to: testEmail });
    }

    // Send Web Push to all subscribed browsers (independent of email list)
    const pct = ((parseFloat(data.routeMile) || 0) / TOTAL_MILES * 100).toFixed(1);
    const pushTitle = type === "morning" ? `☀️ Morning Update — Aaron` : `🌙 Evening Update — Aaron`;
    const nextStage = getNextStage(data.routeMile);
    const locationStr = nextStage ? `${nextStage.remaining} mi to ${nextStage.to}` : "approaching finish";
    const speedStr = data.movingAvgSpeed ? ` · avg ${data.movingAvgSpeed}` : "";
    const currentStr = data.currentSpeed ? ` · now ${data.currentSpeed}` : "";
    const pushBody = `Mile ${data.routeMile || "?"} · ${pct}% done · ${locationStr}${speedStr}${currentStr}`;
    const pushResult = await sendWebPush(pushTitle, pushBody).catch(() => ({ sent: 0, removed: 0 }));

    // Get subscribers and send emails
    const { data: subscribers } = await readFile("data/subscribers.json");
    const list = subscribers || [];
    if (list.length === 0) return res.status(200).json({ ok: true, sent: 0, pushSent: pushResult.sent });

    let sent = 0;
    for (const email of list) {
      const { subject, html: htmlBody } = buildEmail(data, type, email, { dayMiles, dayAvgSpeed, journalEntries });
      const emailRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
          to: email,
          subject,
          html: htmlBody,
        }),
      });
      if (emailRes.ok) sent++;
    }

    return res.status(200).json({ ok: true, sent, total: list.length, pushSent: pushResult.sent, pushRemoved: pushResult.removed });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
