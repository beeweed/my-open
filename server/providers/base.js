export const OPENCODE_PORT = 4096;
export const CODE_SERVER_PORT = 8080;
export const WORKSPACE = '/home/user/workspace';
export const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

export function sandboxInfo({ sandboxId, opencodeUrl, codeServerUrl, ...extra }) {
  return { sandboxId, opencodeUrl, codeServerUrl, ...extra };
}
