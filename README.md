# VSTFS

Team Foundation Version Control (TFVC) extension for VS Code with a Visual Studio-like flow:

- Get Latest
- Check In (with comment)
- Create Branch
- Merge
- Show History
- Open Changeset (inspect files, open/diff)
- Rollback to Changeset

## Requirements

- TFVC CLI (`TF.exe`) installed.
- Default path (Windows, VS 2022 Community):
  `C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\TF.exe`

Configure via:
- `.vstfs.json` at the workspace root **or**
- VS Code settings (`vstfs.*`).

## Quick Start

1. Set your `.vstfs.json` or `vstfs.*` settings.
2. Run **VSTFS: Get Latest**.
3. Use **Pending Changes** view to **Check In**.
4. Explore **Branches** and **History** views.

## Features

### Views
- **Pending Changes**: Shows files with pending modifications
- **Branches**: Lists available branches
- **History**: Shows changeset history

### Commands
- **Get Latest**: Downloads latest version of files
- **Check In**: Commits pending changes with comment
- **Create Branch**: Creates new branch from existing one
- **Merge**: Merges changes between branches
- **Show History**: Displays file/folder history
- **Open Changeset**: Inspects specific changeset details
- **Rollback**: Reverts to specific changeset

## Configuration

### Workspace Configuration (.vstfs.json)
```json
{
  "serverUrl": "http://tfs.company.local:8080/tfs/DefaultCollection",
  "project": "MyProject",
  "workspace": "MyWorkspace",
  "tfPath": "C:\\Program Files\\Microsoft Visual Studio\\2022\\Community\\Common7\\IDE\\CommonExtensions\\Microsoft\\TeamFoundation\\Team Explorer\\TF.exe",
  "root": ".",
  "auth": {
    "type": "integrated"
  }
}
```

### VS Code Settings
- `vstfs.tfPath`: Path to TF.exe
- `vstfs.serverUrl`: TFS server URL
- `vstfs.project`: Project name
- `vstfs.workspace`: Workspace name
- `vstfs.authType`: Authentication type (`integrated` or `pat`)

## Development

```bash
npm install
npm run compile
npm run package
```

## License

MIT
