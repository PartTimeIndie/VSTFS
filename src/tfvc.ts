import { execFile } from "node:child_process";
import * as vscode from "vscode";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";

export interface TFHistoryItem {
  changesetId: number;
  author: string;
  date: Date;
  comment: string;
  files: { path: string; change: string }[];
}

export interface TFPendingItem {
  file: string;
  action: "edit" | "add" | "delete" | "rename" | "merge" | "unknown";
}

export interface VstfsConfig {
  serverUrl: string;
  project: string;
  workspace: string;
  tfPath: string;
  root: string;
  serverPath: string; // Add server path for TFVC operations
  authType: "integrated";
  auth: { type: "integrated" };
}

export class TFVC {
  constructor(
    private tfPath: string, 
    private cwd: string, 
    private env: NodeJS.ProcessEnv,
    private config?: VstfsConfig,
    private output?: vscode.OutputChannel
  ) {
    this.log(`VSTFS: TFVC initialized with:`);
    this.log(`  - tfPath: ${tfPath}`);
    this.log(`  - cwd: ${cwd}`);
    this.log(`  - serverUrl: ${config?.serverUrl}`);
    this.log(`  - workspace: ${config?.workspace}`);
  }

  private log(message: string) {
    if (this.output) {
      this.output.appendLine(message);
    }
    console.log(message);
  }

  private getCollectionUrl(): string {
    const raw = this.config?.serverUrl?.trim() || "";
    try {
      const u = new URL(raw);
      const host = `${u.protocol}//${u.host}`;
      const hostname = u.hostname.toLowerCase();
      if (hostname === "dev.azure.com") {
        const segs = u.pathname.split("/").filter(Boolean);
        const org = segs[0] || "";
        return org ? `${host}/${org}` : host;
      }
      // For *.visualstudio.com keep only host part
      if (hostname.endsWith(".visualstudio.com")) {
        return host;
      }
      return host + (u.pathname === "/" ? "" : u.pathname);
    } catch {
      return raw.replace(/\/$/, "");
    }
  }

  // Detect TFVC authentication failures
  private isAuthError(message: string): boolean {
    const m = (message || "").toLowerCase();
    return (
      m.includes("tf30063") ||
      m.includes("not authorized") ||
      m.includes("unauthorized") ||
      m.includes("401")
    );
  }

  // Trigger TFVC sign-in UI by calling a command that requires auth
  public async signIn(): Promise<void> {
    if (!this.config?.serverUrl) {
      throw new Error("VSTFS: serverUrl is not configured. Set 'vstfs.serverUrl' in settings.");
    }
    const collection = this.getCollectionUrl();
    this.log(`VSTFS: Initiating sign-in for collection ${collection}`);
    try {
      await this.execVisibleOnce(["workspaces", `/collection:${collection}`]);
    } catch (e) {
      // Even if this command returns non-zero, the sign-in dialog may have been shown.
      this.log(`VSTFS: Sign-in helper returned error (continuing): ${String(e)}`);
    }
  }

  private execOnce(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        this.tfPath,
        args,
        { cwd: this.cwd, env: this.env, windowsHide: true, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || stdout || String(err)).toString();
            return reject(new Error(msg));
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }

