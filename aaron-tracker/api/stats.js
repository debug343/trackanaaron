import { readFile, writeFile } from "./_github-store.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    try {
      const [{ data: emails }, { data: pushSubs }, { data: state }] = await Promise.all([
        readFile("data/subscribers.json"),
        readFile("data/push-subscriptions.json"),
        readFile("data/notify-state.json"),
      ]);
      const emailCount = (emails || []).length;
      const pushCount  = (pushSubs || []).length;
      return res.status(200).json({
        emailSubscribers: emailCount,
        pushSubscribers:  pushCount,
        total:            emailCount + pushCount,
        restMode:         state?.restMode  ?? false,
        restNote:         state?.restNote  ?? "",
        restSince:        state?.restSince ?? null,
      });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.method === "POST") {
    const { password, restMode, restNote } = req.body || {};
    if (!password || password !== process.env.ADMIN_PASSWORD) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    try {
      const { data: state, sha } = await readFile("data/notify-state.json");
      const updated = {
        ...(state || {}),
        restMode:  !!restMode,
        restNote:  restNote || "",
        restSince: restMode ? new Date().toISOString() : null,
      };
      await writeFile("data/notify-state.json", updated, sha);
      return res.status(200).json({ ok: true, restMode: updated.restMode });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  return res.status(405).end();
}
