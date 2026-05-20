// ============================================================
//  SHOPIFY → ALIEXPRESS DROPSHIPPING BOT
//  Gdy wpada zamówienie w Shopify → dostajesz email z linkiem
//  do złożenia zamówienia na AliExpress jednym kliknięciem.
// ============================================================
//
//  WYMAGANIA:
//    node >= 18
//    npm install express nodemailer crypto
//
//  URUCHOMIENIE:
//    node shopify-aliexpress-bot.js
//
// ============================================================

const express  = require("express");
const nodemailer = require("nodemailer");
const crypto   = require("crypto");

const app = express();
app.use(express.json({ verify: rawBodySaver }));

// ─── KONFIGURACJA ────────────────────────────────────────────
const CONFIG = {
  // Shopify webhook secret (z panelu Shopify → Settings → Notifications → Webhooks)
  SHOPIFY_SECRET: "TWOJ_SHOPIFY_WEBHOOK_SECRET",

  // Twój email — na który mają przychodzić powiadomienia
  NOTIFY_EMAIL: "twoj@email.com",

  // Link do produktu na AliExpress (zamień na właściwy)
  // Możesz też mapować wiele produktów — patrz sekcja MAPOWANIE niżej
  ALIEXPRESS_PRODUCT_URL: "https://www.aliexpress.com/item/NUMER_PRODUKTU.html",

  // Dane SMTP do wysyłki emaili (np. Gmail)
  SMTP: {
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: "twoj@gmail.com",
      pass: "haslo_aplikacji_gmail",   // Hasło aplikacji, nie zwykłe hasło!
    },
  },

  PORT: 3000,
};

// ─── MAPOWANIE SHOPIFY → ALIEXPRESS (opcjonalne) ─────────────
// Jeśli masz wiele produktów, dodaj je tutaj:
// klucz = nazwa produktu w Shopify (lub SKU), wartość = link AliExpress
const PRODUCT_MAP = {
  // "Nazwa produktu z Shopify": "https://www.aliexpress.com/item/XXX.html",
  // "SKU-001":                  "https://www.aliexpress.com/item/YYY.html",
};

// ─── HELPER: zapisz surowe ciało requestu do weryfikacji ─────
function rawBodySaver(req, res, buf) {
  req.rawBody = buf;
}

// ─── WERYFIKACJA PODPISU SHOPIFY ─────────────────────────────
function verifyShopifyWebhook(req) {
  const hmac = req.headers["x-shopify-hmac-sha256"];
  if (!hmac) return false;
  const digest = crypto
    .createHmac("sha256", CONFIG.SHOPIFY_SECRET)
    .update(req.rawBody)
    .digest("base64");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
}

// ─── BUDUJ LINK DO ALIEXPRESS Z DANYMI KLIENTA ───────────────
function buildAliExpressLink(order, productUrl) {
  // Jeśli produkt jest zmapowany po nazwie lub SKU — użyj go
  const firstItem = order.line_items?.[0];
  const mappedUrl =
    PRODUCT_MAP[firstItem?.name] ||
    PRODUCT_MAP[firstItem?.sku] ||
    productUrl;

  // AliExpress nie przyjmuje adresu w URL-u, ale możemy prefillować
  // dane w notatkach do zamówienia (musisz ręcznie wkleić adres)
  const params = new URLSearchParams({
    quantity: firstItem?.quantity || 1,
  });

  return `${mappedUrl}?${params.toString()}`;
}

// ─── WYŚLIJ EMAIL POWIADOMIENIOWY ─────────────────────────────
async function sendNotificationEmail(order) {
  const transporter = nodemailer.createTransport(CONFIG.SMTP);

  const customer = order.shipping_address || order.billing_address || {};
  const items    = order.line_items || [];
  const aliLink  = buildAliExpressLink(order, CONFIG.ALIEXPRESS_PRODUCT_URL);

  const itemsHtml = items
    .map(
      (i) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${i.name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${i.variant_title || "—"}</td>
        </tr>`
    )
    .join("");

  const html = `
<div style="font-family:sans-serif;max-width:600px;margin:auto">
  <h2 style="color:#222">Nowe zamówienie #${order.order_number}</h2>

  <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin-bottom:16px">
    <strong>Klient:</strong> ${customer.first_name || ""} ${customer.last_name || ""}<br>
    <strong>Adres:</strong> ${customer.address1 || ""}, ${customer.city || ""} ${customer.zip || ""}, ${customer.country || ""}<br>
    <strong>Email klienta:</strong> ${order.email || "—"}<br>
    <strong>Telefon:</strong> ${customer.phone || "—"}
  </div>

  <table style="width:100%;border-collapse:collapse;margin-bottom:16px">
    <thead>
      <tr style="background:#eee">
        <th style="padding:8px 12px;text-align:left">Produkt</th>
        <th style="padding:8px 12px">Ilość</th>
        <th style="padding:8px 12px;text-align:left">Wariant</th>
      </tr>
    </thead>
    <tbody>${itemsHtml}</tbody>
  </table>

  <div style="margin:24px 0;text-align:center">
    <a href="${aliLink}"
       style="background:#e62e04;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:16px;font-weight:bold">
      Zamów na AliExpress →
    </a>
  </div>

  <p style="color:#888;font-size:12px">
    Przy składaniu zamówienia wpisz adres klienta jako adres dostawy.<br>
    Zamówienie Shopify #${order.order_number} | ${new Date().toLocaleString("pl-PL")}
  </p>
</div>`;

  await transporter.sendMail({
    from: `"Sklep Bot" <${CONFIG.SMTP.auth.user}>`,
    to:   CONFIG.NOTIFY_EMAIL,
    subject: `Nowe zamówienie #${order.order_number} — złóż na AliExpress`,
    html,
  });

  console.log(`[OK] Email wysłany dla zamówienia #${order.order_number}`);
}

// ─── ENDPOINT WEBHOOKA ────────────────────────────────────────
app.post("/webhook/orders/create", async (req, res) => {
  // 1. Zweryfikuj podpis (ważne — bez tego ktoś może podrobić żądanie)
  if (!verifyShopifyWebhook(req)) {
    console.warn("[WARN] Nieprawidłowy podpis webhooka!");
    return res.status(401).send("Unauthorized");
  }

  // 2. Odpowiedz Shopify szybko (max 5 sek), resztę rób async
  res.status(200).send("OK");

  try {
    const order = req.body;
    console.log(`[INFO] Nowe zamówienie: #${order.order_number}`);
    await sendNotificationEmail(order);
  } catch (err) {
    console.error("[ERROR] Błąd wysyłki emaila:", err.message);
  }
});

// ─── TEST ENDPOINT (usuń na produkcji) ────────────────────────
app.get("/test", (req, res) => {
  res.send("Bot działa! Endpoint webhooka: POST /webhook/orders/create");
});

// ─── START ────────────────────────────────────────────────────
app.listen(CONFIG.PORT, () => {
  console.log(`Bot nasłuchuje na porcie ${CONFIG.PORT}`);
  console.log(`Webhook URL: http://TWOJ_SERWER:${CONFIG.PORT}/webhook/orders/create`);
});
