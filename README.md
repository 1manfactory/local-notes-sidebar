# Local Notes Sidebar

A VSCodium / VS Code extension that provides a dedicated **Notes** icon in the Activity Bar and stores notes **locally on the UI machine**, not in the remote workspace.

## What it does

- adds a **Notes** container to the Activity Bar
- shows notes in a **folder tree**
- stores notes in the extension's **global storage directory**
- keeps working when connected through **Remote SSH / Dev Containers / WSL**, because the extension is declared as a **UI extension**
- creates Markdown notes (`.md`)
- supports creating folders, renaming, deleting, refreshing, and opening notes

## Storage location

The extension stores its files in the extension's `globalStorageUri`, inside a `notes` directory.

That means the notes belong to the extension instance on the **local client side**.

## Commands

- `New Note`
- `New Folder`
- `Refresh Notes`
- `Open Note`
- `Rename`
- `Delete`

## Development

This project intentionally uses plain JavaScript to avoid a build step.

## Packaging

Typical packaging is done with `vsce package`, which creates a `.vsix` file.
