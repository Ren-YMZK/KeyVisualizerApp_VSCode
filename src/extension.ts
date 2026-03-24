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
    };

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

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("lectureKeyVisualizer");
  const endpoint = config.get<string>("endpoint") ?? DEFAULT_ENDPOINT;

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

  const terminalCommandDisposable = vscode.commands.registerCommand(
    "keyvisualizerapp-vscode.openVisualizerTerminal",
    () => openVisualizerTerminal(context),
  );

  context.subscriptions.push(
    saveDisposable,
    activeEditorDisposable,
    terminalCommandDisposable,
  );
}

export function deactivate() {}
