import fs from "node:fs/promises";
import { VersionsApi } from "./lib/versions.ts";
import { ListingsBuilder } from "./lib/listing.ts";
import { buildMinecraftVersionsWithNeoForge, isSafePath } from "./lib/data.ts";
import { createDepot } from "./lib/depot.ts";

const cliOptions = {
  fullResync: process.argv.includes("--full-resync"),
};

const destinationFolder = "output";

const depot = createDepot();
const versions = new VersionsApi();
const minecraftVersions = await versions.getMinecraftVersions();
const neoforgeVersions = await versions.getNeoForgeVersions();

await fs.rm(destinationFolder, { recursive: true, force: true });
await fs.mkdir(destinationFolder);

const listingsBuilder = new ListingsBuilder(destinationFolder);

void listingsBuilder.writeListing(
  "minecraft-releases-with-neoforge",
  buildMinecraftVersionsWithNeoForge(versions, minecraftVersions, true),
);

void listingsBuilder.writeListing(
  "minecraft-versions-with-neoforge",
  buildMinecraftVersionsWithNeoForge(versions, minecraftVersions, false),
);

// Need to write out the individual NeoForge versions before we can continue
async function buildNeoForgeListing(version: string): Promise<object> {
  const details = await versions.getNeoForgeDetails(version);

  return {
    release_notes: details.release_notes,
  };
}

await Promise.all(
  neoforgeVersions.map(({ version }) => {
    if (!isSafePath(version)) {
      console.error(
        "Cannot build listing for %s since it's not a safe path name.",
        version,
      );
      return;
    }
    return buildNeoForgeListing(version).then((listing) =>
      listingsBuilder.writeListing("neoforge/" + version, listing),
    );
  }),
);

await listingsBuilder.finish();

await listingsBuilder.syncWithDepot(depot, cliOptions.fullResync);
