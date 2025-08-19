import * as vscode from "vscode";
import { TFVC, TFHistoryItem } from "../tfvc";
import * as path from "path";
import * as fs from "fs";

export class ChangesetPanel {
  static current: ChangesetPanel | undefined;

  static async show(tfvc: TFVC, id: number) {
    const item = await tfvc.changeset(id);
    if (!item) {
      vscode.window.showWarningMessage(`Changeset ${id} not found.`);
      return;
    }
    const panel = vscode.window.createWebviewPanel(
      "vstfsChangeset",
      `Changeset C${id}`,
      vscode.ViewColumn.Active,
      { 
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    const instance = new ChangesetPanel(panel, tfvc, item);
    ChangesetPanel.current = instance;
  }

  private constructor(private panel: vscode.WebviewPanel, private tfvc: TFVC, private item: TFHistoryItem) {
    this.render();
    this.panel.webview.onDidReceiveMessage(async (msg) => {
      if (msg.type === "openFileAtVersion") {
        const serverPath = msg.file as string;
        const temp = await this.tfvc.getFileAtChangeset(serverPath, this.item.changesetId);
        vscode.window.showTextDocument(vscode.Uri.file(temp), { preview: true });
      } else if (msg.type === "diffWithPrevious") {
        const serverPath = msg.file as string;
        const prevId = await this.tfvc.getPreviousChangesetIdForFile(serverPath, this.item.changesetId);
        if (!prevId) {
          vscode.window.showWarningMessage(`No previous version found for ${path.basename(serverPath)} before C${this.item.changesetId}.`);
          return;
        }
        const prevTemp = await this.tfvc.getFileAtChangeset(serverPath, prevId);
        const thisTemp = await this.tfvc.getFileAtChangeset(serverPath, this.item.changesetId);
        vscode.commands.executeCommand(
          "vscode.diff",
          vscode.Uri.file(prevTemp),
          vscode.Uri.file(thisTemp),
          `C${prevId} ↔ C${this.item.changesetId}: ${path.basename(serverPath)}`
        );
      } else if (msg.type === "diffWithWorkspaceLatest") {
        const serverPath = msg.file as string;
        const workingLocal = this.tfvc.toLocalPath(serverPath);
        const temp = await this.tfvc.getFileAtChangeset(serverPath, this.item.changesetId);

        if (!fs.existsSync(workingLocal)) {
          vscode.window.showWarningMessage(`Working file not found: ${workingLocal}. Showing file from C${this.item.changesetId} only.`);
          vscode.window.showTextDocument(vscode.Uri.file(temp), { preview: true });
          return;
        }

        vscode.commands.executeCommand(
          "vscode.diff",
          vscode.Uri.file(temp),
          vscode.Uri.file(workingLocal),
          `C${this.item.changesetId} ↔ Working: ${path.basename(workingLocal)}`
        );
      } else if (msg.type === "revertFileToChangeset") {
        const serverPath = msg.file as string;
        // Minimal revert: fetch file at version and overwrite working copy
        const temp = await this.tfvc.getFileAtChangeset(serverPath, this.item.changesetId);
        const workingLocal = this.tfvc.toLocalPath(serverPath);
        await vscode.workspace.fs.copy(vscode.Uri.file(temp), vscode.Uri.file(workingLocal), { overwrite: true });
        vscode.window.showInformationMessage(`Reverted ${path.basename(workingLocal)} to C${this.item.changesetId}. Remember to Check In.`);
      }
    });
  }

  private render() {
    const filesRows = this.item.files.map(f => `
      <tr class="file-row">
        <td class="change-type ${f.change.toLowerCase()}">${escapeHtml(f.change.toUpperCase())}</td>
        <td class="file-path">${escapeHtml(f.path)}</td>
        <td class="actions">
          <button class="btn btn-primary" data-action="openFileAtVersion" data-file="${encodeURIComponent(f.path)}">
            <span class="icon">📄</span> Open
          </button>
          <button class="btn btn-secondary" data-action="diffWithPrevious" data-file="${encodeURIComponent(f.path)}">
            <span class="icon">🔍</span> Diff Prev
          </button>
          <button class="btn" data-action="diffWithWorkspaceLatest" data-file="${encodeURIComponent(f.path)}">
            <span class="icon">🆚</span> Diff Latest
          </button>
          <button class="btn btn-warning" data-action="revertFileToChangeset" data-file="${encodeURIComponent(f.path)}">
            <span class="icon">↩️</span> Revert
          </button>
        </td>
      </tr>
    `).join("");

    this.panel.webview.html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Changeset C${this.item.changesetId}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            margin: 0;
            padding: 20px;
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
          }
          .header {
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            padding: 20px;
            margin-bottom: 20px;
          }
          .header h2 {
            margin: 0 0 15px 0;
            color: var(--vscode-editor-foreground);
            font-size: 24px;
          }
          .header-info {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
          }
          .info-item {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .info-label {
            font-weight: 600;
            color: var(--vscode-descriptionForeground);
            min-width: 80px;
          }
          .info-value {
            color: var(--vscode-editor-foreground);
          }
          .comment-box {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 12px;
            margin-top: 15px;
            white-space: pre-wrap;
            font-family: inherit;
            color: var(--vscode-input-foreground);
          }
          .files-table {
            width: 100%;
            border-collapse: collapse;
            background: var(--vscode-panel-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 6px;
            overflow: hidden;
          }
          .files-table th {
            background: var(--vscode-panel-border);
            padding: 12px;
            text-align: left;
            font-weight: 600;
            color: var(--vscode-editor-foreground);
            border-bottom: 1px solid var(--vscode-panel-border);
          }
          .files-table td {
            padding: 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: middle;
          }
          .file-row:hover {
            background: var(--vscode-list-hoverBackground);
          }
          .change-type {
            font-weight: 600;
            text-align: center;
            min-width: 80px;
          }
          .change-type.add { color: #28a745; }
          .change-type.edit { color: #007bff; }
          .change-type.delete { color: #dc3545; }
          .change-type.rename { color: #ffc107; }
          .change-type.merge { color: #6f42c1; }
          .file-path {
            font-family: 'Consolas', 'Monaco', monospace;
            font-size: 13px;
            color: var(--vscode-editor-foreground);
          }
          .actions {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
          }
          .btn {
            border: none;
            border-radius: 4px;
            padding: 6px 12px;
            font-size: 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 4px;
            transition: all 0.2s;
            font-family: inherit;
          }
          .btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          .btn-primary {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
          }
          .btn-primary:hover {
            background: var(--vscode-button-hoverBackground);
          }
          .btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
          }
          .btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
          }
          .btn-warning {
            background: #ffc107;
            color: #212529;
          }
          .btn-warning:hover {
            background: #e0a800;
          }
          .icon {
            font-size: 14px;
          }
          .no-files {
            text-align: center;
            padding: 40px;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>Changeset C${this.item.changesetId}</h2>
          <div class="header-info">
            <div class="info-item">
              <span class="info-label">Author:</span>
              <span class="info-value">${escapeHtml(this.item.author)}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Date:</span>
              <span class="info-value">${this.item.date.toLocaleString()}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Files:</span>
              <span class="info-value">${this.item.files.length}</span>
            </div>
            <div class="info-item">
              <span class="info-label">Type:</span>
              <span class="info-value">Changeset</span>
            </div>
          </div>
          ${this.item.comment ? `<div class="comment-box">${escapeHtml(this.item.comment)}</div>` : ''}
        </div>
        
        <table class="files-table">
          <thead>
            <tr>
              <th>Change</th>
              <th>File Path</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${this.item.files.length > 0 ? filesRows : '<tr><td colspan="3" class="no-files">No files in this changeset</td></tr>'}
          </tbody>
        </table>
        
        <script>
          const vscode = acquireVsCodeApi();
          
          document.body.addEventListener("click", (e) => {
            const target = e.target;
            if (!(target instanceof HTMLButtonElement)) return;
            
            const action = target.getAttribute("data-action");
            const file = decodeURIComponent(target.getAttribute("data-file"));
            
            if (action && file) {
              vscode.postMessage({ type: action, file });
            }
          });
          
          // Add keyboard navigation
          document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
              vscode.postMessage({ type: 'close' });
            }
          });
        </script>
      </body>
      </html>
    `;
  }
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, ch => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", "\"":"&quot;", "'":"&#39;" }[ch]!));
}
