import * as vscode from "vscode";
import { TFVC } from "../tfvc";

export class BranchesView implements vscode.TreeDataProvider<string> {
  private _emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._emitter.event;

  constructor(private tfvc: TFVC) {}
  refresh() { this._emitter.fire(); }

  getTreeItem(element: string): vscode.TreeItem {
    const item = new vscode.TreeItem(element, vscode.TreeItemCollapsibleState.None);
    item.iconPath = new vscode.ThemeIcon("git-branch");
    return item;
  }

  async getChildren(): Promise<string[]> {
    try {
      return await this.tfvc.listBranches();
    } catch (e: any) {
      vscode.window.showErrorMessage(`List branches failed: ${e.message || e}`);
      return [];
    }
  }
}
