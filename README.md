# KINO

Dark web studio for image, video and music video. Static site; API at the proxy in config.js (/api/kino/*).

## Klipp (lång video → korta klipp)

`#/klipp`: ladda upp en lång video (max 200 MB / 30 min) eller klistra in en direktlänk till en videofil (inte YouTube). Servern (`/api/kino/klipp`) transkriberar med NVIDIA Whisper large-v3 / Parakeet, låter en NVIDIA-modell välja 3–6 klipp, och klipper, beskär (9:16 / 1:1 / 16:9) och bränner in textremsor. UI:t visar vilka modeller som faktiskt användes. Filer raderas efter ca en timme.

Med en renderingssession (Colab/Kaggle) igång transkriberas talet i stället med [WhisperX](https://github.com/m-bain/whisperX) (BSD-2) på sessionens GPU (`notebooks/kino_whisperx.py`, egen venv, large-v3 + forced alignment = riktiga ordtider även på svenska, valfri talaridentifiering med SpeechBrain ECAPA – inte pyannote, som kräver HF-token). Varje klipp får också **Följ den som pratar**-beskärning (ansikten + munrörelser), en **omslagsbild** och **publiceringstext** (titel, text, hashtags med Kopiera-knappar). Urval, talarföljning, omslag och publiceringstext är inspirerade av [AutoClip](https://github.com/zhouxiaoka/autoclip) (MIT, © 2024 AutoClip Team); ingen kod är kopierad.

## Gratismotorer i bildväljaren

Bildväljaren visar riktiga modellnamn med små taggar: **AI Horde – <modell>** (`gratis`, `kö`, och `NSFW-läge` i NSFW-läget; köplats och beräknad väntetid visas med en Avbryt-knapp, timeout säger "upptagen/kö"), **Cloudflare FLUX.1 schnell / SDXL base / SDXL Lightning** (`gratis`, bara SFW, grå tills servern har nycklarna; "dagskvoten slut" när 10 000 neurons/dag är slut) och **Google Gemini (bild)** som är grå eftersom Google inte erbjuder gratis bildkvot (i stället finns "Förbättra med Gemini" för text när `GEMINI_API_KEY` är satt). I NSFW-läget (18+, bara fiktiva personer) föreslås **Chroma1-HD** först för fotorealistiska stillbilder (reserv: Chroma), **WAI-NSFW-Illustrious v17** för anime och **Wan 2.2 I2V (10 s)** för video. Startsidans modelllista bygger på servern och visar samma taggar och ej aktiva motorer.

## Gör om klipp

`#/gor-om` (bara SFW): referensklipp (max 60 s) + upp till 5 egna bilder → ny video med samma klipp, tempo och ljud. Valfritt: en **kontrollvideo** i ReShot-stil (konturer, djupkarta eller skelett) som styr komposition och rörelse i nyckelbilderna.

Efter analysen visas typ per klipp (filmad, AI-genererad eller motion graphics, med konfidens), musikdelar (intro/vers/refräng/drop/outro) och om klippen sitter på takten, en hook-poäng för de första 3 sekunderna med tips, en genereringsplan efter vald motors maxlängd, och mer detaljerade prompter (lins, ljus, färg, stämning, sluttillstånd, negativ prompt). Du kan ladda ned en VIDEO.md-nedbrytning.

Nedbrytningen är inspirerad av [rea-video](https://github.com/JuneYaooo/rea-video) (Apache-2.0), [video-prompt-reverse-engineer](https://github.com/coolxxxx/video-prompt-reverse-engineer) (MIT), [video-breakdown](https://github.com/keng1304/video-breakdown) (MIT) och [video-teardown](https://github.com/RomanSlack/video-teardown) (MIT). KINO kör inte deras tunga modeller.

Konturerna tas ut med ffmpeg på gratisservern. Djup och skelett kräver GPU; på Render används konturer som reserv. Det officiella Hugging Face-utrymmet är en visningssida, inte ett API.

Kontrollvideo inspirerad av [ReShot](https://github.com/maosika-ai/reshot) (Apache-2.0) av [Maosika 猫斯卡](https://www.maosika.com). KINO kopierar inte ReShots källkod.

## Filmbibel, filmteam och kamerarörelse

`#/filmbibel` – en filmbibel per projekt (figurer med utseende/kläder, platser, palett/lins/ljus och regler) injiceras i varje tagning i Musikvideo, Mikrodrama, Gör om klipp och Snabbvideo. Filmteam-planering (regi → foto → scenografi → kontinuitet) bygger en shotlista ovanpå den vanliga tre-pass-planeringen. Kamerarörelse-förhandsvisning är en billig Ken Burns/CSS-animation i webbläsaren innan någon AI-rendering; rörelsen följer med i motorprompten.

Idéer (ingen kod kopierad, inga tunga pose/djup-modeller) från [Imagination Studio by keys+Wasserman](https://github.com/Keys-Wasserman/Imagination-Studio-by-keys-Wasserman) (Apache-2.0) och Sam Wassermans [Slate](https://github.com/wassermanproductions/slate)- och [Motion Previs Studio](https://github.com/wassermanproductions/motion-previs-studio)-flöden.


Bild-till-video i automatiskt läge: **LTX-2.5 → LTX-2.3 → Wan 2.2 → Cosmos3-Nano → Kandinsky 6.0 → MiniMax H3**, sedan Ken Burns när kvoten är slut. Finns kontrollvideo väljs Wan 2.2 först (start- och slutruta). MiniMax H3:s community-licens undantar EU, Storbritannien, Sydkorea och USA.

## Läppsynk

`#/lappsynk` och en valfri ruta i Musikvideo (`#/music`): en egen artistbild plus en låtdel blir ett sjungande klipp. Gratis på Hugging Face: **LongCat-Video-Avatar 1.6** (MIT), med **Kandinsky S2V 1.0** (MIT) och LTX-2 som reserv. Kräver samtycke; bara egna artister, persona eller KINO:s AI-figurer — aldrig kändisar. Vimoo 1.0 utvärderades men hade ingen fungerande publik Space och ingår därför inte i videokedjan.

## Renderingssession (Colab / Kaggle)

När du vill rendera många klipp: under **Inställningar** trycker du på **Starta renderingssession** och får en engångskod. Starta notebooken [kino_worker_colab.ipynb](https://colab.research.google.com/github/pistpejl/kino/blob/main/notebooks/kino_worker_colab.ipynb) (Öppna i Colab) eller importera [kino_worker_kaggle.ipynb](https://github.com/pistpejl/kino/blob/main/notebooks/kino_worker_kaggle.ipynb) på Kaggle (ett konto per person, för personligt bruk; GPU T4 eller P100, Internet On). Klistra in koden i cellen `PAIR_CODE` och kör. Workern **hämtar jobb från KINO-servern** (ingen tunnel, ingen ngrok). Statuspilen visar t.ex. `GPU-session: Colab T4 aktiv`. När notebooken stannar — efter några timmars gratis-GPU, inaktivitet, eller ca 60 s utan kontakt — faller KINO tillbaka på den vanliga Hugging Face-kedjan.

Modeller som får plats på 16 GB T4 (sm75): **LTX-Video 2B** (Lightricks, community license / AUP, bara SFW) och **Wan 2.1 1.3B** (Apache-2.0); **Wan 2.2 TI2V-5B** med CPU-offload i 480p kan gå. Workern använder fp16 och PyTorch SDPA — inte FlashAttention-2 eller FP8-kärnor. **Kandinsky S2V Lite** (läppsynk) körs inte på T4: dokumentationen anger ungefär 28 GB även med VAE-tiling. Workern tar bara SFW-jobb.

Uppskattade tider per ca 5 s-klipp i 480p (inte mätta i den här miljön, utifrån modellstorlek och vanliga rapporter): LTX-Video 2B typiskt 45–120 s; Wan 2.1 1.3B typiskt 1–3 min; Wan 2.2 TI2V-5B med offload typiskt 3–8 min. Den äldre Colab/Kaggle-panelen med trycloudflare-tunnel finns kvar för verktyg som LatentSync.

**Äkta läppsynk i sessionen: MuseTalk 1.5** (MIT, [TMElyralab/MuseTalk](https://github.com/TMElyralab/MuseTalk), fp16, ca 4–6 GB VRAM). Workern annonserar `musetalk` och `musetalk-alive`; servern skickar läppsynkjobb dit bara då (äldre workers med enbart LTX/Wan räknas inte längre som läppsynk, så HF-kedjan tar över). Under `#/lappsynk`: motor **Egen GPU: MuseTalk 1.5** och typ **Bara munnen** (still eller egen video) eller **Levande bild + läppsynk** (LTX-Video animerar bilden i ljudets längd, fram-och-tillbaka om ljudet är längre, VRAM töms, sedan MuseTalk och ljudet muxas). Musikvideons läppsynksruta använder levande bild + MuseTalk när en session är ansluten. Kod (låst commit) och vikter (~4 GB: MuseTalk 1.5 UNet, sd-vae-ft-mse, whisper-tiny, BiSeNet) hämtas lat — förhämtas i bakgrunden direkt efter parning. Upstreams DWPose/mmcv används inte; ansiktspunkterna kommer från `face-alignment` med samma beskärningsformel (`notebooks/kino_musetalk.py`). Faller sessionen eller saknar ansikte används HF-kedjan för stillbilder. Test utan GPU: `python3 notebooks/test_kino_musetalk.py`.


