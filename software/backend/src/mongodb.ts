/**
 * ============================================================================
 * F1 Lamp — MongoDB Atlas Integration
 * ============================================================================
 * Uses MongoDB Atlas Data API (HTTPS REST) for native Cloudflare Workers
 * serverless execution without TCP connection pool exhaustion or timeouts.
 */

export interface Env {
  MONGODB_DATA_API_URL?: string; // e.g. https://data.mongodb-api.com/app/data-xxxx/endpoint/data/v1
  MONGODB_DATA_API_KEY?: string; // Atlas Data API Key
  MONGODB_DATA_SOURCE?: string;  // e.g. "Cluster0"
  MONGODB_DATABASE?: string;     // e.g. "f1_lamp"
  [key: string]: any;
}

export interface LampState {
  device: string;
  apiVersion: number;
  power: boolean;
  color: string;
  brightness: number;
  speed: number;
  effect: string;
  zones: boolean[];
  updatedAt?: string;
}

export interface Preset {
  id?: string;
  name: string;
  power: boolean;
  brightness: number;
  speed: number;
  effect: string;
  zones: boolean[];
  createdAt: string;
}

// In-memory fallback if MongoDB is not yet configured
let memoryState: LampState = {
  device: "F1-Lamp",
  apiVersion: 3,
  power: true,
  color: "#ff0000",
  brightness: 40,
  speed: 100,
  effect: "rev",
  zones: [true, true, true]
};

let memoryPresets: Preset[] = [
  {
    name: "Qualifying Red",
    power: true,
    brightness: 100,
    speed: 150,
    effect: "rev",
    zones: [true, true, true],
    createdAt: new Date().toISOString()
  },
  {
    name: "Night Pit Wall",
    power: true,
    brightness: 30,
    speed: 70,
    effect: "breathe",
    zones: [true, true, true],
    createdAt: new Date().toISOString()
  }
];

async function callMongo(env: Env, action: string, payload: any): Promise<any> {
  const url = env.MONGODB_DATA_API_URL;
  const apiKey = env.MONGODB_DATA_API_KEY;

  if (!url || !apiKey) {
    return null; // Fallback to memory
  }

  const endpoint = `${url.replace(/\/$/, "")}/action/${action}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-key": apiKey
    },
    body: JSON.stringify({
      dataSource: env.MONGODB_DATA_SOURCE || "Cluster0",
      database: env.MONGODB_DATABASE || "f1_lamp",
      ...payload
    })
  });

  if (!response.ok) {
    console.error(`MongoDB Data API error [${response.status}]:`, await response.text());
    return null;
  }

  return await response.json();
}

/**
 * Save / Upsert current state into MongoDB
 */
export async function saveLampState(env: Env, state: LampState): Promise<void> {
  memoryState = { ...state, updatedAt: new Date().toISOString() };

  await callMongo(env, "updateOne", {
    collection: "lamp_state",
    filter: { device: "F1-Lamp" },
    update: {
      $set: {
        ...memoryState
      }
    },
    upsert: true
  });
}

/**
 * Retrieve current state from MongoDB
 */
export async function getLampState(env: Env): Promise<LampState> {
  const result = await callMongo(env, "findOne", {
    collection: "lamp_state",
    filter: { device: "F1-Lamp" }
  });

  if (result && result.document) {
    return result.document as LampState;
  }

  return memoryState;
}

/**
 * Save custom preset to MongoDB
 */
export async function savePreset(env: Env, preset: Omit<Preset, "createdAt">): Promise<Preset> {
  const newPreset: Preset = {
    ...preset,
    createdAt: new Date().toISOString()
  };

  memoryPresets.push(newPreset);

  await callMongo(env, "insertOne", {
    collection: "presets",
    document: newPreset
  });

  return newPreset;
}

/**
 * List all saved presets from MongoDB
 */
export async function getPresets(env: Env): Promise<Preset[]> {
  const result = await callMongo(env, "find", {
    collection: "presets",
    sort: { createdAt: -1 }
  });

  if (result && Array.isArray(result.documents)) {
    return result.documents as Preset[];
  }

  return memoryPresets;
}

