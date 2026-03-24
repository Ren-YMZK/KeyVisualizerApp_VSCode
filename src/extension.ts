import * as vscode from "vscode";

const DEFAULT_ENDPOINT = "http://127.0.0.1:43137/events";

type VisualizerEvent = {
  type: "file.saved";
  id: string;
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

export function activate(context: vscode.ExtensionContext) {
  const config = vscode.workspace.getConfiguration("lectureKeyVisualizer");
  const endpoint = config.get<string>("endpoint") ?? DEFAULT_ENDPOINT;

  const saveDisposable = vscode.workspace.onDidSaveTextDocument(
    async (document) => {
      try {
        const fileName =
          vscode.workspace.asRelativePath(document.uri, false) ||
          document.fileName;

        await postEvent(
          {
            type: "file.saved",
            id: crypto.randomUUID(),
            fileName,
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

  context.subscriptions.push(saveDisposable);
}

export function deactivate() {}
