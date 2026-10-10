const ClientType = Object.freeze({
  WEB: 'web',
  MOBILE: 'mobile',
  UNKNOWN: 'unknown',
});

// Native Kotlin/Android HTTP stacks: OkHttp/Retrofit ("okhttp/4.12.0"), Ktor ("Ktor client"),
// the default Android runtime agents ("Dalvik/2.1.0", "Apache-HttpClient/UNAVAILABLE").
const MOBILE_USER_AGENT_REGEX = /\b(okhttp|retrofit|ktor|dalvik|apache-httpclient)\b/i;

// Browsers (and the Next.js browser bundle) all start with "Mozilla/5.0".
const BROWSER_USER_AGENT_REGEX = /^mozilla\//i;

// Next.js server-side fetch (undici / node-fetch) is a server, not a browser or a phone.
const NODE_USER_AGENT_REGEX = /\b(node|undici|node-fetch)\b/i;

const normalizeOrigin = (origin) => (typeof origin === 'string' ? origin.trim().toLowerCase() : '');

const isAllowedOrigin = (origin, allowedOrigins) =>
  allowedOrigins === '*' || (Array.isArray(allowedOrigins) && allowedOrigins.includes(origin));

// Best-effort classification for logging/analytics ONLY. Both headers can be spoofed outside a
// browser, so the result must never be used for authentication or authorization.
//   1. Origin present and allowed (CORS_ORIGINS)  -> web (browsers set Origin; scripts cannot)
//   2. Origin present but not allowed             -> unknown (foreign site or spoofed header)
//   3. No Origin + OkHttp/Retrofit/Ktor/Dalvik UA -> mobile
//   4. No Origin + browser-like UA                -> web (same-origin request / navigation)
//   5. Anything else (curl, Node, empty UA, ...)  -> unknown
const detectClientType = ({ userAgent, origin, allowedOrigins } = {}) => {
  const normalizedOrigin = normalizeOrigin(origin);
  const ua = typeof userAgent === 'string' ? userAgent.trim() : '';

  if (normalizedOrigin) {
    return isAllowedOrigin(normalizedOrigin, allowedOrigins) ? ClientType.WEB : ClientType.UNKNOWN;
  }

  if (MOBILE_USER_AGENT_REGEX.test(ua)) return ClientType.MOBILE;
  if (BROWSER_USER_AGENT_REGEX.test(ua) && !NODE_USER_AGENT_REGEX.test(ua)) return ClientType.WEB;
  return ClientType.UNKNOWN;
};

module.exports = { ClientType, detectClientType };
