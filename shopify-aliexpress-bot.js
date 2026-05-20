const express = require("express");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
 
const app = express();
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
 
const SHOPIFY_SECRET = process.env.SHOPIFY_SECRET || "";
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || "";
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const ALIEXPRESS_URL = process.env.ALIEXPRESS_URL || "https://www.aliexpress.com";
const PORT = process.env.PORT || 3000;
 
function verifyShopifyWebhook(req) {
  if (!SHOPIFY_SECRET) return true;
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) return false;
  const digest = crypto.createHmac("sha256", SHOPIFY_SECRET).update(req.rawBody).digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}
 
async function sendEmail(order) {
  const transporter = nodemailer.createTransport({
    port: 587,
secure: false,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
 
  const customer = order.shipping_address || order.billing_address || {};
  const items = order.line_items || [];
 
  const itemsHtml = items.map(i =>
    `<tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${i.name}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee">${i.variant_title || "—"}</td>
    </tr>`
  ).join("");
 
  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:auto">
  <h2 style="color:#222">Nowe zamówienie #${order.order_number}</h2>
  <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin-bottom:16px">
    <strong>Klient:</strong> ${customer.first_name || ""} ${customer.last_name || ""}<br>
    <strong>Adres:</strong> ${customer.address1 || ""}, ${customer.city || ""} ${customer.zip || ""}, ${customer.country || ""}<br>
    <strong>Email:</strong> ${order.email || "—"}<br>
    <strong>Telefon:</strong> ${customer.phone || "—"}
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <thead><tr style="background:#eee">
      <th style="padding:8px 12px;text-align:left">Produkt</th>
      <th style="padding:8px 12px">Ilość</th>
      <th style="padding:8px 12px;text-align:left">Wariant</th>
    </tr></thead>
    <tbody>${itemsHtml}</tbody>
  </table>
  <div style="margin:24px 0;text-align:center">
    <a href="${ALIEXPRESS_URL}" style="background:#e62e04;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">
      Zamów na AliExpress →
    </a>
  </div>
  <p style="color:#888;font-size:12px">Zamówienie #${order.order_number} | ${new Date().toLocaleString("pl-PL")}</p>
</div>`;
 
  await transporter.sendMail({
    from: `"Sklep Bot" <${SMTP_USER}>`,
    to: NOTIFY_EMAIL,
    subject: `Nowe zamówienie #${order.order_number} — złóż na AliExpress`,
    html,
  });
 
  console.log(`[OK] Email wysłany dla zamówienia #${order.order_number}`);
}
 
app.post("/webhook/orders/create", async (req, res) => {
  if (!verifyShopifyWebhook(req)) {
    console.warn("[WARN] Nieprawidłowy podpis!");
    return res.status(401).send("Unauthorized");
  }
  res.status(200).send("OK");
  try {
    await sendEmail(req.body);
  } catch (err) {
    console.error("[ERROR]", err.message);
  }
});
 
app.get("/test", (req, res) => {
  res.send("Bot działa!");
});
 
app.listen(PORT, () => {
  console.log(`Bot nasłuchuje na porcie ${PORT}`);
});
