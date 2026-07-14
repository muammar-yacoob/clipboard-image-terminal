import * as vscode from 'vscode';
import {
  readClipboardImage, needsCompression, compressImage, saveImage,
  summarizePaste, bumpPasteCounter, type PasteSummary,
} from './lib/clipboard';
import { errorMessage } from './lib/errors';

// Yield to the event loop so a progress.report() actually paints before the
// next (synchronous, blocking) step runs.
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type PasteResult = { filePath: string; summary: PasteSummary | null };

// Turn an already-read clipboard image into a saved file. Only the (potentially
// slow) compression step shows a progress notification — the read already
// happened, and we don't want a notification flashing on every plain-text paste.
async function saveClipboardImage(raw: Buffer, dir: string | undefined): Promise<PasteResult> {
  let finalBuf = raw;
  if (needsCompression(raw)) {
    finalBuf = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Clipboard image' },
      async (progress) => {
        progress.report({ message: '$(sync~spin) Compressing…' });
        await tick();
        return compressImage(raw);
      },
    );
  }

  const filePath = saveImage(finalBuf, dir);
  return { filePath, summary: summarizePaste(raw, finalBuf) };
}

// A colorful, self-dismissing `[img #n]` confirmation in the status bar.
function showPasted(n: number, summary: PasteSummary | null): void {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1);
  const bits = [`$(file-media) [img #${n}]`];
  if (summary) {
    bits.push(`~${summary.tokens} tok`);
    if (summary.savedTokens > 0) bits.push(`↓ saved ~${summary.savedTokens}`);
  }
  item.text = bits.join('  ');
  item.color = new vscode.ThemeColor('charts.green');
  item.tooltip = summary
    ? `${summary.width}×${summary.height} · ~${summary.tokens} vision tokens`
    : 'Image path pasted';
  item.show();
  setTimeout(() => item.dispose(), 5000);
}

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('clipboard-image.paste', async () => {
      // This is bound to Ctrl+V in the terminal, so it must act like a normal
      // paste whenever the clipboard isn't an image — otherwise it would swallow
      // every text paste. Fall through to the built-in terminal paste in that case.
      const normalPaste = () => vscode.commands.executeCommand('workbench.action.terminal.paste');

      const terminal = vscode.window.activeTerminal;

      // Read first (fast, no UI). A failure here means the capture backend is
      // broken — surface it, but still paste so the keystroke isn't lost.
      let raw: Buffer | null;
      try {
        raw = readClipboardImage();
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Clipboard image failed: ${errorMessage(err)}`);
        await normalPaste();
        return;
      }

      if (!raw || !terminal) {
        await normalPaste();
        return;
      }

      const dir = vscode.workspace
        .getConfiguration('clipboardImage')
        .get<string>('outputDir')
        ?.trim();

      try {
        const result = await saveClipboardImage(raw, dir || undefined);
        terminal.sendText(result.filePath, false);
        showPasted(bumpPasteCounter(dir || undefined), result.summary);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Clipboard image failed: ${errorMessage(err)}`);
      }
    })
  );
}

export function deactivate() {}
