import Docker from "dockerode";
import { randomBytes } from "node:crypto";
import { config } from "./config.js";

const docker = new Docker({ socketPath: "/var/run/docker.sock" });

interface Session {
  containerId: string;
  containerName: string;
  callbackSecret: string;
  userId: string;
  timeoutHandle: ReturnType<typeof setTimeout>;
}

const sessions = new Map<string, Session>();

export function containerNameFor(sessionId: string): string {
  return `login-${sessionId}`;
}

export async function startLoginSession(sessionId: string, userId: string): Promise<void> {
  await cleanupIfExists(sessionId);

  const callbackSecret = randomBytes(24).toString("hex");
  const containerName = containerNameFor(sessionId);

  const container = await docker.createContainer({
    Image: config.loginSessionImage,
    name: containerName,
    Env: [
      `LOGIN_SESSION_ID=${sessionId}`,
      `CALLBACK_URL=${config.controlPlaneInternalUrl}/internal/login-complete`,
      `CALLBACK_SECRET=${callbackSecret}`,
    ],
    HostConfig: {
      NetworkMode: config.dockerNetwork,
      AutoRemove: false,
      ShmSize: 512 * 1024 * 1024,
    },
  });
  await container.start();

  const timeoutHandle = setTimeout(() => {
    void cleanupIfExists(sessionId);
  }, config.loginSessionTimeoutMs);

  sessions.set(sessionId, { containerId: container.id, containerName, callbackSecret, userId, timeoutHandle });
}

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function novncTargetFor(sessionId: string): string | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  return `http://${s.containerName}:6080`;
}

export async function cleanupIfExists(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId);
  if (s) {
    clearTimeout(s.timeoutHandle);
    sessions.delete(sessionId);
  }
  try {
    const container = docker.getContainer(containerNameFor(sessionId));
    await container.stop({ t: 2 }).catch(() => {});
    await container.remove({ force: true }).catch(() => {});
  } catch {
    // container never existed — fine
  }
}
