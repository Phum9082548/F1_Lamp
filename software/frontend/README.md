# F1 Lamp · Web App Frontend (Cloudflare Pages)

Frontend Web Controller with real-time 3D Three.js lighting simulation based on `F1_Logo_Led_Lamp.3mf`.

## Directory Structure
- `index.html`: Clean HTML5 interface.
- `css/style.css`: F1 Telemetry racing dark theme.
- `js/app.js`: Main UI state management and network sync.
- `js/effects.js`: Mathematics of all 10 lighting effects.
- `js/viewer.js`: Three.js WebGL 3D renderer and custom diffuser shader.
- `js/model.json`: Mesh vertices and faces extracted from the 3D model.

## Deployment to Cloudflare Pages
- **Build command:** *(none required - pure static ES modules)*
- **Build output directory:** `.` (root of `software/frontend`)

