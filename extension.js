const vscode = require('vscode');

const NOTE_FILE_EXTENSION = '.md';
const NOTES_DIRECTORY_NAME = 'notes';

class NotesTreeItem extends vscode.TreeItem {
  /**
   * @param {string} label
   * @param {vscode.Uri} resourceUri
   * @param {vscode.FileType} fileType
   */
  constructor(label, resourceUri, fileType) {
    const isDirectory = fileType === vscode.FileType.Directory;
    super(
      label,
      isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.resourceUri = resourceUri;
    this.fileType = fileType;
    this.contextValue = isDirectory ? 'folder' : 'note';

    if (isDirectory === true) {
      this.iconPath = new vscode.ThemeIcon('folder');
    } else {
      this.iconPath = new vscode.ThemeIcon('note');
      this.command = {
        command: 'localNotes.openNote',
        title: 'Open Note',
        arguments: [this],
      };
    }
  }
}

class LocalNotesProvider {
  /**
   * @param {vscode.ExtensionContext} context
   */
  constructor(context) {
    this.context = context;
    this.notesRootUri = vscode.Uri.joinPath(context.globalStorageUri, NOTES_DIRECTORY_NAME);
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  async initialize() {
    await vscode.workspace.fs.createDirectory(this.notesRootUri);
  }

  refresh() {
    this._onDidChangeTreeData.fire(undefined);
  }

  /**
   * @param {NotesTreeItem | undefined} element
   * @returns {vscode.ProviderResult<NotesTreeItem[]>}
   */
  async getChildren(element) {
    const parentUri = element ? element.resourceUri : this.notesRootUri;
    const entries = await vscode.workspace.fs.readDirectory(parentUri);

    return entries
      .filter(([name, fileType]) => {
        if (name.startsWith('.')) {
          return false;
        }

        if (fileType === vscode.FileType.Directory) {
          return true;
        }

        if (fileType === vscode.FileType.File) {
          return true;
        }

        return false;
      })
      .sort((left, right) => {
        const [leftName, leftType] = left;
        const [rightName, rightType] = right;

        if (leftType === vscode.FileType.Directory && rightType !== vscode.FileType.Directory) {
          return -1;
        }

        if (leftType !== vscode.FileType.Directory && rightType === vscode.FileType.Directory) {
          return 1;
        }

        return leftName.localeCompare(rightName, undefined, { numeric: true, sensitivity: 'base' });
      })
      .map(([name, fileType]) => {
        return new NotesTreeItem(name, vscode.Uri.joinPath(parentUri, name), fileType);
      });
  }

  /**
   * @param {NotesTreeItem} element
   * @returns {vscode.TreeItem}
   */
  getTreeItem(element) {
    return element;
  }

  /**
   * @param {NotesTreeItem | undefined} item
   * @returns {vscode.Uri}
   */
  getDirectoryForNewItem(item) {
    if (item === undefined) {
      return this.notesRootUri;
    }

    if (item.fileType === vscode.FileType.Directory) {
      return item.resourceUri;
    }

    return vscode.Uri.joinPath(item.resourceUri, '..');
  }

  /**
   * @param {NotesTreeItem | undefined} item
   * @returns {vscode.Uri}
   */
  getTargetDirectory(item) {
    if (item === undefined) {
      return this.notesRootUri;
    }

    if (item.fileType === vscode.FileType.Directory) {
      return item.resourceUri;
    }

    const pathSegments = item.resourceUri.path.split('/');
    pathSegments.pop();
    const parentPath = pathSegments.join('/') || '/';
    return item.resourceUri.with({ path: parentPath });
  }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
  const provider = new LocalNotesProvider(context);
  await provider.initialize();

  const treeView = vscode.window.createTreeView('localNotes.views.notes', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.refresh', () => {
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.openNote', async (item) => {
      if (item === undefined || item.fileType !== vscode.FileType.File) {
        return;
      }

      const document = await vscode.workspace.openTextDocument(item.resourceUri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.newFolder', async (item) => {
      const targetDirectory = provider.getTargetDirectory(item);
      const folderName = await vscode.window.showInputBox({
        title: 'New Folder',
        prompt: 'Folder name',
        ignoreFocusOut: true,
        validateInput(value) {
          return validatePathSegment(value, false);
        },
      });

      if (folderName === undefined) {
        return;
      }

      const folderUri = vscode.Uri.joinPath(targetDirectory, folderName.trim());
      const existsAlready = await uriExists(folderUri);

      if (existsAlready === true) {
        await vscode.window.showErrorMessage('Folder already exists.');
        return;
      }

      await vscode.workspace.fs.createDirectory(folderUri);
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.newNote', async (item) => {
      const targetDirectory = provider.getTargetDirectory(item);
      const rawName = await vscode.window.showInputBox({
        title: 'New Note',
        prompt: 'Note name',
        ignoreFocusOut: true,
        value: 'New Note',
        validateInput(value) {
          return validatePathSegment(value, true);
        },
      });

      if (rawName === undefined) {
        return;
      }

      const fileName = normalizeNoteFileName(rawName);
      const noteUri = vscode.Uri.joinPath(targetDirectory, fileName);
      const existsAlready = await uriExists(noteUri);

      if (existsAlready === true) {
        await vscode.window.showErrorMessage('Note already exists.');
        return;
      }

      const initialContent = Buffer.from(`# ${stripExtension(fileName)}\n\n`, 'utf8');
      await vscode.workspace.fs.writeFile(noteUri, initialContent);
      provider.refresh();

      const document = await vscode.workspace.openTextDocument(noteUri);
      await vscode.window.showTextDocument(document, { preview: false });
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.renameItem', async (item) => {
      if (item === undefined) {
        return;
      }

      const oldName = basename(item.resourceUri.path);
      const isNote = item.fileType === vscode.FileType.File;
      const suggestedValue = isNote ? stripExtension(oldName) : oldName;
      const title = isNote ? 'Rename Note' : 'Rename Folder';
      const prompt = isNote ? 'New note name' : 'New folder name';

      const rawNewName = await vscode.window.showInputBox({
        title,
        prompt,
        ignoreFocusOut: true,
        value: suggestedValue,
        validateInput(value) {
          return validatePathSegment(value, isNote);
        },
      });

      if (rawNewName === undefined) {
        return;
      }

      const newName = isNote ? normalizeNoteFileName(rawNewName) : rawNewName.trim();
      const targetUri = item.resourceUri.with({ path: replaceBasename(item.resourceUri.path, newName) });
      const existsAlready = await uriExists(targetUri);

      if (existsAlready === true) {
        await vscode.window.showErrorMessage('An item with that name already exists.');
        return;
      }

      await vscode.workspace.fs.rename(item.resourceUri, targetUri, { overwrite: false });
      provider.refresh();
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('localNotes.deleteItem', async (item) => {
      if (item === undefined) {
        return;
      }

      const isDirectory = item.fileType === vscode.FileType.Directory;
      const label = basename(item.resourceUri.path);
      const confirmation = await vscode.window.showWarningMessage(
        `Delete ${isDirectory === true ? 'folder' : 'note'} "${label}"?`,
        { modal: true },
        'Delete',
      );

      if (confirmation !== 'Delete') {
        return;
      }

      await vscode.workspace.fs.delete(item.resourceUri, { recursive: isDirectory, useTrash: true });
      provider.refresh();
    }),
  );
}

function deactivate() {
  return undefined;
}

/**
 * @param {string} value
 * @param {boolean} forceMarkdownExtension
 * @returns {string | undefined}
 */
function validatePathSegment(value, forceMarkdownExtension) {
  const trimmedValue = value.trim();

  if (trimmedValue.length === 0) {
    return 'A name is required.';
  }

  if (trimmedValue === '.' || trimmedValue === '..') {
    return 'This name is not allowed.';
  }

  if (/[\\/:*?"<>|]/.test(trimmedValue) === true) {
    return 'The name contains invalid characters.';
  }

  if (forceMarkdownExtension === true && trimmedValue.toLowerCase().endsWith(NOTE_FILE_EXTENSION) === true) {
    const baseName = stripExtension(trimmedValue);

    if (baseName.trim().length === 0) {
      return 'The note name is invalid.';
    }
  }

  return undefined;
}

/**
 * @param {string} rawName
 * @returns {string}
 */
function normalizeNoteFileName(rawName) {
  const trimmedName = rawName.trim();

  if (trimmedName.toLowerCase().endsWith(NOTE_FILE_EXTENSION) === true) {
    return trimmedName;
  }

  return `${trimmedName}${NOTE_FILE_EXTENSION}`;
}

/**
 * @param {string} fileName
 * @returns {string}
 */
function stripExtension(fileName) {
  if (fileName.toLowerCase().endsWith(NOTE_FILE_EXTENSION) === true) {
    return fileName.slice(0, -NOTE_FILE_EXTENSION.length);
  }

  return fileName;
}

/**
 * @param {vscode.Uri} uri
 * @returns {Promise<boolean>}
 */
async function uriExists(uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string} fullPath
 * @returns {string}
 */
function basename(fullPath) {
  const parts = fullPath.split('/').filter((part) => part.length > 0);

  if (parts.length === 0) {
    return fullPath;
  }

  return parts[parts.length - 1];
}

/**
 * @param {string} fullPath
 * @param {string} newBasename
 * @returns {string}
 */
function replaceBasename(fullPath, newBasename) {
  const parts = fullPath.split('/');
  parts[parts.length - 1] = newBasename;
  return parts.join('/');
}

module.exports = {
  activate,
  deactivate,
};
