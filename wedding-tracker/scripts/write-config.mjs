// Writes public/config.js from environment variables at build time.
// Vercel runs this via "npm run build" (see vercel.json).
import { writeFileSync, existsSync } from "node:fs";

const { SUPABASE_URL, SUPABASE_ANON_KEY, APP_NAME = "Wedding tracker" } = process.env;
const target = new URL("../public/config.js", import.meta.url);

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  if (existsSync(target) && !process.env.VERCEL) {
    console.log("No env vars set; keeping the existing public/config.js for local use.");
    process.exit(0);
  }
  console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY. Add them in Vercel → Project → Settings → Environment Variables, then redeploy.");
  process.exit(1);
}
if (!/^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL)) {
  console.warn(`SUPABASE_URL doesn't look like a Supabase project URL: ${SUPABASE_URL}`);
}

const config = { SUPABASE_URL: SUPABASE_URL.replace(/\/$/, ""), SUPABASE_ANON_KEY, APP_NAME };
writeFileSync(target, `window.APP_CONFIG = ${JSON.stringify(config, null, 2)};\n`);
console.log("Wrote public/config.js");
