# KINO

Dark web studio for image, video and music video. Static site; API at the proxy in config.js (/api/kino/*).

## Klipp (lång video → korta klipp)

`#/klipp`: ladda upp en lång video (max 200 MB / 30 min) eller klistra in en direktlänk till en videofil (inte YouTube). Servern (`/api/kino/klipp`) transkriberar med NVIDIA Whisper large-v3 / Parakeet, låter en NVIDIA-modell välja 3–6 klipp, och klipper, beskär (9:16 / 1:1 / 16:9) och bränner in textremsor. UI:t visar vilka modeller som faktiskt användes. Filer raderas efter ca en timme.
