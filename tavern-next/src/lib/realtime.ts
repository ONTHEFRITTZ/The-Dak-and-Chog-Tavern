const REMOTE_SOCKET_PATH = "/poker.io/";
const LOCAL_SOCKET_PATH = "/socket.io/";

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isPrivateNetwork(hostname: string) {
  if (LOCAL_HOSTNAMES.has(hostname)) return true;
  if (hostname.endsWith(".local")) return true;
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/u.test(hostname)) return true;
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/u.test(hostname)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}$/u.test(hostname)) return true;
  return false;
}

type EndpointOverride = {
  url?: string | null;
  path?: string | null;
  localPath?: string | null;
};

function getOverrides(): EndpointOverride {
  return {
    url: process.env.NEXT_PUBLIC_REALTIME_BASE_URL,
    path: process.env.NEXT_PUBLIC_REALTIME_SOCKET_PATH,
    localPath: process.env.NEXT_PUBLIC_REALTIME_SOCKET_PATH_LOCAL,
  };
}

export function resolveRealtimeEndpoint(explicitUrl?: string | null) {
  const { url: envUrl, path: envPath, localPath: envLocalPath } = getOverrides();

  let baseUrl = explicitUrl ?? envUrl ?? null;
  if (!baseUrl && typeof window !== "undefined") {
    baseUrl = window.location.origin;
  }

  let socketPath = envPath ?? REMOTE_SOCKET_PATH;

  if (baseUrl) {
    try {
      const parsed = new URL(baseUrl);
      const hostname = parsed.hostname.toLowerCase();
      const isLocal = isPrivateNetwork(hostname);

      if (isLocal) {
        socketPath = envLocalPath ?? envPath ?? LOCAL_SOCKET_PATH;

        const hasExplicitTarget = Boolean(explicitUrl ?? envUrl);
        if (!hasExplicitTarget) {
          if (!parsed.port || parsed.port === "3000") {
            parsed.port = "3100";
          }
        }
      }

      parsed.pathname = "/";
      parsed.search = "";
      parsed.hash = "";
      baseUrl = parsed.origin;
    } catch {
      baseUrl = null;
    }
  }

  return {
    baseUrl: baseUrl ?? undefined,
    socketPath,
  };
}

