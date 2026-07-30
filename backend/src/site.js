/**
 * Single-server entry point.
 *
 * Runs MedChain as one process on one port, serving both the built React app
 * and the API. That makes it a real website rather than two dev servers: one
 * origin, no CORS, and the httpOnly refresh cookie works without exception.
 *
 *   cd frontend && npm run build      # produces frontend/dist
 *   cd backend  && npm run start:site # serves it on http://localhost
 *
 * Defaults are set here rather than in the npm script because `VAR=value cmd`
 * is not portable to Windows shells, and pulling in cross-env for four
 * assignments is not worth a dependency.
 *
 * `??=` is used deliberately: anything already present in the real environment
 * wins, so a host platform's own PORT is respected. dotenv also does not
 * override existing variables, so these take precedence over .env.
 */
process.env.SERVE_FRONTEND ??= "true";
process.env.NODE_ENV ??= "production";
process.env.PORT ??= "80";

/**
 * Left false by default: a `secure` cookie is silently dropped over plain
 * http, which would break sessions on a LAN demo. Set TRUST_TLS=true once the
 * app is genuinely behind https.
 */
process.env.TRUST_TLS ??= "false";

require("./server");
