import { readFile } from "./_github-store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const [{ data: emails }, { data: pushSubs }] = await Promise.all([
      readFile("data/subscribers.json"),
      readFile("data/push-subscriptions.json"),
    ]);
    const emailCount = (emails || []).length;
    const pushCount  = (pushSubs || []).length;
    return res.status(200).json({
      emailSubscribers: emailCount,
      pushSubscribers:  pushCount,
      total: emailCount + pushCount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
