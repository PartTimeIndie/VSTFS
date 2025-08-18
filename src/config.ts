import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

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

export async function loadConfig(secrets: vscode.SecretStorage): Promise<VstfsConfig> {
  const wsFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? ".";
  const jsonPath = path.join(wsFolder, ".vstfs.json");

  let fileConfig: Partial<VstfsConfig> = {};
  if (fs.existsSync(jsonPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to parse .vstfs.json: ${err}`);
    }
  }

  const cfg = vscode.workspace.getConfiguration("vstfs");

  // Default fallback path for TF.exe (your provided path)
  const defaultTfPath =
    "C:\\\\Program Files\\\\Microsoft Visual Studio\\\\2022\\\\Community\\\\Common7\\\\IDE\\\\CommonExtensions\\\\Microsoft\\\\TeamFoundation\\\\Team Explorer\\\\TF.exe".replace(/\\\\/g, "\\");

  // Always use integrated authentication
  const authType: "integrated" = "integrated";

  return {
    serverUrl: fileConfig.serverUrl || cfg.get<string>("serverUrl") || "",
    project: fileConfig.project || cfg.get<string>("project") || "",
    workspace: fileConfig.workspace || cfg.get<string>("workspace") || "",
    tfPath: (fileConfig.tfPath || cfg.get<string>("tfPath") || defaultTfPath),
    root: fileConfig.root || cfg.get<string>("root") || wsFolder,
    serverPath: fileConfig.serverPath || cfg.get<string>("serverPath") || `$/Era/Prototypes/Overpowered`,
    authType: authType,
    auth: { type: authType }
  };
}
