// Shared helpers for the customer app (dates in Asia/Baghdad, Arabic numerals, theme, install).
const TZ = "Asia/Baghdad";
const DAY = 86400e3;

const tm = (d) => new Date(d).toLocaleTimeString("ar-IQ", { timeZone: TZ, hour: "numeric", minute: "2-digit" });
const dayName = (d) => new Date(d).toLocaleDateString("ar-IQ", { timeZone: TZ, weekday: "short", day: "numeric", month: "numeric" });
const ar = (n) => Number(n).toLocaleString("ar-IQ");
const keyOf = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const dayStart = (key) => new Date(key + "T00:00:00+03:00").getTime();
function dur(ms){ const m = Math.max(0, Math.round(ms/60000)), h = Math.floor(m/60), dd = Math.floor(h/24);
  if (dd >= 2) return `${ar(dd)} يوم ${ar(h%24)} س`;
  return h ? `${ar(h)} س ${ar(m%60)} د` : `${ar(m)} د`; }
// "", "أمس ", "أول أمس ", "قبل N أيام "
function relDay(d){
  const diff = Math.round((dayStart(keyOf(new Date())) - dayStart(keyOf(new Date(d)))) / DAY);
  if (diff <= 0) return "";
  if (diff === 1) return "أمس ";
  if (diff === 2) return "أول أمس ";
  return `قبل ${ar(diff)} ${diff <= 10 ? "أيام" : "يومًا"} `;
}

// One row per day: day | 24h bar | number of national cuts | total national-off time.
// Bar colours: green = national grid, yellow = on the generator, red = no power.
// since = first report from the device, end = last moment we have data for (now, or last_seen).
function timelineRows(r, gridOffs, parts, since, end, now){
  const sFrom = dayStart(r.from), sTo = dayStart(r.to);
  const n = Math.min(Math.round((sTo - sFrom)/DAY) + 1, 62);
  const todayStart = dayStart(keyOf(new Date(now)));
  const seg = (k, a, z, dayS) => `<i class="${k}" style="right:${(a-dayS)/DAY*100}%;width:${(z-a)/DAY*100}%"></i>`;
  const rows = [];
  for (let i = 0; i < n; i++){
    const dayS = sTo - i*DAY, dayE = dayS + DAY, key = keyOf(new Date(dayS));
    let segs = "", offMs = 0, offCount = 0;
    const gS = Math.max(dayS, since), gE = Math.min(dayE, end);
    if (gE > gS) segs += seg("on", gS, gE, dayS);
    for (const p of parts){
      const a = Math.max(dayS, p.a), z = Math.min(dayE, p.z);
      if (z > a) segs += seg(p.k, a, z, dayS);
    }
    for (const o of gridOffs){
      const a = Math.max(dayS, new Date(o.started_at).getTime());
      const z = Math.min(dayE, o.ended_at ? new Date(o.ended_at).getTime() : end);
      if (z > a){ offMs += z - a; offCount++; }
    }
    const label = dayS === todayStart ? "اليوم" : dayName(dayS);
    rows.push(`<div class="tl-row" data-key="${key}"><span class="d">${label}</span><div class="bar">${segs}</div>`
      + `<span class="cnt${offCount ? "" : " z"}">${ar(offCount)}</span>`
      + `<span class="dsum">${offMs > 0 ? dur(offMs) : "٠"}</span></div>`);
  }
  return rows.join("");
}

// Day / night toggle (remembers the choice; follows the phone otherwise).
function setupTheme(btn){
  const root = document.documentElement;
  const prefersDark = () => window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
  const isDark = () => { const t = root.getAttribute("data-theme"); return t ? t === "dark" : prefersDark(); };
  function paint(){
    if (btn) btn.textContent = isDark() ? "☀️" : "🌙";
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute("content", isDark() ? "#0b1222" : "#eaf1fb");
  }
  try{ const s = localStorage.getItem("theme"); if (s === "dark" || s === "light") root.setAttribute("data-theme", s); }catch(e){}
  paint();
  if (btn) btn.addEventListener("click", () => {
    const d = !isDark();
    root.setAttribute("data-theme", d ? "dark" : "light");
    try{ localStorage.setItem("theme", d ? "dark" : "light"); }catch(e){}
    paint();
  });
  try{ matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (!root.getAttribute("data-theme")) paint(); }); }catch(e){}
}

// "Install as app" button: native prompt on Android/Chrome, written steps on iPhone.
function setupInstall(btn, sheet, title, body, close){
  const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  const ua = navigator.userAgent;
  const isIOS = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  let deferred = null;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  if (standalone()) return;
  btn.style.display = "";
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; });
  addEventListener("appinstalled", () => { btn.style.display = "none"; deferred = null; });
  btn.addEventListener("click", async () => {
    if (deferred){ deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; return; }
    title.textContent = "📲 تثبيت تطبيق «وطني ومولدة»";
    body.innerHTML = "<ol>" + (isIOS
      ? "<li>افتح الرابط في متصفح <b>Safari</b>.</li><li>اضغط زر المشاركة <b>⬆️</b> أسفل الشاشة.</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم <b>«إضافة»</b>.</li>"
      : "<li>افتح الرابط في متصفح <b>Chrome</b>.</li><li>اضغط قائمة <b>⋮</b> أعلى الشاشة.</li><li>اختر <b>«تثبيت التطبيق»</b> أو <b>«إضافة إلى الشاشة الرئيسية»</b>.</li>") + "</ol>";
    sheet.classList.add("show");
  });
  close.addEventListener("click", () => sheet.classList.remove("show"));
  sheet.addEventListener("click", (e) => { if (e.target === sheet) sheet.classList.remove("show"); });
}
