export const AGENT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'none'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

export interface WindowOpenHandlerResult { action: "deny" }

export interface WebContentsLike {
  on(event: "will-navigate", listener: (event: { preventDefault(): void }) => void): void;
  setWindowOpenHandler(handler: () => WindowOpenHandlerResult): void;
  session: {
    webRequest: {
      onHeadersReceived(listener: (
        details: { responseHeaders?: Record<string, string[]> },
        callback: (response: { responseHeaders: Record<string, string[]> }) => void,
      ) => void): void;
    };
  };
}

export interface TrustedWebContentsLike extends WebContentsLike {
  readonly mainFrame: object;
}

export interface BrowserWindowLike {
  webContents: TrustedWebContentsLike;
  on(event: "close", listener: (event: { preventDefault(): void }) => void): void;
  hide(): void;
  show(): void;
  isDestroyed(): boolean;
  loadURL(url: string): Promise<void>;
  loadFile(path: string): Promise<void>;
}

export interface BrowserWindowConstructor {
  new (options: ReturnType<typeof secureWindowOptions>): BrowserWindowLike;
}

export function secureWindowOptions(preloadPath: string) {
  return {
    width: 1040,
    height: 720,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#071013",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  } as const;
}

export function hardenWebContents(webContents: WebContentsLike): void {
  webContents.on("will-navigate", (event) => event.preventDefault());
  webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...(details.responseHeaders ?? {}),
        "Content-Security-Policy": [AGENT_CSP],
      },
    });
  });
}

export interface CreateWindowOptions {
  BrowserWindow: BrowserWindowConstructor;
  preloadPath: string;
  rendererUrl?: string;
  rendererFile?: string;
  onCreated?: (window: BrowserWindowLike) => void;
}

export async function createMainWindow(options: CreateWindowOptions): Promise<BrowserWindowLike> {
  const window = new options.BrowserWindow(secureWindowOptions(options.preloadPath));
  hardenWebContents(window.webContents);
  options.onCreated?.(window);
  if (options.rendererUrl) await window.loadURL(options.rendererUrl);
  else if (options.rendererFile) await window.loadFile(options.rendererFile);
  else throw new Error("A trusted renderer URL or file is required");
  return window;
}

export interface TrayLike {
  on(event: "click", listener: () => void): void;
  setContextMenu(menu: unknown): void;
  destroy(): void;
}

export interface AppLifecycleLike { quit(): void }

export class TrayWindowLifecycle {
  private quitting = false;

  constructor(
    private readonly app: AppLifecycleLike,
    private readonly window: BrowserWindowLike,
    private readonly tray: TrayLike,
  ) {}

  install(menu: unknown): void {
    this.window.on("close", (event) => {
      if (this.quitting) return;
      event.preventDefault();
      this.window.hide();
    });
    this.tray.on("click", () => {
      if (!this.window.isDestroyed()) this.window.show();
    });
    this.tray.setContextMenu(menu);
  }

  quitExplicitly(): void {
    this.quitting = true;
    this.tray.destroy();
    this.app.quit();
  }

  prepareToQuit(): void {
    if (this.quitting) return;
    this.quitting = true;
    this.tray.destroy();
  }
}
