# KINO

Dark web studio for image, video and music video. Static site; API at the proxy in config.js (/api/kino/*).

## Klipp (lång video → korta klipp)

`#/klipp`: ladda upp en lång video (max 200 MB / 30 min) eller klistra in en direktlänk till en videofil (inte YouTube). Servern (`/api/kino/klipp`) transkriberar med NVIDIA Whisper large-v3 / Parakeet, låter en NVIDIA-modell välja 3–6 klipp, och klipper, beskär (9:16 / 1:1 / 16:9) och bränner in textremsor. UI:t visar vilka modeller som faktiskt användes. Filer raderas efter ca en timme.

## Gratismotorer i bildväljaren

Bildväljaren visar riktiga modellnamn med små taggar: **AI Horde – <modell>** (`gratis`, `kö`, och `NSFW-läge` i NSFW-läget; köplats och beräknad väntetid visas med en Avbryt-knapp, timeout säger "upptagen/kö"), **Cloudflare FLUX.1 schnell / SDXL base / SDXL Lightning** (`gratis`, bara SFW, grå tills servern har nycklarna; "dagskvoten slut" när 10 000 neurons/dag är slut) och **Google Gemini (bild)** som är grå eftersom Google inte erbjuder gratis bildkvot (i stället finns "Förbättra med Gemini" för text när `GEMINI_API_KEY` är satt). Startsidans modelllista bygger på servern och visar samma taggar och ej aktiva motorer.
