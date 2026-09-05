// Agah Bey sitesine gelen her gerçek ziyarette (index.html'in sonundaki beacon script'i tarafından
// çağrılıyor) gerçek IP/konum bilgisiyle bir e-posta gönderir. Ne API anahtarı (RESEND_API_KEY) ne de
// alıcı e-posta adresi (NOTIFY_EMAIL) KOD İÇİNDE — repo public olduğu için ikisi de Netlify'ın kendi
// ortam değişkeni deposunda tutuluyor (kod içine yazsaydık herkes görebilirdi).

function isPrivateIp(ip) {
  return (
    !ip ||
    ip === "::1" ||
    ip === "127.0.0.1" ||
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)
  );
}

// Gerçek IP'den gerçek şehir/ülke — ip-api.com (ücretsiz, anahtarsız). Yerel/özel IP'lerde hiç
// çağrılmıyor, dürüstçe "Bilinmiyor" deniyor. API başarısız olursa alanlar "Bilinmiyor" kalır,
// uydurma şehir/ülke asla yazılmaz (kisisel-panel/server.mjs'teki aynı dürüstlük ilkesi).
async function describeLocation(ip) {
  if (isPrivateIp(ip)) {
    return { city: "Bilinmiyor (yerel ağ)", region: null, country: null, isp: null, ip: ip || "IP yok" };
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://ip-api.com/json/${ip}?fields=status,country,city,regionName,isp,query`, { signal: controller.signal });
    clearTimeout(timeout);
    const data = await res.json();
    if (data.status === "success") {
      return { city: data.city || "Bilinmiyor", region: data.regionName || null, country: data.country || null, isp: data.isp || null, ip };
    }
    return { city: "Bilinmiyor", region: null, country: null, isp: null, ip };
  } catch {
    return { city: "Bilinmiyor", region: null, country: null, isp: null, ip };
  }
}

export default async (req, context) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.NOTIFY_EMAIL;
  if (!apiKey || !notifyEmail) {
    console.error("RESEND_API_KEY veya NOTIFY_EMAIL tanımlı değil — bildirim gönderilemedi.");
    return new Response(JSON.stringify({ ok: false, error: "not-configured" }), { status: 200, headers: { "content-type": "application/json" } });
  }

  // Repo public olduğu için bu URL kod içinde herkese görünür — rastgele bot/tarayıcı taramalarının
  // e-posta kotasını tüketmesini zorlaştırmak için (kesin bir güvenlik sınırı değil, Origin sahtelenebilir,
  // ama sıradan otomatik taramaları eler) sadece agahbey.com'dan gelen isteklere devam ediyoruz.
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (origin && !origin.includes("agahbey.com")) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden-origin" }), { status: 200, headers: { "content-type": "application/json" } });
  }

  const ip = context.ip || req.headers.get("x-nf-client-connection-ip") || null;
  const userAgent = req.headers.get("user-agent") || "bilinmiyor";
  const referrer = req.headers.get("referer") || "doğrudan (referrer yok)";
  const now = new Date().toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" });

  const loc = await describeLocation(ip);
  const bolge = [loc.region, loc.country].filter(Boolean).join(", ") || "Bilinmiyor";

  // fetch() Resend 4xx/5xx dönse bile EXCEPTION FIRLATMAZ (ör. geçersiz/süresi dolmuş API anahtarı) —
  // sadece ağ hatasını yakalamak yetmez, gerçek yanıt durumunu da kontrol edip loglamak gerekiyor,
  // yoksa anahtar bozulursa fonksiyon sessizce "başarılı" görünmeye devam eder (analiz ajanının bulgusu).
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Agah Bey Sitesi <onboarding@resend.dev>",
        to: [notifyEmail],
        subject: `Agah Bey sitesine yeni ziyaretçi — ${loc.city}`,
        text: `Yeni bir ziyaretçi agahbey.com'a geldi.\n\nŞehir: ${loc.city}\nBölge/Ülke: ${bolge}\nInternet servis sağlayıcısı: ${loc.isp || "Bilinmiyor"}\nIP: ${loc.ip}\nTarayıcı: ${userAgent}\nGeldiği yer: ${referrer}\nZaman: ${now}`,
      }),
    });
    if (!res.ok) {
      console.error(`Resend hata döndü (${res.status}): ${await res.text()}`);
    }
  } catch (e) {
    console.error(`Resend'e gönderilemedi: ${e.message}`);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
};
