import * as path from "node:path";
import * as vscode from "vscode";

const DEFAULT_ENDPOINT = "http://127.0.0.1:43137/events";

type VisualizerEvent =
  | {
      type: "file.saved";
      id: string;
      fileName: string;
    }
  | {
      type: "editor.action";
      id: string;
      action: "openFile";
      fileName: string;
    }
  | {
      type: "completion.accepted";
      id: string;
      before: string;
      after: string;
    }
  | {
      type: "snippet.expanded";
      id: string;
      before: string;
      after: string;
    };

const documentSnapshotMap = new Map<string, string>();

async function postEvent(event: VisualizerEvent, endpoint: string) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(event),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`failed to post event: ${response.status} ${text}`);
  }
}

function getDisplayFileName(uri: vscode.Uri): string {
  return vscode.workspace.asRelativePath(uri, false) || uri.fsPath;
}

function openVisualizerTerminal(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("lectureKeyVisualizer");
  const endpoint = config.get<string>("endpoint") ?? DEFAULT_ENDPOINT;

  const scriptPath = context.asAbsolutePath(
    path.join("scripts", "KeyVisualizer.PowerShell.ps1"),
  );

  const terminal = vscode.window.createTerminal({
    name: "Key Visualizer Terminal",
    shellPath: "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    shellArgs: [
      "-NoExit",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      `$env:KEY_VISUALIZER_ENDPOINT='${endpoint}'; . '${scriptPath}'`,
    ],
  });

  terminal.show();
}

function getLineTextFromContent(text: string, line: number): string {
  const lines = text.split(/\r?\n/);

  if (line < 0 || line >= lines.length) {
    return "";
  }

  return lines[line] ?? "";
}

function isSnippetLikeChange(
  change: vscode.TextDocumentContentChangeEvent,
): boolean {
  if (change.text.length === 0) {
    return false;
  }

  if (change.text.includes("\n") || change.text.includes("\r")) {
    return true;
  }

  if (change.range.start.line !== change.range.end.line) {
    return true;
  }

  if (change.text.length >= 20) {
    return true;
  }

  return false;
}

function shouldTreatAsCompletion(
  change: vscode.TextDocumentContentChangeEvent,
): boolean {
  if (change.text.length === 0) {
    return false;
  }

  if (isSnippetLikeChange(change)) {
    return false;
  }

  if (change.range.start.line !== change.range.end.line) {
    return false;
  }

  if (change.text.length <= 1 && change.rangeLength === 0) {
    return false;
  }

  return true;
}

function detectCompletionEvent(
  document: vscode.TextDocument,
  oldContent: string,
  change: vscode.TextDocumentContentChangeEvent,
): { before: string; after: string } | null {
  if (!shouldTreatAsCompletion(change)) {
    return null;
  }

  const line = change.range.start.line;
  const oldLine = getLineTextFromContent(oldContent, line);
  const newLine = document.lineAt(line).text;

  if (!oldLine || !newLine) {
    return null;
  }

  if (oldLine === newLine) {
    return null;
  }

  const delta = Math.abs(newLine.length - oldLine.length);
  if (delta <= 1 && change.rangeLength === 0) {
    return null;
  }

  return {
    before: oldLine,
    after: newLine,
  };
}

function detectSnippetEvent(
  document: vscode.TextDocument,
  oldContent: string,
  change: vscode.TextDocumentContentChangeEvent,
): { before: string; after: string } | null {
  if (!isSnippetLikeChange(change)) {
    return null;
  }

  const startLine = change.range.start.line;
  const endLine = Math.max(change.range.end.line, startLine);

  const oldLines = oldContent.split(/\r?\n/);
  const before = oldLines.slice(startLine, endLine + 1).join("\n");

  const snippetLineCount = Math.max(change.text.split(/\r?\n/).length, 1);
  const afterLines: string[] = [];

  for (let i = 0; i < snippetLineCount; i += 1) {
    const lineIndex = startLine + i;
    if (lineIndex < document.lineCount) {
      afterLines.push(document.lineAt(lineIndex).text);
    }
  }

  const after = afterLines.join("\n");

  if (!before && !after) {
    return null;
  }

  if (before === after) {
    return null;
  }

  return { before, after };
}

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("lectureKeyVisualizer");
  const endpoint = config.get<string>("endpoint") ?? DEFAULT_ENDPOINT;

  for (const document of vscode.workspace.textDocuments) {
    documentSnapshotMap.set(document.uri.toString(), document.getText());
  }

  const openDisposable = vscode.workspace.onDidOpenTextDocument((document) => {
    documentSnapshotMap.set(document.uri.toString(), document.getText());
  });

  const closeDisposable = vscode.workspace.onDidCloseTextDocument(
    (document) => {
      documentSnapshotMap.delete(document.uri.toString());
    },
  );

  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      try {
        await postEvent(
          {
            type: "file.saved",
            id: crypto.randomUUID(),
            fileName: getDisplayFileName(document.uri),
          },
          endpoint,
        );
      } catch (error) {
        console.error(
          "lecture-key-visualizer: failed to send save event",
          error,
        );
      }
    },
  );

  const activeEditorDisposable = vscode.window.onDidChangeActiveTextEditor(
    async (editor) => {
      if (!editor) return;

      try {
        await postEvent(
          {
            type: "editor.action",
            id: crypto.randomUUID(),
            action: "openFile",
            fileName: getDisplayFileName(editor.document.uri),
          },
          endpoint,
        );
      } catch (error) {
        console.error(
          "lecture-key-visualizer: failed to send open file event",
          error,
        );
      }
    },
  );

  const changeDisposable = vscode.workspace.onDidChangeTextDocument(
    async (event) => {
      const uriKey = event.document.uri.toString();
      const oldContent =
        documentSnapshotMap.get(uriKey) ?? event.document.getText();

      try {
        for (const change of event.contentChanges) {
          const snippet = detectSnippetEvent(
            event.document,
            oldContent,
            change,
          );
          if (snippet) {
            await postEvent(
              {
                type: "snippet.expanded",
                id: crypto.randomUUID(),
                before: snippet.before,
                after: snippet.after,
              },
              endpoint,
            );
            continue;
          }

          const completion = detectCompletionEvent(
            event.document,
            oldContent,
            change,
          );
          if (completion) {
            await postEvent(
              {
                type: "completion.accepted",
                id: crypto.randomUUID(),
                before: completion.before,
                after: completion.after,
              },
              endpoint,
            );
          }
        }
      } catch (error) {
        console.error(
          "lecture-key-visualizer: failed to send editor change event",
          error,
        );
      } finally {
        documentSnapshotMap.set(uriKey, event.document.getText());
      }
    },
  );

  const terminalCommandDisposable = vscode.commands.registerCommand(
    "keyvisualizerapp-vscode.openVisualizerTerminal",
    () => openVisualizerTerminal(context),
  );

  context.subscriptions.push(
    openDisposable,
    closeDisposable,
    saveDisposable,
    activeEditorDisposable,
    changeDisposable,
    terminalCommandDisposable,
  );
}

export function deactivate() {}
