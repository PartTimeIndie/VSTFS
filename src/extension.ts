import * as vscode from "vscode";
import { TFVC } from "./tfvc";
import { loadConfig } from "./config";
import { PendingChangesView } from "./views/pendingChangesView";
import { BranchesView } from "./views/branchesView";
import { HistoryView } from "./views/historyView";
import { ChangesetPanel } from "./ui/changesetPanel";
import * as path from "path";

let tfvc: TFVC;
let pendingView: PendingChangesView;
let branchesView: BranchesView;
let historyView: HistoryView;
let currentConfig: any;

export async function activate(ctx: vscode.ExtensionContext) {
  const cfg = await loadConfig(ctx.secrets);
  currentConfig = cfg;
  
  // Get the correct working directory - this should be the project folder, not the extension folder
  let workingDir: string;
  
  if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    // Use the first workspace folder (the project folder)
    workingDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
  } else if (cfg.root && cfg.root !== ".") {
    // Use the configured root path
    workingDir = cfg.root;
  } else {
    // Fallback to current working directory
    workingDir = process.cwd();
  }
  
  console.log(`VSTFS: Extension code location: ${__dirname}`);
  console.log(`VSTFS: Using working directory: ${workingDir}`);
  console.log(`VSTFS: Workspace folders: ${vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath).join(', ')}`);
  console.log(`VSTFS: Config root: ${cfg.root}`);
  console.log(`VSTFS: Process cwd: ${process.cwd()}`);
  
  const output = vscode.window.createOutputChannel("VSTFS");
  
  tfvc = new TFVC(cfg.tfPath, workingDir, process.env, cfg, output);

  const withBusy = async <T>(title: string, task: () => Promise<T>) => {
    try {
      return await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title }, async () => {
        output.appendLine(`[${new Date().toLocaleTimeString()}] ${title}`);
        const result = await task();
        return result;
      });
    } catch (e: any) {
      output.appendLine(String(e?.stack || e));
      vscode.window.showErrorMessage(e?.message || String(e));
      throw e;
    }
  };

  const reg = (cmd: string, fn: (...a: any[]) => any) => ctx.subscriptions.push(vscode.commands.registerCommand(cmd, fn));

  // Views
  pendingView = new PendingChangesView(tfvc);
  branchesView = new BranchesView(tfvc);
  historyView = new HistoryView(tfvc);

  ctx.subscriptions.push(
    vscode.window.registerTreeDataProvider("vstfs.pendingChanges", pendingView),
    vscode.window.registerTreeDataProvider("vstfs.branches", branchesView),
    vscode.window.registerTreeDataProvider("vstfs.history", historyView)
  );

  // Auto-refresh when views become visible
  const pendingTreeView = vscode.window.createTreeView("vstfs.pendingChanges", { treeDataProvider: pendingView });
  const branchesTreeView = vscode.window.createTreeView("vstfs.branches", { treeDataProvider: branchesView });
  const historyTreeView = vscode.window.createTreeView("vstfs.history", { treeDataProvider: historyView });

  ctx.subscriptions.push(
    pendingTreeView.onDidChangeVisibility(e => {
      if (e.visible) {
        pendingView.refresh();
      }
    }),
    branchesTreeView.onDidChangeVisibility(e => {
      if (e.visible) {
        branchesView.refresh();
      }
    }),
    historyTreeView.onDidChangeVisibility(e => {
      if (e.visible) {
        historyView.refresh();
      }
    })
  );

  // Refresh helpers for menus
  reg("vstfs.pendingChanges.refresh", () => pendingView.refresh());
  reg("vstfs.branches.refresh", () => branchesView.refresh());
  reg("vstfs.history.refresh", () => historyView.refresh());

  // Commands
  reg("vstfs.getLatest", () => withBusy("TFVC: Getting latest...", async () => {
    await tfvc.getLatest(".");
    pendingView.refresh();
    vscode.window.showInformationMessage("TFVC: Get Latest completed.");
  }));

  reg("vstfs.checkIn", async () => {
    // First, get the pending changes to show what will be checked in
    const pending = await tfvc.pendingChanges();
    if (pending.length === 0) {
      vscode.window.showInformationMessage("TFVC: No pending changes to check in.");
      return;
    }

    // Create file selection items with checkboxes
    const fileItems = pending.map(item => ({
      label: `${item.action}: ${item.file}`,
      description: item.file,
      action: item.action,
      file: item.file,
      picked: true // All files are selected by default
    }));

    // Show file selection dialog
    const selectedItems = await vscode.window.showQuickPick(fileItems, {
      canPickMany: true,
      placeHolder: "Select files to check in (uncheck to exclude)",
      title: `Check In - Select Files (${pending.length} pending changes)`
    });

    if (!selectedItems || selectedItems.length === 0) {
      vscode.window.showInformationMessage("TFVC: No files selected for check-in.");
      return;
    }

    // Show what will be checked in
    const fileList = selectedItems.map(item => `${item.action}: ${item.file}`).join('\n');
    const confirm = await vscode.window.showWarningMessage(
      `Check in the following ${selectedItems.length} selected changes?\n\n${fileList}`,
      { modal: true, detail: `Excluded ${pending.length - selectedItems.length} files from check-in.` },
      "Yes, Check In"
    );
    if (confirm !== "Yes, Check In") return;

    const comment = await vscode.window.showInputBox({ 
      prompt: "Check-in comment", 
      value: "",
      placeHolder: "Enter a description of your changes..."
    });
    if (comment === undefined) return;
    
    await withBusy("TFVC: Checking in...", async () => {
      // Check in only the selected files
      const selectedFiles = selectedItems.map(item => item.file);
      await tfvc.checkIn(comment, selectedFiles);
      pendingView.refresh();
      historyView.refresh();
      vscode.window.showInformationMessage(`TFVC: Check In completed for ${selectedItems.length} items.`);
    });
  });

  reg("vstfs.checkInAll", async () => {
    // Check in all pending changes without file selection
    const pending = await tfvc.pendingChanges();
    if (pending.length === 0) {
      vscode.window.showInformationMessage("TFVC: No pending changes to check in.");
      return;
    }

    const comment = await vscode.window.showInputBox({ 
      prompt: "Check-in comment", 
      value: "",
      placeHolder: "Enter a description of your changes..."
    });
    if (comment === undefined) return;
    
    await withBusy("TFVC: Checking in all changes...", async () => {
      await tfvc.checkIn(comment); // No file parameter = check in all
      pendingView.refresh();
      historyView.refresh();
      vscode.window.showInformationMessage(`TFVC: Check In completed for all ${pending.length} items.`);
    });
  });

  reg("vstfs.createBranch", async () => {
    const branches = await tfvc.listBranches().catch(() => []);
    const src = await vscode.window.showQuickPick(branches, { 
      placeHolder: "Select source branch (path)",
      title: "Create Branch - Source"
    });
    if (!src) return;
    const dst = await vscode.window.showInputBox({ 
      prompt: "Destination branch path", 
      value: "",
      placeHolder: "e.g., $/Project/Feature/NewFeature"
    });
    if (!dst) return;
    await withBusy(`TFVC: Creating branch ${dst} from ${src}...`, async () => {
      await tfvc.createBranch(src, dst);
      branchesView.refresh();
      vscode.window.showInformationMessage(`TFVC: Created branch ${dst}`);
    });
  });

  reg("vstfs.merge", async () => {
    const branches = await tfvc.listBranches().catch(() => []);
    const src = await vscode.window.showQuickPick(branches, { 
      placeHolder: "Select source branch",
      title: "Merge - Source Branch"
    });
    if (!src) return;
    const dst = await vscode.window.showQuickPick(branches, { 
      placeHolder: "Select target branch",
      title: "Merge - Target Branch"
    });
    if (!dst) return;
    await withBusy(`TFVC: Merging ${src} into ${dst}...`, async () => {
      await tfvc.merge(src, dst);
      vscode.window.showInformationMessage(`TFVC: Merge completed. Resolve conflicts if any.`);
    });
  });

  reg("vstfs.showHistory", async () => {
    const input = await vscode.window.showInputBox({ 
      prompt: "Show history for (file/folder path)",
      value: ".",
      placeHolder: "e.g., . (current folder) or specific file path"
    });
    if (input === undefined) return;
    await withBusy(`TFVC: Loading history for ${input}...`, async () => {
      await tfvc.history(input, 100);
      historyView.refresh();
    });
  });

  reg("vstfs.showChangeset", async (idArg?: number) => {
    let id: number | undefined = typeof idArg === "number" ? idArg : undefined;
    if (!id) {
      const input = await vscode.window.showInputBox({ 
        prompt: "Changeset ID to open",
        placeHolder: "e.g., 12345"
      });
      if (!input) return;
      id = Number(input);
    }
    await withBusy(`TFVC: Opening changeset C${id}...`, async () => {
      await ChangesetPanel.show(tfvc, id!);
    });
  });

  reg("vstfs.rollbackChangeset", async () => {
    const input = await vscode.window.showInputBox({ 
      prompt: "Rollback to changeset ID",
      placeHolder: "e.g., 12345"
    });
    if (!input) return;
    const id = Number(input);
    const confirm = await vscode.window.showWarningMessage(
      `Rollback to C${id}? This will stage a rollback (pending changes).`, 
      { modal: true }, 
      "Yes"
    );
    if (confirm !== "Yes") return;
    await withBusy(`TFVC: Rolling back to C${id}...`, async () => {
      await tfvc.rollbackToChangeset(id);
      pendingView.refresh();
      vscode.window.showInformationMessage(`TFVC: Rolled back to C${id}. Review and Check In.`);
    });
  });

  // New UI commands
  reg("vstfs.openFile", async (uri: vscode.Uri) => {
    if (uri) {
      await vscode.window.showTextDocument(uri, { preview: false });
    }
  });

  reg("vstfs.diffFile", async (uri: vscode.Uri) => {
    if (uri) {
      // Get the file at the previous version for diff
      const filePath = uri.fsPath;
      try {
        // This would need to get the previous version from TFVC
        vscode.window.showInformationMessage("Diff functionality requires TFVC integration. Use the changeset view instead.");
      } catch (e) {
        vscode.window.showErrorMessage(`Failed to get previous version: ${e}`);
      }
    }
  });

  reg("vstfs.revertFile", async (uri: vscode.Uri) => {
    if (uri) {
      const confirm = await vscode.window.showWarningMessage(
        `Revert ${path.basename(uri.fsPath)}? This will discard all local changes.`,
        { modal: true },
        "Yes"
      );
      if (confirm === "Yes") {
        try {
          await tfvc.getLatest(uri.fsPath);
          vscode.window.showInformationMessage(`Reverted ${path.basename(uri.fsPath)}. Remember to Check In.`);
          pendingView.refresh();
        } catch (e) {
          vscode.window.showErrorMessage(`Failed to revert file: ${e}`);
        }
      }
    }
  });

  reg("vstfs.refreshView", async () => {
    // Determine which view to refresh based on active view
    const activeView = vscode.window.activeTextEditor?.viewColumn;
    // For now, refresh all views
    pendingView.refresh();
    branchesView.refresh();
    historyView.refresh();
    vscode.window.showInformationMessage("VSTFS views refreshed.");
  });

  // Status bar
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.text = `TFVC: ${cfg.workspace || "workspace"}@${cfg.serverUrl || "server"}`;
  status.tooltip = "VSTFS configuration";
  status.command = "workbench.view.extension.vstfs";
  status.show();
  ctx.subscriptions.push(status);

  // Show welcome message
  vscode.window.showInformationMessage(
    "VSTFS Extension activated! Use the VSTFS icon in the activity bar to access TFVC features.",
    "Open VSTFS"
  ).then(selection => {
    if (selection === "Open VSTFS") {
      vscode.commands.executeCommand("workbench.view.extension.vstfs");
    }
  });
}

export function deactivate() {}
