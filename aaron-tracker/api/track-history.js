import { readFile } from "./github-store.js";

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).end();
  try {
    const { data } = await readFile("data/track-history.json");
    return res.status(200).json({ points: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
