import * as vscode from "vscode";
import { TFVC, TFHistoryItem } from "../tfvc";

export class HistoryView implements vscode.TreeDataProvider<TFHistoryItem> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private tfvc: TFVC) {}
  refresh() { this._emitter.fire(); }

  getTreeItem(element: TFHistoryItem): vscode.TreeItem {
    // Create a more detailed label like Visual Studio
    const label = `C${element.changesetId} — ${element.author}`;
    
    // Show first line of comment and date in description
    const commentPreview = element.comment?.split(/\r?\n/)[0] || "No comment";
    const dateStr = element.date.toLocaleDateString() + " " + element.date.toLocaleTimeString();
    const desc = `${dateStr} • ${commentPreview}`;
    
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    item.description = desc;
    item.iconPath = new vscode.ThemeIcon("history");
    
    // Add context value for context menu
    item.contextValue = "history-changeset";
    
    // Command to open changeset details
    item.command = {
      command: "vstfs.showChangeset",
      title: "Open Changeset Details",
      arguments: [element.changesetId]
    };
    
    // Add tooltip with more details
    const tooltip = `Changeset C${element.changesetId}
Author: ${element.author}
Date: ${element.date.toLocaleString()}
Files: ${element.files.length}
Comment: ${element.comment || "No comment"}`;
    item.tooltip = tooltip;
    
    return item;
  }

  async getChildren(): Promise<TFHistoryItem[]> {
    try {
      return await this.tfvc.history(".", 100); // Show more history items
    } catch (e: any) {
      vscode.window.showErrorMessage(`History failed: ${e.message || e}`);
      return [];
    }
  }
}
