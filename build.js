const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const output = path.join(root, "dist");
const apiUrl = (process.env.PUBLIC_API_URL || "http://localhost:3001").replace(/\/+$/, "");

if (process.env.VERCEL && !process.env.PUBLIC_API_URL) {
  throw new Error("Set PUBLIC_API_URL in Vercel to the deployed Node backend URL.");
}

let parsedApiUrl;
try {
  parsedApiUrl = new URL(apiUrl);
} catch {
  throw new Error("PUBLIC_API_URL must be an absolute http(s) URL.");
}

if (parsedApiUrl.protocol !== "http:" && parsedApiUrl.protocol !== "https:") {
  throw new Error("PUBLIC_API_URL must use http:// or https://.");
}
if (process.env.VERCEL && parsedApiUrl.protocol !== "https:") {
  throw new Error("PUBLIC_API_URL must use HTTPS when deploying to Vercel.");
}

fs.mkdirSync(output, { recursive: true });

for (const filename of ["index.html", "styles.css", "client.js", "calls.js"]) {
  fs.copyFileSync(path.join(root, filename), path.join(output, filename));
}

fs.copyFileSync(
  path.join(root, "node_modules", "socket.io", "client-dist", "socket.io.min.js"),
  path.join(output, "socket.io-client.js"),
);
fs.writeFileSync(
  path.join(output, "config.js"),
  `window.CHAT_CONFIG = ${JSON.stringify({ apiUrl })};\n`,
);

console.log(`Built static client for ${parsedApiUrl.origin}`);
