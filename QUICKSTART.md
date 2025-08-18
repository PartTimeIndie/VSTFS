# VSTFS Quick Start Guide

## 🚀 Get Started in 5 Minutes

### 1. **Install the Extension**
- Build the extension: `build.bat`
- Install the generated `.vsix` file in VS Code
- Or use `F5` to run in development mode

### 2. **Configure Your TFS Connection**
Copy `.vstfs.example.json` to `.vstfs.json` and update:
```json
{
  "serverUrl": "http://your-tfs-server:8080/tfs/DefaultCollection",
  "project": "YourProjectName",
  "workspace": "YourWorkspaceName",
  "tfPath": "C:\\Path\\To\\Your\\TF.exe"
}
```

### 3. **Access VSTFS**
- Click the **VSTFS** icon in the VS Code activity bar (left sidebar)
- You'll see three views: **Pending Changes**, **Branches**, and **History**

### 4. **Basic Workflow**
1. **Get Latest**: Click the cloud download button in Pending Changes view
2. **Make Changes**: Edit files in VS Code
3. **Check In**: Click the cloud upload button, enter comment, submit
4. **View History**: Browse changesets in the History view
5. **Inspect Changes**: Click any changeset to see detailed file changes

### 5. **Key Features**
- **Pending Changes**: See all modified files with action buttons
- **Branches**: List and create branches
- **History**: Browse changeset history with detailed inspection
- **Changeset View**: Beautiful webview showing file changes with Open/Diff/Revert buttons

### 6. **Commands Available**
- `Ctrl+Shift+P` → Type "TFVC:" to see all available commands
- **Get Latest**, **Check In**, **Create Branch**, **Merge**, **Show History**

### 7. **Troubleshooting**
- **TF.exe not found**: Update `tfPath` in `.vstfs.json`
- **Authentication issues**: Use integrated Windows auth or configure PAT
- **Views not loading**: Check your TFS connection and refresh views

## 🎯 **Pro Tips**
- Use the **Refresh** button to update views after TFVC operations
- Right-click items in views for context menus
- The changeset panel supports keyboard navigation (Esc to close)
- Status bar shows current workspace and server info

## 🔧 **Development**
- Run `dev.bat` for watch mode during development
- Use `F5` to debug the extension
- Check the Output panel → VSTFS for detailed logs
