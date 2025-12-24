import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

export abstract class DepotManager {
  protected readonly publicBaseUrl: string;

  protected constructor(publicBaseUrl: string) {
    this.publicBaseUrl = publicBaseUrl;
  }

  async getJSON<T>(relativePath: string): Promise<T | undefined> {
    const content = await this.download(relativePath);
    if (!content) {
      return undefined;
    }
    return JSON.parse(content.toString("utf-8"));
  }

  abstract download(relativePath: string): Promise<Buffer | undefined>;

  abstract upload(relativePath: string, content: Buffer): Promise<void>;

  getPublicURL(relativePath: string): string {
    return url.resolve(this.publicBaseUrl, relativePath);
  }
}

class LocalDepotManager extends DepotManager {
  private readonly basePath: string;

  constructor(publicBaseUrl: string, basePath: string) {
    super(publicBaseUrl);
    this.basePath = basePath;
  }

  async download(relativePath: string): Promise<Buffer | undefined> {
    const p = path.join(this.basePath, relativePath);
    try {
      return await fs.readFile(p);
    } catch (e) {
      if (typeof e === "object" && e && "code" in e && e?.code === "ENOENT") {
        return undefined;
      }
      throw e;
    }
  }

  async upload(relativePath: string, content: Buffer): Promise<void> {
    const p = path.join(this.basePath, relativePath);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content);
  }
}

export interface WebDAVDepotConfig {
  publicBaseUrl: string;
  webdavUrl: string;
  token?: string;
}

export class WebDAVDepotManager extends DepotManager {
  private readonly webdavUrl: string;
  private readonly authHeader?: string;
  private readonly createdDirectories: Set<string>;

  constructor(config: WebDAVDepotConfig) {
    super(config.publicBaseUrl);
    this.webdavUrl = config.webdavUrl.endsWith("/")
      ? config.webdavUrl
      : config.webdavUrl + "/";

    if (config.token) {
      this.authHeader = `Bearer ${config.token}`;
    }

    this.createdDirectories = new Set<string>();
  }

  async download(relativePath: string): Promise<Buffer | undefined> {
    const fileUrl = new URL(relativePath, this.webdavUrl).toString();

    const headers: HeadersInit = {};
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }

    try {
      const response = await fetch(fileUrl, {
        method: "GET",
        headers,
      });

      if (response.status === 404) {
        return undefined;
      }

      if (!response.ok) {
        throw new Error(
          `WebDAV GET ${fileUrl} failed: ${response.status} ${response.statusText}`,
        );
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error: any) {
      // Network errors or other fetch failures
      if (
        error.cause?.code === "ENOTFOUND" ||
        error.cause?.code === "ECONNREFUSED"
      ) {
        throw new Error(`Cannot connect to WebDAV server: ${this.webdavUrl}`);
      }
      throw error;
    }
  }

  async upload(relativePath: string, content: Buffer): Promise<void> {
    // Ensure parent directory exists
    const dirname = relativePath.substring(0, relativePath.lastIndexOf("/"));
    if (dirname) {
      await this.ensureDirectoryExists(dirname);
    }

    const fileUrl = new URL(relativePath, this.webdavUrl).toString();

    const headers: HeadersInit = {
      "Content-Type": "application/octet-stream",
    };
    if (this.authHeader) {
      headers["Authorization"] = this.authHeader;
    }

    const response = await fetch(fileUrl, {
      method: "PUT",
      headers,
      body: new Blob([content]),
    });

    if (!response.ok) {
      throw new Error(
        `WebDAV PUT failed: ${response.status} ${response.statusText}`,
      );
    }
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    // Check if we've already created this directory
    if (this.createdDirectories.has(dirPath)) {
      return;
    }

    const parts = dirPath.split("/").filter((p) => p.length > 0);
    let currentPath = "";

    for (const part of parts) {
      currentPath += part + "/";

      // Skip if we've already created this path
      if (this.createdDirectories.has(currentPath)) {
        continue;
      }

      const dirUrl = new URL(currentPath, this.webdavUrl).toString();

      const headers: HeadersInit = {};
      if (this.authHeader) {
        headers["Authorization"] = this.authHeader;
      }

      const response = await fetch(dirUrl, {
        method: "MKCOL",
        headers,
      });

      // 201 = created, 405 = already exists, both are fine
      if (response.status === 201 || response.status === 405) {
        this.createdDirectories.add(currentPath);
      } else {
        throw new Error(
          `WebDAV MKCOL failed: ${response.status} ${response.statusText}`,
        );
      }
    }
  }
}

export function createDepot(): DepotManager {
  const {
    LOCAL_DEPOT_PATH,
    DEPOT_MANAGER_TOKEN,
    DEPOT_MANAGER_BASE_URL,
    DEPOT_BASE_URL,
  } = process.env;

  if (!DEPOT_BASE_URL) {
    throw new Error(
      "Missing environment variable with depot base url: DEPOT_BASE_URL",
    );
  }

  if (LOCAL_DEPOT_PATH) {
    return new LocalDepotManager(DEPOT_BASE_URL, LOCAL_DEPOT_PATH);
  } else {
    if (!DEPOT_MANAGER_TOKEN) {
      throw new Error(
        "Missing environment variable with token for depot manager: DEPOT_MANAGER_TOKEN",
      );
    }

    if (!DEPOT_MANAGER_BASE_URL) {
      throw new Error(
        "Missing environment variable with base URL for depot manager: DEPOT_MANAGER_BASE_URL",
      );
    }

    return new WebDAVDepotManager({
      publicBaseUrl: DEPOT_BASE_URL,
      webdavUrl: DEPOT_MANAGER_BASE_URL,
      token: DEPOT_MANAGER_TOKEN,
    });
  }
}
