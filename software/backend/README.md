# F1 Lamp · Cloudflare Worker Backend + MongoDB

This backend serves as the secure relay between the **Web App (Cloudflare Pages)** and the **physical ESP8266 Lamp**.

## Features
- **Outbound Secure WebSocket Relay (`/api/device/ws`):** No router port forwarding required.
- **REST API (`/api/state`):** Reads and updates lamp state in real time.
- **MongoDB Atlas Integration:** Permanently stores lamp state and custom user presets via MongoDB Atlas Data API (Serverless HTTPS).
- **Pairing API (`/api/pair-code`):** Generates pairing credentials for one-time pairing.

## Configuration & Environment Variables

Configure via `wrangler.toml` or Cloudflare dashboard:
- `SERVICE_SECRET`: Secret token for ESP8266 handshake.
- `DEVICE_KEY`: Key identifier for device verification.
- `MONGODB_DATA_API_URL`: Your MongoDB Atlas App Services Data API endpoint (e.g. `https://data.mongodb-api.com/app/data-xxxx/endpoint/data/v1`).
- `MONGODB_DATA_API_KEY`: API Key generated from MongoDB Atlas.
- `MONGODB_DATABASE`: Database name (default `f1_lamp`).
- `MONGODB_DATA_SOURCE`: Cluster name (default `Cluster0`).

## Deployment to Cloudflare Workers

```bash
# 1. Install dependencies
npm install

# 2. Test locally
npm run dev

# 3. Deploy to Cloudflare Workers
npx wrangler deploy
```

