export default async function handler(req, res) {
  try {
    const response = await fetch("https://trackleaders.com/spot/6633ultra26/mainpoints.js", {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/javascript" },
    });
    if (!response.ok) return res.status(response.status).json({ error: "Upstream error" });
    const js = await response.text();

    // Build category + status maps keyed by marker variable name
    const categoryMap = {};
    const statusMap = {};
    const catRegex = /marker([A-Za-z_]+)\.mycategory\s*=\s*'([^']+)'/g;
    const statusRegex = /marker([A-Za-z_]+)\.mystatus\s*=\s*'([^']+)'/g;
    let m;
    while ((m = catRegex.exec(js)) !== null) categoryMap[m[1]] = m[2];
    while ((m = statusRegex.exec(js)) !== null) statusMap[m[1]] = m[2];

    // Extract bib, full name, route mile from tooltip text
    const tooltipRegex = /bindTooltip\("[^"]*\((\d+)\)\s+([^<"]+?)\s*<[^"]*at route mile\s+([\d.]+)/g;
    const athletes = [];
    while ((m = tooltipRegex.exec(js)) !== null) {
      const bib = m[1];
      const name = m[2].trim();
      const routeMile = parseFloat(m[3]);
      const markerKey = name.replace(/ /g, "_");
      const category = categoryMap[markerKey] || "";
      const status = statusMap[markerKey] || "";
      if (category === "Northern Lights Ultra") {
        athletes.push({ bib, name, routeMile, status });
      }
    }

    const total = athletes.length;
    const scratched = athletes.filter((a) => a.status !== "Active").length;

    // Keep only active for leaderboard sorting
    const active = athletes.filter((a) => a.status === "Active");
    active.sort((a, b) => b.routeMile - a.routeMile);

    const scratchedAthletes = athletes
      .filter((a) => a.status !== "Active")
      .sort((a, b) => b.routeMile - a.routeMile);

    const aaronIdx = active.findIndex(
      (a) => a.name.toLowerCase().includes("aaron") && a.name.toLowerCase().includes("rabinowitz")
    );

    return res.status(200).json({ athletes: active, scratchedAthletes, aaronRank: aaronIdx + 1, total, scratched, remaining: active.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
