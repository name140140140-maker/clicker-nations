// Vercel Serverless Function: /api/whoami
// Повертає IP клієнта (з заголовків Vercel), приблизну геолокацію та провайдера/оператора.
// Використовується лише для адмін-інструментів гри (історія підключень гравця).

export default async function handler(req, res) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = xff || String(req.headers["x-real-ip"] || "") || req.socket?.remoteAddress || "";
  const dec = (v) => {
    try {
      return decodeURIComponent(String(v || ""));
    } catch {
      return String(v || "");
    }
  };
  const out = {
    ip,
    country: dec(req.headers["x-vercel-ip-country"]),
    region: dec(req.headers["x-vercel-ip-country-region"]),
    city: dec(req.headers["x-vercel-ip-city"]),
    isp: "",
    org: "",
    asn: "",
    type: "",
  };
  try {
    if (ip) {
      const r = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`);
      const j = await r.json();
      if (j && j.success !== false) {
        out.isp = j.connection?.isp || "";
        out.org = j.connection?.org || "";
        out.asn = j.connection?.asn ? "AS" + j.connection.asn : "";
        out.type = j.type || "";
        if (!out.country) out.country = j.country || "";
        if (!out.city) out.city = j.city || "";
        if (!out.region) out.region = j.region || "";
      }
    }
  } catch {
    /* провайдера не вдалося визначити — лишаємо порожнім */
  }
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
}
