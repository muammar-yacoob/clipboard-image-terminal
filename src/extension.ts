import * as vscode from 'vscode';
import { captureClipboardImage } from './lib/clipboard';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('clipboard-image.paste', () => {
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        vscode.window.showWarningMessage('No active terminal');
        return;
      }

      try {
        const dir = vscode.workspace
          .getConfiguration('clipboardImage')
          .get<string>('outputDir')
          ?.trim();

        const filePath = captureClipboardImage(dir || undefined);
        if (!filePath) {
          vscode.window.showInformationMessage('No image on clipboard');
          return;
        }

        terminal.sendText(filePath, false);
        vscode.window.setStatusBarMessage('$(file-media) Image path pasted', 2000);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`Clipboard image failed: ${msg}`);
      }
    })
  );
}

export function deactivate() {}
