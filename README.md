# KINO

Dark web studio for image, video and music video. Static site; API at the proxy in config.js (/api/kino/*).

## Klipp (lång video → korta klipp)

`#/klipp`: ladda upp en lång video (max 200 MB / 30 min) eller klistra in en direktlänk till en videofil (inte YouTube). Servern (`/api/kino/klipp`) transkriberar med NVIDIA Whisper large-v3 / Parakeet, låter en NVIDIA-modell välja 3–6 klipp, och klipper, beskär (9:16 / 1:1 / 16:9) och bränner in textremsor. UI:t visar vilka modeller som faktiskt användes. Filer raderas efter ca en timme.

## Gratismotorer i bildväljaren

Bildväljaren visar riktiga modellnamn med små taggar: **AI Horde – <modell>** (`gratis`, `kö`, och `NSFW-läge` i NSFW-läget; köplats och beräknad väntetid visas med en Avbryt-knapp, timeout säger "upptagen/kö"), **Cloudflare FLUX.1 schnell / SDXL base / SDXL Lightning** (`gratis`, bara SFW, grå tills servern har nycklarna; "dagskvoten slut" när 10 000 neurons/dag är slut) och **Google Gemini (bild)** som är grå eftersom Google inte erbjuder gratis bildkvot (i stället finns "Förbättra med Gemini" för text när `GEMINI_API_KEY` är satt). Startsidans modelllista bygger på servern och visar samma taggar och ej aktiva motorer.

## Gör om klipp

`#/gor-om` (bara SFW): referensklipp (max 60 s) + upp till 5 egna bilder → ny video med samma klipp, tempo och ljud. Valfritt: en **kontrollvideo** i ReShot-stil (konturer, djupkarta eller skelett) som styr komposition och rörelse i nyckelbilderna.

Konturerna tas ut med ffmpeg på gratisservern. Djup och skelett kräver GPU; på Render används konturer som reserv. Det officiella Hugging Face-utrymmet är en visningssida, inte ett API.

Kontrollvideo inspirerad av [ReShot](https://github.com/maosika-ai/reshot) (Apache-2.0) av [Maosika 猫斯卡](https://www.maosika.com). KINO kopierar inte ReShots källkod.

Bild-till-video i automatiskt läge: **LTX-2.5 → LTX-2.3 → Wan 2.2 → Cosmos3-Nano → Kandinsky 6.0 → MiniMax H3**, sedan Ken Burns när kvoten är slut. Finns kontrollvideo väljs Wan 2.2 först (start- och slutruta). MiniMax H3:s community-licens undantar EU, Storbritannien, Sydkorea och USA.