  // Same as execOnce but with windowsHide:false so auth UI can appear
  private execVisibleOnce(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        this.tfPath,
        args,
        { cwd: this.cwd, env: this.env, windowsHide: false, maxBuffer: 32 * 1024 * 1024 },
        (err, stdout, stderr) => {
          if (err) {
            const msg = (stderr || stdout || String(err)).toString();
            return reject(new Error(msg));
          }
          resolve({ stdout, stderr });
        }
      );
    });
  }

  private async execWithAuthRetry(args: string[]): Promise<{ stdout: string; stderr: string }> {
    try {
      return await this.execOnce(args);
    } catch (e: any) {
      const msg = String(e?.message || e);
      if (this.isAuthError(msg) && this.config?.serverUrl) {
        this.log("VSTFS: Authentication required. Opening TFVC sign-in and retrying...");
        await this.signIn();
        // Retry once
        return await this.execOnce(args);
      }
      throw e;
    }
  }

  public toLocalPath(serverOrLocalPath: string): string {
    const cleaned = serverOrLocalPath.replace(/;C\d+$/i, "");
    // Already a local absolute path
    if (/^[A-Za-z]:\\/.test(cleaned)) return cleaned;

    // Server path under mapped serverPath → map to cwd
    if (this.config?.serverPath && cleaned.startsWith(this.config.serverPath)) {
      const rel = cleaned
        .substring(this.config.serverPath.length)
        .replace(/^\/?/, "")
        .replace(/\\/g, "/");
      return path.join(this.cwd, rel).replace(/\//g, "\\");
    }

    // Raw server path like $/...
    if (/^\$\//.test(cleaned)) {
      return path.join(this.cwd, cleaned.replace(/^\$\//, "").replace(/\\/g, "/")).replace(/\//g, "\\");
    }

    // Fallback: treat as relative to cwd
    return path.join(this.cwd, cleaned).replace(/\//g, "\\");
  }

  private logPending(label: string, items: TFPendingItem[]) {
    this.log(`${label}: ${items.length} item(s)`);
    for (const it of items) {
      this.log(` - ${it.action.toUpperCase()} ${it.file}`);
    }
  }

  private async ensureWorkspaceConfigured(): Promise<void> {
    if (!this.config?.serverUrl || !this.config?.workspace) {
      return; // Can't configure without these
    }

    try {
      // Check if current folder already has a mapping
      const { stdout: workfoldOutput } = await this.runBasic(["workfold"]);
      if (workfoldOutput.includes(this.cwd) || workfoldOutput.includes(this.config.workspace)) {
        return; // Already mapped/configured
      }

      // Attempt to map server path to local folder using workfold
      const serverPath = this.config?.serverPath || `$/Era/Prototypes/Overpowered`;

      await this.runBasic([
        "workfold",
        "/map",
        serverPath,
        this.cwd,
        "/workspace:" + this.config.workspace,
        "/collection:" + this.getCollectionUrl(),
      ]);

      console.log(`Successfully mapped ${serverPath} -> ${this.cwd} for workspace ${this.config.workspace}`);
    } catch (error) {
      console.warn("Failed to map existing workspace:", error);
      
      // If mapping fails, try to create a new workspace (fallback)
      try {
        // Create workspace (server-scoped by default) and then map
        await this.runBasic([
          "workspace",
          "/new",
          this.config.workspace,
          "/collection:" + this.getCollectionUrl(),
          "/location:server",
        ]);

        const serverPath = this.config?.serverPath || `$/Era/Prototypes/Overpowered`;

        await this.runBasic([
          "workfold",
          "/map",
          serverPath,
          this.cwd,
          "/workspace:" + this.config.workspace,
          "/collection:" + this.getCollectionUrl(),
        ]);

        console.log(`Created workspace ${this.config.workspace} and mapped ${serverPath} -> ${this.cwd}`);
      } catch (createError) {
        console.error("Failed to create workspace:", createError);
        throw new Error(`Cannot configure TFVC workspace: ${createError}`);
      }
    }
  }

  private runBasic(args: string[]): Promise<{ stdout: string; stderr: string }> {
    this.log(`VSTFS: Running basic TF.exe with args: ${args.join(' ')}`);
    return this.execWithAuthRetry(args);
  }

  private async run(args: string[]): Promise<{ stdout: string; stderr: string }> {
    // Ensure workspace is configured before running any commands
    this.log(`VSTFS: Configuring workspace before running: ${args.join(' ')}`);
    await this.ensureWorkspaceConfigured();
    
    // Only add collection parameter to specific commands that support it
    const fullArgs = [...args];
    if (this.config?.serverUrl && this.shouldAddCollection(args[0])) {
      fullArgs.push("/collection:" + this.getCollectionUrl());
    }

    this.log(`VSTFS: Running TF.exe with args: ${fullArgs.join(' ')}`);
    this.log(`VSTFS: Working directory: ${this.cwd}`);
    this.log(`VSTFS: ServerPath: ${this.config?.serverPath}`);

    // Integrated Windows authentication is handled by the system
    return this.execWithAuthRetry(fullArgs);
  }

  // Only add collection parameter to commands that support it
  private shouldAddCollection(command: string): boolean {
    const collectionCommands = [
      'workspaces', 'workspace', 'configure', 'login', 'logout', 'permission',
      'status', 'history', 'changeset'
    ];
    return collectionCommands.includes(command);
  }

  // --- Core operations ---

  async getLatest(target: string = "."): Promise<void> {
    await this.run(["get", target, "/recursive"]);
  }

  async pendingChanges(): Promise<TFPendingItem[]> {
    // Try multiple approaches to detect pending changes
    this.log("VSTFS: Attempting to detect pending changes...");

    // 0) Detailed status first to avoid truncated table output
    try {
      const { stdout } = await this.runBasic([
        "status",
        "/recursive",
        "/format:detailed"
      ]);
      this.log(`VSTFS: Detailed status result (first 200): ${stdout.substring(0, 200)}...`);
      const detailed = parsePendingDetailed(stdout).map(it => ({
        action: it.action,
        file: this.toLocalPath(it.file)
      }));
      if (detailed.length > 0) {
        this.logPending("VSTFS: Pending (detailed)", detailed);
        this.log(`VSTFS: Found ${detailed.length} pending changes with detailed status`);
        return detailed;
      }
    } catch (e) {
      this.log(`VSTFS: Detailed status failed: ${e}`);
    }
    
    // First try: Simple status without user filter or collection (like Visual Studio)
    try {
      const { stdout } = await this.runBasic([
        "status",
        "/recursive",
        "/format:brief"
      ]);
      this.log(`VSTFS: Basic status result: ${stdout.substring(0, 200)}...`);
      const result = parsePending(stdout).map(it => ({ action: it.action, file: this.toLocalPath(it.file) }));
      if (result.length > 0) {
        this.logPending("VSTFS: Pending (basic)", result);
        this.log(`VSTFS: Found ${result.length} pending changes with basic status`);
        return result;
      }
    } catch (e) {
      this.log(`VSTFS: Basic status failed: ${e}`);
    }
    
    // Second try: Status with workspace context
    try {
      const { stdout } = await this.runBasic([
        "status",
        "/workspace:" + (this.config?.workspace || ""),
        "/recursive",
        "/format:brief"
      ]);
      this.log(`VSTFS: Workspace status result: ${stdout.substring(0, 200)}...`);
      const result = parsePending(stdout).map(it => ({ action: it.action, file: this.toLocalPath(it.file) }));
      if (result.length > 0) {
        this.logPending("VSTFS: Pending (workspace)", result);
        this.log(`VSTFS: Found ${result.length} pending changes with workspace status`);
        return result;
      }
    } catch (e) {
      this.log(`VSTFS: Workspace status failed: ${e}`);
    }
    
    // Third try: Original approach with collection
    try {
      const { stdout } = await this.run([
        "status",
        ".",
        "/recursive",
        "/format:brief",
        "/noprompt",
      ]);
      this.log(`VSTFS: Collection status result: ${stdout.substring(0, 200)}...`);
      const result = parsePending(stdout).map(it => ({ action: it.action, file: this.toLocalPath(it.file) }));
      this.logPending("VSTFS: Pending (collection)", result);
      this.log(`VSTFS: Found ${result.length} pending changes with collection status`);
      return result;
    } catch (e) {
      this.log(`VSTFS: Collection status failed: ${e}`);
      return [];
    }
  }

  async checkIn(comment: string, files?: string[]): Promise<void> {
    // Ensure newly added files are pended (like VS "Promote")
    try {
      await this.run(["add", ".", "/recursive", "/noprompt"]);
    } catch (e) {
      // Non-fatal if nothing to add
      this.log(`VSTFS: Auto-add before check-in: ${String(e)}`);
    }

    let args: string[] = ["checkin"]; 

    if (files && files.length > 0) {
      // Check in only the selected files
      args.push(...files);
      args.push(`/comment:${comment || ""}`);
      args.push("/noprompt");
    } else {
      // Check in all pending changes under the current directory
      args.push(".");
      args.push("/recursive");
      args.push(`/comment:${comment || ""}`);
      args.push("/noprompt");
    }

    await this.run(args);
  }

  async undo(items?: string[]): Promise<void> {
    if (items && items.length > 0) {
      await this.run(["undo", ...items, "/noprompt"]);
      return;
    }
    await this.run(["undo", ".", "/recursive", "/noprompt"]);
  }

  async listBranches(): Promise<string[]> {
    const item = this.config?.serverPath || this.cwd || ".";
    const { stdout } = await this.run(["branches", item]);
    return parseBranches(stdout);
  }

  async createBranch(src: string, dst: string): Promise<void> {
    await this.run(["branch", src, dst, "/recursive"]);
  }

  async merge(src: string, dst: string, options: { changesetFrom?: number; changesetTo?: number } = {}): Promise<void> {
    const args = ["merge", src, dst];
    if (options.changesetFrom && options.changesetTo) {
      args.push(`/version:C${options.changesetFrom}~C${options.changesetTo}`);
    }
    await this.run(args);
  }

  async resolve(): Promise<void> {
    // Simple resolve prompt to open built-in resolve, if available:
    try {
      await this.run(["resolve", "/auto:AutoMerge"]);
    } catch {
      // fallback: open a message
      vscode.window.showInformationMessage("Conflicts detected. Please run 'tf resolve' from terminal to handle manually.");
    }
  }

  async history(target: string = ".", max: number = 50): Promise<TFHistoryItem[]> {
    const item = target === "." ? (this.config?.serverPath || this.cwd || ".") : target;
    // Detailed format is easier to parse
    const { stdout } = await this.run(["history", item, "/recursive", "/format:detailed", `/stopafter:${max}`, "/noprompt"]);
    return parseHistory(stdout);
  }

  async changeset(id: number): Promise<TFHistoryItem | null> {
    // Use history in detailed format filtered to the specific changeset
    const item = this.config?.serverPath || this.cwd || ".";
    const { stdout } = await this.run([
      "history",
      item,
      "/recursive",
      "/format:detailed",
      "/noprompt",
      `/version:C${id}~C${id}`
    ]);
    const items = parseHistory(stdout);
    const match = items.find(h => h.changesetId === id) || items[0];
    return match || null;
  }

  async getFileAtChangeset(file: string, id: number): Promise<string> {
    // Normalize to local absolute path in working folder
    const localTarget = this.toLocalPath(file);
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `vstfs-C${id}-${path.basename(localTarget).replace(/[\\/:*?"<>|]/g, "_")}`);

    // Use tf view to get content at specific changeset
    const { stdout } = await this.run(["view", `${file};C${id}`, "/noprompt"]);

    // Ensure CRLF for Windows text files; write UTF-8
    const normalized = stdout.replace(/\r?\n/g, os.EOL);
    fs.writeFileSync(tmpFile, normalized, { encoding: "utf8" });
    return tmpFile;
  }

  async rollbackToChangeset(id: number): Promise<void> {
    await this.run(["rollback", `/changeset:C${id}`]);
  }

  async getPreviousChangesetIdForFile(file: string, currentId: number): Promise<number | null> {
    try {
      const { stdout } = await this.run([
        "history",
        file,
        "/format:detailed",
        "/stopafter:2",
        `/version:C1~C${currentId}`,
        "/noprompt"
      ]);
      const items = parseHistory(stdout)
        .filter(h => h.files.some(f => f.path.toLowerCase().includes(path.basename(file).toLowerCase())));
      if (items.length === 0) return null;
      // Results are typically newest-first; pick the first id < current if present, otherwise the second item
      const sorted = items.sort((a, b) => b.changesetId - a.changesetId);
      const firstBelow = sorted.find(h => h.changesetId < currentId);
      if (firstBelow) return firstBelow.changesetId;
      if (sorted.length >= 2) return sorted[1].changesetId;
      return null;
    } catch (e) {
      this.log(`VSTFS: Could not find previous changeset for ${file} at C${currentId}: ${String(e)}`);
      return null;
    }
  }
}

// --- Parsers (basic, adjust for your server locale/format) ---

function parseBranches(stdout: string): string[] {
  // Very loose parser; improve to match your tf output
  return stdout
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(l => l && !l.toLowerCase().includes("no items found"))
    .filter(l => !/^Branches:$/i.test(l));
}

function parsePendingDetailed(stdout: string): TFPendingItem[] {
  const lines = stdout.split(/\r?\n/);
  const items: TFPendingItem[] = [];
  let currentPath: string | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    // Start of an item block is typically a path line
    if (/^(\$\/|[A-Za-z]:\\)/.test(line)) {
      currentPath = line;
      continue;
    }

    // Capture change line for current item
    const changeMatch = line.match(/^change:\s*(add|edit|delete|rename|merge|branch)\b/i);
    if (changeMatch && currentPath) {
      items.push({ action: changeMatch[1].toLowerCase() as TFPendingItem["action"], file: currentPath });
      currentPath = null;
      continue;
    }

    // Reset on blank separator-like lines
    if (/^-{3,}/.test(line)) {
      currentPath = null;
      continue;
    }
  }

  return items;
}

function parsePending(stdout: string): TFPendingItem[] {
  // Parser for TF.exe status that tolerates wrapped table rows
  const rawLines = stdout.split(/\r?\n/);
  const lines = rawLines
    .map(l => l.replace(/\u0000/g, "").replace(/\s+$/g, "")) // strip NULs and trailing spaces
    .filter(l => l.trim().length > 0);

  const items: TFPendingItem[] = [];
  let currentServerFolder: string | null = null;
  let buffer = "";
  let pendingNameFragment: string | null = null;

  const tryParseRow = (row: string): TFPendingItem | null => {
    const trimmed = row.trim();

    // 3-column table: Name  Change  Local path (tolerate 1+ spaces before Change, 2+ before Local path)
    let table = trimmed.match(/^(.+?)\s{2,}([A-Za-z, ]+?)\s{2,}(.+)$/);
    if (!table) {
      table = trimmed.match(/^(.+?)\s{1,}([A-Za-z, ]+?)\s{2,}(.+)$/);
    }
    if (table) {
      const nameCol = table[1].trim();
      const changeCol = table[2].trim();
      const localCol = table[3].trim();

      const actionMatch = changeCol.match(/\b(add|edit|delete|rename|merge|branch)\b/i);
      const action = (actionMatch ? actionMatch[1] : "edit").toLowerCase() as TFPendingItem["action"];

      const file = /^[A-Za-z]:\\/.test(localCol)
        ? localCol
        : currentServerFolder
          ? `${currentServerFolder.replace(/\\/g, "/")}/${nameCol}`
          : nameCol;

      return { action, file };
    }

    // Alternate formats
    let m = trimmed.match(/^(add|edit|delete|rename|merge|branch)\s+(.+)$/i);
    if (m) return { action: m[1].toLowerCase() as TFPendingItem["action"], file: m[2].trim() };

    m = trimmed.match(/^(\$\/.*?);\s*(add|edit|delete|rename|merge|branch)\s*$/i);
    if (m) return { action: m[2].toLowerCase() as TFPendingItem["action"], file: m[1].trim() };

    m = trimmed.match(/^(.:\\[^-]+?)\s*-\s+(add|edit|delete|rename|merge|branch)\s*$/i);
    if (m) return { action: m[2].toLowerCase() as TFPendingItem["action"], file: m[1].trim() };

    return null;
  };

  for (const raw of lines) {
    const line = raw.trim();

    // Ignore headers and separators
    if (/^-{3,}/.test(line)) continue;
    if (/^File\s+name\s+Change\s+Local\s+path/i.test(line)) continue;
    if (/^There are no pending changes\.?$/i.test(line)) continue;
    if (/^(Collection|Workspace|User):/i.test(line)) continue;

    // Folder header like "$\/Era/..." (no double-space columns)
    if (/^\$\//.test(line) && !/\s{2,}/.test(line)) {
      currentServerFolder = line;
      buffer = ""; // reset any partial row
      pendingNameFragment = null;
      continue;
    }

    // Heuristic: single name fragment line (e.g., 'PigButcherBossContro...')
    if (!/\s{2,}/.test(line) && /\.(cs|asset|mat|png|jpg|prefab|meta)$/i.test(line.replace(/\.\.\.$/, ""))) {
      pendingNameFragment = line;
      continue;
    }

    // If we have a pending name and this line has 'ACTION   C:\path', pair them
    if (pendingNameFragment) {
      const m = line.match(/\b(add|edit|delete|rename|merge|branch)\b\s+([A-Za-z]:\\.+)$/i);
      if (m) {
        items.push({ action: m[1].toLowerCase() as TFPendingItem["action"], file: m[2].trim() });
        pendingNameFragment = null;
        continue;
      }
    }

    // Try to parse the line directly
    let parsed = tryParseRow(line);
    if (parsed) {
      items.push(parsed);
      buffer = "";
      pendingNameFragment = null;
      continue;
    }

    // Accumulate into buffer to handle wrapped rows
    buffer = buffer ? `${buffer} ${line}` : line;
    parsed = tryParseRow(buffer);
    if (parsed) {
      items.push(parsed);
      buffer = "";
      pendingNameFragment = null;
      continue;
    }

    // If buffer gets too long, flush to avoid runaway accumulation
    if (buffer.length > 500) {
      console.log(`VSTFS: Dropping oversized pending row buffer: ${buffer.substring(0, 120)}...`);
      buffer = "";
      pendingNameFragment = null;
    }
  }

  return items;
}

function parseHistory(stdout: string): TFHistoryItem[] {
  // Rough parser for /format:detailed blocks
  const blocks = stdout.split(/^-{5,}\s*$/m).map(b => b.trim()).filter(Boolean);
  const items: TFHistoryItem[] = [];
  for (const b of blocks) {
    const idMatch = b.match(/^\s*Changeset:\s*(\d+)/mi);
    const userMatch = b.match(/^\s*User:\s*(.+)$/mi);
    const dateMatch = b.match(/^\s*Date:\s*(.+)$/mi);
    const commMatch = b.match(/^\s*Comment:\s*([\s\S]*?)^\s*Items:/mi);
    const filesPart = b.split(/^\s*Items:\s*$/mi)[1] || "";

    const files: { path: string; change: string }[] = [];
    filesPart.split(/\r?\n/).forEach(line => {
      const fm = line.match(/^\s*(edit|add|delete|rename|merge)\s+(.*)$/i);
      if (fm) files.push({ change: fm[1], path: fm[2].trim() });
    });

    if (idMatch) {
      items.push({
        changesetId: Number(idMatch[1]),
        author: (userMatch?.[1] || "").trim(),
        date: new Date((dateMatch?.[1] || "").trim()),
        comment: (commMatch?.[1] || "").trim(),
        files
      });
    }
  }
  return items;
}
