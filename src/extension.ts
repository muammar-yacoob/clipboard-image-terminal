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

        let pasted = '$(file-media) Image path pasted';
        const filePath = captureClipboardImage(dir || undefined, (event) => {
          if (event.type === 'compressing') {
            vscode.window.setStatusBarMessage('$(sync~spin) Compressing image…', 2000);
          } else {
            const saved = event.savedTokens > 0 ? ` (saved ~${event.savedTokens})` : '';
            pasted = `$(file-media) Pasted ~${event.tokens} tokens${saved}`;
          }
        });
        if (!filePath) {
          vscode.window.showInformationMessage('No image on clipboard');
          return;
        }

        terminal.sendText(filePath, false);
        vscode.window.setStatusBarMessage(pasted, 3000);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Clipboard image failed: ${errorMessage(err)}`);
      }
    })
  );
}

export function deactivate() {}
