import http from "node:http";
import crypto from "node:crypto";

const {
  USERS = "",
  SESSION_SECRET,
  UPSTREAM = "http://mediamtx:8888",
  STREAM_PATH = "live",
  PORT = "8080",
  SESSION_DAYS = "7",
  SITE_NAME = "Screenarr",
} = process.env;

const users = new Map(
  USERS.split(",").map((s) => s.trim()).filter((s) => s.includes(":"))
    .map((p) => [p.slice(0, p.indexOf(":")), p.slice(p.indexOf(":") + 1)]),
);
if (!users.size || !SESSION_SECRET) {
  console.error("Set USERS=name:password[,name2:password2] and SESSION_SECRET");
  process.exit(1);
}

const upstream = new URL(UPSTREAM);
const COOKIE = "watch_session";
const TTL = Number(SESSION_DAYS) * 86400 * 1000;
const sha = (s) => crypto.createHash("sha256").update(String(s)).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));
const sign = (v) => crypto.createHmac("sha256", SESSION_SECRET).update(v).digest("base64url");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function makeSession(user) {
  const v = `${Buffer.from(user).toString("base64url")}.${Date.now() + TTL}`;
  return `${v}.${sign(v)}`;
}

function readSession(req) {
  const raw = (req.headers.cookie || "").split(";").map((c) => c.trim())
    .find((c) => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const [u, exp, sig] = raw.slice(COOKIE.length + 1).split(".");
  if (!u || !exp || !sig || !safeEq(sig, sign(`${u}.${exp}`))) return null;
  if (Number(exp) < Date.now()) return null;
  const user = Buffer.from(u, "base64url").toString();
  return users.has(user) ? user : null;
}

// Login throttle: 8 failed attempts per IP per 10 minutes.
const fails = new Map();
const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;
function throttled(ip) {
  const f = fails.get(ip);
  if (f && f.reset < Date.now()) fails.delete(ip);
  return (fails.get(ip)?.count ?? 0) >= 8;
}
function recordFail(ip) {
  const f = fails.get(ip) ?? { count: 0, reset: Date.now() + 600000 };
  f.count++;
  fails.set(ip, f);
}

const cookieAttrs = (req) =>
  `Path=/; HttpOnly; SameSite=Lax${req.headers["x-forwarded-proto"] === "https" ? "; Secure" : ""}`;

const loginPage = (error = "") => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(SITE_NAME)}</title>
<style>
*{box-sizing:border-box}html,body{height:100%;margin:0}
body{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#f5f3ff;
background:#0b0714;display:grid;place-items:center;overflow:hidden}
.bg{position:fixed;inset:-20%;z-index:0;filter:blur(90px);opacity:.75;
background:radial-gradient(40% 40% at 25% 30%,#ff3d9a 0,transparent 70%),
radial-gradient(45% 45% at 78% 28%,#7c3aed 0,transparent 70%),
radial-gradient(50% 45% at 55% 85%,#ff8a3d 0,transparent 70%);
animation:drift 18s ease-in-out infinite alternate}
@keyframes drift{to{transform:translate3d(3%,-4%,0) rotate(8deg) scale(1.08)}}
.grid{position:fixed;inset:0;z-index:0;opacity:.18;
background-image:linear-gradient(#fff2 1px,transparent 1px),linear-gradient(90deg,#fff2 1px,transparent 1px);
background-size:44px 44px;mask-image:linear-gradient(transparent 35%,#000)}
.card{position:relative;z-index:1;width:min(92vw,400px);padding:36px 32px 30px;border-radius:22px;
background:rgba(18,12,32,.62);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
border:1px solid rgba(255,255,255,.14);box-shadow:0 30px 80px -20px rgba(0,0,0,.7)}
.live{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:700;letter-spacing:.18em;
text-transform:uppercase;color:#ffd1e8;padding:6px 11px;border-radius:999px;
background:rgba(255,61,154,.16);border:1px solid rgba(255,61,154,.4)}
.dot{width:7px;height:7px;border-radius:50%;background:#ff3d9a;box-shadow:0 0 12px #ff3d9a;animation:pulse 1.6s infinite}
@keyframes pulse{50%{opacity:.35}}
h1{margin:18px 0 6px;font-size:26px;letter-spacing:-.02em;
background:linear-gradient(90deg,#fff,#ffc9a3 60%,#ff8fc7);-webkit-background-clip:text;background-clip:text;color:transparent}
p{margin:0 0 24px;color:#b9b0d0;font-size:14px}
label{display:block;font-size:12px;font-weight:600;color:#cfc6e6;margin:0 0 7px}
input{width:100%;padding:13px 14px;margin:0 0 16px;border-radius:12px;font:inherit;color:#fff;
background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);outline:none;transition:.15s}
input:focus{border-color:#ff7ab8;box-shadow:0 0 0 4px rgba(255,61,154,.2);background:rgba(255,255,255,.09)}
button{width:100%;padding:13px;margin-top:6px;border:0;border-radius:12px;font:inherit;font-weight:700;color:#1a0b1f;
cursor:pointer;background:linear-gradient(90deg,#ff8a3d,#ff3d9a);transition:.15s}
button:hover{filter:brightness(1.1);transform:translateY(-1px)}button:active{transform:none}
.err{margin:0 0 16px;padding:10px 12px;border-radius:10px;font-size:13px;color:#ffd6d6;
background:rgba(255,70,70,.14);border:1px solid rgba(255,90,90,.4)}
@media (prefers-reduced-motion:reduce){.bg,.dot{animation:none}}
</style></head><body>
<div class="bg"></div><div class="grid"></div>
<form class="card" method="post" action="/login" autocomplete="on">
<span class="live"><span class="dot"></span>Private stream</span>
<h1>${esc(SITE_NAME)}</h1>
<p>Sign in to watch.</p>
${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
<label for="u">Username</label>
<input id="u" name="username" autocomplete="username" autocapitalize="none" required autofocus>
<label for="p">Password</label>
<input id="p" name="password" type="password" autocomplete="current-password" required>
<button type="submit">Watch the stream</button>
</form></body></html>`;

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body);
}

function proxy(req, res) {
  const headers = { ...req.headers, host: upstream.host };
  delete headers.cookie; // never hand the session cookie to the media server
  const up = http.request(
    { hostname: upstream.hostname, port: upstream.port || 80, method: req.method, path: req.url, headers },
    (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); },
  );
  up.on("error", () => {
    if (!res.headersSent) send(res, 502, "<h1>Stream server unreachable</h1>");
    else res.destroy();
  });
  req.pipe(up);
}

http.createServer((req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  const user = readSession(req);

  if (path === "/login" && req.method === "GET") {
    return user ? send(res, 303, "", { Location: "/" }) : send(res, 200, loginPage());
  }

  if (path === "/login" && req.method === "POST") {
    const ip = clientIp(req);
    if (throttled(ip)) return send(res, 429, loginPage("Too many attempts. Try again in a few minutes."));
    let body = "";
    req.on("data", (c) => { body += c; if (body.length > 4096) req.destroy(); });
    req.on("end", () => {
      const f = new URLSearchParams(body);
      const name = f.get("username") || "", pass = f.get("password") || "";
      const ok = users.has(name) && safeEq(pass, users.get(name));
      if (!ok) {
        recordFail(ip);
        console.log(`login failed for "${name}" from ${ip}`);
        return send(res, 401, loginPage("Wrong username or password."));
      }
      console.log(`login ok: ${name} from ${ip}`);
      send(res, 303, "", {
        Location: "/",
        "Set-Cookie": `${COOKIE}=${makeSession(name)}; Max-Age=${TTL / 1000}; ${cookieAttrs(req)}`,
      });
    });
    return;
  }

  if (path === "/logout") {
    return send(res, 303, "", { Location: "/login", "Set-Cookie": `${COOKIE}=; Max-Age=0; ${cookieAttrs(req)}` });
  }

  if (!user) {
    const wantsPage = (req.headers.accept || "").includes("text/html");
    return wantsPage ? send(res, 303, "", { Location: "/login" }) : send(res, 401, "");
  }

  if (path === "/") return send(res, 302, "", { Location: `/${STREAM_PATH}/` });
  proxy(req, res);
}).listen(Number(PORT), () => console.log(`gate on :${PORT} -> ${UPSTREAM}`));
