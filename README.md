# iPhoneBooth

A self-hosted photo booth for iPhone + Mac, modeled on the Life4Cuts-style flow:
**size → frame → shoot → pick your best → filter → decorate → save / print**.
The Mac hosts it; the iPhone is the camera; any browser can be the print station.

## Run it

```bash
cd ~/iPhoneBooth
python3 server.py
```

Needs Python 3.11+ and `openssl` (both ship with macOS). The terminal prints the Mac
URL and the iPhone LAN URL — both devices must be on the same Wi-Fi.
HTTPS runs on **3443** (Safari requires it for the camera); **3080** redirects to it.
`python3 server.py --http` serves plain HTTP for Mac-only previews (iPhone camera won't work).

## The booth flow

| Step | What happens |
| --- | --- |
| Size | 4-cut strip · 2×2 card · 2-cut · Instant (single) — all print on 4×6 |
| Frame | 14 frames in three packs (Simple, Pattern, Film), previewed as real thumbnails |
| Shoot | Full-screen camera with a crop guide, countdown ring, flash, live shot rail. Takes 2 spare shots (6 for a 4-cut) |
| Pick | Tap shots to fill the strip; tap a box on the strip to clear it |
| Filter | Original, Mono, Noir, Retro, Film, Cool, Peach, Automat (colour-matrix filters, work on every iOS version) |
| Decorate | Draggable emoji stickers (pinch or corner handle to scale/rotate), crayon + eraser, caption, date toggle |
| Done | Save (share sheet / AirDrop), print from this device, send to the print station, booth video clip, lock-screen wallpaper, retake, new guests |

Kiosk touches: screen wake lock, idle reset after 90 s with a 15 s "Still there?" warning,
settings (countdown 3/5/10, shot gap, front/back camera, mirror, sounds, clip recording)
saved per device.

## First iPhone visit (certificate)

1. Open the LAN URL, tap **Show Details → visit this website**, allow the camera.
2. If the camera is still blocked: open `https://<mac-ip>:3443/api/cert`, install the
   profile, then enable **iPhoneBooth Local** in Settings → General → About →
   Certificate Trust Settings.
3. Share → **Add to Home Screen** for a full-screen booth.

## Print station

Open `/print` on the Mac attached to a 4×6 printer. New strips appear automatically;
flip **Auto-print** on for hands-free events. Print at 4×6, borderless, 100% scale —
4-cut strips print two-up, cut down the middle.

Strips are stored in `data/strips/` (gitignored); the oldest are pruned after 80.
