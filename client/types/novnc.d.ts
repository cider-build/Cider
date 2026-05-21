declare module "@novnc/novnc" {
  interface RFBOptions {
    credentials?: { password?: string; username?: string };
    wsProtocols?: string[];
    shared?: boolean;
    repeaterID?: string;
  }

  export default class RFB {
    constructor(target: HTMLElement, url: string, options?: RFBOptions);
    viewOnly: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    background: string;
    addEventListener(type: string, listener: (event: Event) => void): void;
    removeEventListener(type: string, listener: (event: Event) => void): void;
    disconnect(): void;
    sendCredentials(credentials: { password?: string; username?: string }): void;
  }
}
