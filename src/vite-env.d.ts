/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_OPENAI_BASE_URL?: string;
  readonly VITE_OPENAI_MODEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  readonly outlawCode?: {
    readonly platform: string;
    readonly aiProxyBaseURL?: string;
    readonly aiProxyToken?: string;
    readonly fs?: import('./lib/fs/bridge').OutlawCodeFsBridge;
    readonly git?: import('./lib/fs/bridge').OutlawCodeGitBridge;
    readonly terminal?: import('./lib/fs/bridge').OutlawCodeTerminalBridge;
    readonly onFsEvents?: (callback: (events: import('./lib/fs/types').FsEvent[]) => void) => () => void;
  };
}
