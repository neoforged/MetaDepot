import type { Middleware } from "openapi-fetch";
import createClient from "openapi-fetch";
import type { components, paths } from "../api/meta-api.v1.js";
import pLimit from "p-limit";

declare type schemas = components["schemas"];
export type MinecraftVersionSummary = schemas["MinecraftVersionSummary"];
export type NeoForgeVersionSummary = schemas["NeoForgeVersionSummary"];
export type MinecraftVersionDetails = schemas["MinecraftVersionDetails"];
export type NeoForgeVersionDetails = schemas["NeoForgeVersionDetails"];

let { META_API_BASE_URL, META_API_API_KEY, META_API_TOKEN } = process.env;

META_API_BASE_URL ??= "https://meta-api.neoforged.net/v1/";

if (!META_API_TOKEN && !META_API_API_KEY) {
  console.error(
    "Missing required environment variables: META_API_TOKEN or META_API_API_KEY",
  );
  process.exit(1);
}

// Adapt every method in client to be concurrency limited
const metaApiLimit = pLimit(10);

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    if (META_API_API_KEY) {
      request.headers.set("X-API-Key", META_API_API_KEY);
    } else if (META_API_TOKEN) {
      request.headers.set("Authorization", `Bearer ${META_API_TOKEN}`);
    }
    return metaApiLimit(() => fetch(request));
  },
  async onResponse({ request, response }) {
    if (response.status === 401) {
      throw new Error(
        "Authentication against API failed: " + (await response.text()),
      );
    } else if (response.status >= 400) {
      throw new Error(
        `Request for ${request.url} failed with status ${response.status}: ${await response.text()}`,
      );
    }
    return response;
  },
};

console.info("Meta-API Base URL: %s", META_API_BASE_URL);

const client = createClient<paths>({ baseUrl: META_API_BASE_URL });
client.use(authMiddleware);

export { client };
