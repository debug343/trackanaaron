export default async function handler(req, res) {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: "Missing name param" });

  try {
    const url = `https://trackleaders.com/6633ultra26i.php?name=${encodeURIComponent(name)}`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; tracker/1.0)",
        "Accept": "text/html",
      },
    });
    if (!response.ok) return res.status(response.status).json({ error: `Upstream returned ${response.status}` });
    const html = await response.text();
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(html);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
