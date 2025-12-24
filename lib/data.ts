import type { components as MetaDepotComponents } from "../api/meta-depot.v1.js";
import type { VersionsApi } from "./versions.js";
import type {
  MinecraftVersionDetails,
  MinecraftVersionSummary,
  NeoForgeVersionDetails,
} from "./meta-api.js";

declare type MetaDepotSchemas = MetaDepotComponents["schemas"];
declare type MinecraftWithNeoForgeVersionListing =
  MetaDepotSchemas["MinecraftWithNeoForgeVersionListing"];
declare type MinecraftWithNeoForgeVersion =
  MetaDepotSchemas["MinecraftWithNeoForgeVersion"];

export async function buildMinecraftVersionsWithNeoForge(
  versions: VersionsApi,
  minecraftVersions: MinecraftVersionSummary[],
  releasesOnly: boolean,
): Promise<MinecraftWithNeoForgeVersionListing> {
  type Details = [MinecraftVersionDetails, NeoForgeVersionDetails];
  const versionDetails: Details[] = await Promise.all(
    minecraftVersions
      .filter(
        (mv) =>
          (!releasesOnly || mv.type === "release") &&
          mv.latest_neoforge_version,
      )
      .map(fetchDetails),
  );

  async function fetchDetails(mv: MinecraftVersionSummary): Promise<Details> {
    return [
      await versions.getMinecraftDetails(mv.version),
      await versions.getNeoForgeDetails(mv.latest_neoforge_version!),
    ];
  }

  function makeVersionEntry([
    minecraft,
    neoforge,
  ]: Details): MinecraftWithNeoForgeVersion {
    return {
      version: minecraft.version,
      type: minecraft.type === "release" ? undefined : minecraft.type,
      released: minecraft.released,
      neoforge_version: neoforge.version,
      neoforge_released: neoforge.released,
    } satisfies Partial<MinecraftWithNeoForgeVersion> as MinecraftWithNeoForgeVersion;
  }

  const latestSnapshot = minecraftVersions.find(
    (v) => v.type === "snapshot" && v.latest_neoforge_version,
  );

  return {
    latestSnapshot: latestSnapshot
      ? makeVersionEntry(await fetchDetails(latestSnapshot))
      : undefined,
    versions: versionDetails.map(makeVersionEntry),
  };
}

export function isSafePath(version: string) {
  return !version.match(/[^0-9a-zA-Z_. -]/);
}
