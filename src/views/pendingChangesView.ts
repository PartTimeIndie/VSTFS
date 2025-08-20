import * as vscode from "vscode";
import { TFVC, TFPendingItem } from "../tfvc";

export class PendingChangesView implements vscode.TreeDataProvider<TFPendingItem> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private tfvc: TFVC) {}

  refresh() { this._emitter.fire(); }

  getTreeItem(element: TFPendingItem): vscode.TreeItem {
    const item = new vscode.TreeItem(element.file, vscode.TreeItemCollapsibleState.None);
    
    // Set description with action type
    item.description = element.action.toUpperCase();
    
    // Set appropriate icon based on action
    switch (element.action) {
      case "add":
        item.iconPath = new vscode.ThemeIcon("add");
        break;
      case "delete":
        item.iconPath = new vscode.ThemeIcon("trash");
        break;
      case "rename":
        item.iconPath = new vscode.ThemeIcon("arrow-both");
        break;
      case "merge":
        item.iconPath = new vscode.ThemeIcon("git-merge");
        break;
      default:
        item.iconPath = new vscode.ThemeIcon("edit");
    }
    
    // Add context value for context menu
    item.contextValue = `pending-${element.action}`;

    // Set resource URI so context menu commands receive the file path
    item.resourceUri = vscode.Uri.file(element.file);
    item.tooltip = `${element.action.toUpperCase()} — ${element.file}`;
    
    // Command to open file
    item.command = {
      command: "vscode.open",
      title: "Open File",
      arguments: [vscode.Uri.file(element.file)]
    };
    
    return item;
  }

  async getChildren(): Promise<TFPendingItem[]> {
    try {
      return await this.tfvc.pendingChanges();
    } catch (e: any) {
      vscode.window.showErrorMessage(`Pending changes failed: ${e.message || e}`);
      return [];
    }
  }
}
