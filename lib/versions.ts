import type { components } from "../api/meta-api.v1.ts";
import {
  client,
  type MinecraftVersionDetails,
  type MinecraftVersionSummary,
  type NeoForgeVersionDetails,
  type NeoForgeVersionSummary,
} from "./meta-api.ts";

declare type schemas = components["schemas"];

export class VersionsApi {
  private minecraftVersionDetailsCache: Record<
    string,
    Promise<schemas["MinecraftVersionDetails"]>
  > = {};
  private neoforgeVersionDetailsCache: Record<
    string,
    Promise<schemas["NeoForgeVersionDetails"]>
  > = {};

  constructor() {}

  async getMinecraftVersions(): Promise<MinecraftVersionSummary[]> {
    const { data: minecraftVersions } = await client.GET(
      "/minecraft-versions/",
      {},
    );
    if (!minecraftVersions) {
      throw new Error("Failed to load Minecraft versions.");
    }
    console.info("Loaded %d Minecraft versions", minecraftVersions.length);
    return minecraftVersions;
  }

  async getNeoForgeVersions(): Promise<NeoForgeVersionSummary[]> {
    const { data: neoforgeVersion } = await client.GET(
      "/neoforge-versions/",
      {},
    );
    if (!neoforgeVersion) {
      throw new Error("Failed to load NeoForge versions.");
    }
    console.info("Loaded %d NeoForge versions", neoforgeVersion.length);
    return neoforgeVersion;
  }

  async getMinecraftDetails(version: string): Promise<MinecraftVersionDetails> {
    if (this.minecraftVersionDetailsCache[version]) {
      return this.minecraftVersionDetailsCache[version];
    }
    const versionPromise = client.GET(
      "/minecraft-versions/version/{versionId}/",
      {
        params: {
          path: {
            versionId: version,
          },
        },
      },
    );
    return (this.minecraftVersionDetailsCache[version] = versionPromise.then(
      (d) => {
        if (!d.data) {
          throw new Error(`Failed to load details for Minecraft ${version}`);
        }
        console.debug("Resolved version details for Minecraft %s", version);
        return d.data;
      },
    ));
  }

  async getNeoForgeDetails(version: string): Promise<NeoForgeVersionDetails> {
    if (this.neoforgeVersionDetailsCache[version]) {
      return this.neoforgeVersionDetailsCache[version];
    }
    const versionPromise = client.GET(
      "/neoforge-versions/version/{versionId}/",
      {
        params: {
          path: {
            versionId: version,
          },
        },
      },
    );
    return (this.neoforgeVersionDetailsCache[version] = versionPromise.then(
      (d) => {
        if (!d.data) {
          throw new Error(`Failed to load details for NeoForge ${version}`);
        }
        console.debug("Resolved version details for NeoForge %s", version);
        return d.data;
      },
    ));
  }
}
