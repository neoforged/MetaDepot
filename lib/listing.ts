import path from "node:path";
import fs from "node:fs/promises";
import zlib from "node:zlib";
import { promisify } from "node:util";
import crypto from "node:crypto";
import zopfli from "node-zopfli";
import type { DepotManager } from "./depot.js";

const { FORMAT_OUTPUT } = process.env;

const brotliCompress = promisify(zlib.brotliCompress);
const gzipCompress = zopfli.gzip;

type CompressionType = "gzip" | "brotli";

export interface FileDescriptor {
  url: string;
  size: number;
  sha256: string;
}

export interface ListingDescriptor
  extends FileDescriptor, Record<CompressionType, FileDescriptor> {
  name: string;
  last_modified: string;
}

const compressionExtensions: Record<CompressionType, string> = {
  brotli: "br",
  gzip: "gz",
};

async function compress(buffer: Buffer): Promise<Map<CompressionType, Buffer>> {
  const compressed: [CompressionType, Promise<Buffer>][] = [
    ["brotli", brotliCompress(buffer)],
    ["gzip", gzipCompress(buffer)],
  ];
  const result = new Map<CompressionType, Buffer>();
  for (let [type, promise] of compressed) {
    result.set(type, await promise);
  }
  return result;
}

const DEPOT_INDEX_PATH = ".depot-index.json";

export class ListingsBuilder {
  private readonly destinationFolder: string;
  private readonly listings: Record<string, Promise<ListingDescriptor>> = {};
  private readonly referenceDate: string;

  constructor(destinationFolder: string) {
    this.destinationFolder = destinationFolder;
    this.referenceDate = new Date().toISOString();
  }

  private buildUrl(filename: string): string {
    return filename;
  }

  private buildFileDescriptor(
    filename: string,
    buffer: Buffer,
  ): FileDescriptor {
    return {
      url: this.buildUrl(filename),
      size: buffer.length,
      sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
    };
  }

  writeListing(
    name: string,
    content: object | Promise<object>,
  ): Promise<ListingDescriptor> {
    if (name in this.listings) {
      throw new Error(`Listing ${name} has already been written.`);
    }
    return (this.listings[name] = this.writeListingAsync(name, content));
  }

  private async writeListingAsync(
    name: string,
    content: object | Promise<object>,
  ): Promise<ListingDescriptor> {
    content = await content;

    const json = JSON.stringify(
      content,
      undefined,
      FORMAT_OUTPUT ? 2 : undefined,
    );
    const buffer = Buffer.from(json, "utf8");

    const jsonPath = path.join(this.destinationFolder, name + ".json");

    await fs.mkdir(path.dirname(jsonPath), { recursive: true });
    await fs.writeFile(jsonPath, buffer); // Write original JSON

    const compressed = await compress(buffer);

    for (const [type, content] of compressed) {
      await fs.writeFile(`${jsonPath}.${compressionExtensions[type]}`, content);
    }

    return {
      name,
      last_modified: this.referenceDate,
      ...this.buildFileDescriptor(`${name}.json`, buffer),
      brotli: this.buildFileDescriptor(
        `${name}.json.br`,
        compressed.get("brotli")!,
      ),
      gzip: this.buildFileDescriptor(
        `${name}.json.gz`,
        compressed.get("gzip")!,
      ),
    };
  }

  async finish() {
    await Promise.all(Object.values(this.listings));

    // Create the index
    const files = await Promise.all(Object.values(this.listings));
    await this.writeListingAsync("index", files);
  }

  async syncWithDepot(depot: DepotManager, fullResync: boolean) {
    let depotIndex = await depot.getJSON<ListingDescriptor[]>(DEPOT_INDEX_PATH);
    if (!depotIndex) {
      if (!fullResync) {
        console.info(
          "Depot is empty. Full resync required, pass --full-resync",
        );
        process.exit(1);
      }
      depotIndex = [];
    }

    // Index by listing name
    const existingListings = Object.fromEntries(
      depotIndex.map((e) => [e.name, e]),
    );

    const listings = await Promise.all(Object.values(this.listings));

    for (const listing of listings) {
      const existingListing = existingListings[listing.name];
      if (
        existingListing &&
        existingListing.sha256 === listing.sha256 &&
        existingListing.size === listing.size
      ) {
        console.debug(
          "Skipping upload of listing %s since it's sha256 checksum matches (%s)",
          name,
          existingListing.sha256,
        );
        continue;
      }

      const extensionsToUpload = [
        "json",
        ...Object.values(compressionExtensions).map((e) => `json.${e}`),
      ];
      for (const extension of extensionsToUpload) {
        const filename = `${listing.name}.${extension}`;
        await fs
          .readFile(path.join(this.destinationFolder, filename))
          .then((content) => depot.upload(filename, content))
          .then(() => console.info("Uploaded %s", filename));
      }
    }

    const newDepotIndex: ListingDescriptor[] = listings.slice();
    newDepotIndex.sort((a, b) => a.name.localeCompare(b.name));

    await depot.upload(
      DEPOT_INDEX_PATH,
      Buffer.from(JSON.stringify(newDepotIndex), "utf-8"),
    );
  }
}
