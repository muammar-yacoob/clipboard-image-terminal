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

// Walk the capture step-by-step so each stage shows in the progress notification.
async function pasteWithProgress(
  progress: vscode.Progress<{ message?: string }>,
  dir: string | undefined,
): Promise<PasteResult | null> {
  progress.report({ message: '$(clippy) Reading clipboard…' });
  await tick();
  const raw = readClipboardImage();
  if (!raw) return null;

  let finalBuf = raw;
  if (needsCompression(raw)) {
    progress.report({ message: '$(sync~spin) Compressing…' });
    await tick();
    finalBuf = compressImage(raw);
  }

  progress.report({ message: '$(save) Saving…' });
  await tick();
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
      const terminal = vscode.window.activeTerminal;
      if (!terminal) {
        vscode.window.showWarningMessage('No active terminal');
        return;
      }

      const dir = vscode.workspace
        .getConfiguration('clipboardImage')
        .get<string>('outputDir')
        ?.trim();

      try {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: 'Clipboard image' },
          (progress) => pasteWithProgress(progress, dir || undefined),
        );

        if (!result) {
          vscode.window.showInformationMessage('No image on clipboard');
          return;
        }

        terminal.sendText(result.filePath, false);
        showPasted(bumpPasteCounter(dir || undefined), result.summary);
      } catch (err: unknown) {
        vscode.window.showErrorMessage(`Clipboard image failed: ${errorMessage(err)}`);
      }
    })
  );
}

export function deactivate() {}
