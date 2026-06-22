import * as vscode from 'vscode';
import { captureClipboardImage } from './lib/clipboard';
import { errorMessage } from './lib/errors';

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
        vscode.window.showErrorMessage(`Clipboard image failed: ${errorMessage(err)}`);
      }
    })
  );
}

export function deactivate() {}
