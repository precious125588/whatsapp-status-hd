# WhatsApp Status HD Converter — Deploy on Railway
1. Railway → New Project → Deploy from GitHub repo → pick this repo.
2. Railway reads nixpacks.toml: builds with NITRO_PRESET=node-server, starts `node .output/server/index.mjs`. PORT is set automatically.
3. Settings → Networking → Generate Domain.
4. Change `SITE` in src/routes/index.tsx to your Railway domain so link previews show the banner.
Powered by JUST X
