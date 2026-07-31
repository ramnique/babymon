import { generateRoomCode } from '@babymon/shared';

const CAMERA_CODE_KEY = 'babymon.cameraCode';
const WATCH_CODE_KEY = 'babymon.watchCode';

/** The camera's room code persists across restarts (appliance behavior). */
export function loadOrCreateCameraCode(): string {
  const existing = localStorage.getItem(CAMERA_CODE_KEY);
  if (existing) return existing;
  const code = generateRoomCode();
  localStorage.setItem(CAMERA_CODE_KEY, code);
  return code;
}

export function saveCameraCode(code: string): void {
  localStorage.setItem(CAMERA_CODE_KEY, code);
}

const CAMERA_DEVICE_KEY = 'babymon.cameraDevice';
const MIC_DEVICE_KEY = 'babymon.micDevice';

export function loadCameraDevice(): string | null {
  return localStorage.getItem(CAMERA_DEVICE_KEY);
}

export function saveCameraDevice(deviceId: string): void {
  localStorage.setItem(CAMERA_DEVICE_KEY, deviceId);
}

export function loadMicDevice(): string | null {
  return localStorage.getItem(MIC_DEVICE_KEY);
}

export function saveMicDevice(deviceId: string): void {
  localStorage.setItem(MIC_DEVICE_KEY, deviceId);
}

export function loadWatchCode(): string | null {
  return localStorage.getItem(WATCH_CODE_KEY);
}

export function saveWatchCode(code: string): void {
  localStorage.setItem(WATCH_CODE_KEY, code);
}

export function clearWatchCode(): void {
  localStorage.removeItem(WATCH_CODE_KEY);
}

const NIGHT_BOOST_KEY = 'babymon.nightBoost';

export type NightBoost = 0 | 1 | 2;

export function loadNightBoost(): NightBoost {
  const raw = Number(localStorage.getItem(NIGHT_BOOST_KEY));
  return raw === 1 || raw === 2 ? raw : 0;
}

export function saveNightBoost(level: NightBoost): void {
  localStorage.setItem(NIGHT_BOOST_KEY, String(level));
}

const ROTATE_KEY = 'babymon.rotate';

/** Quarter-turns clockwise applied to the viewer's video. */
export type Rotation = 0 | 1 | 2 | 3;

export function loadRotation(): Rotation {
  const raw = Number(localStorage.getItem(ROTATE_KEY));
  return raw === 1 || raw === 2 || raw === 3 ? raw : 0;
}

export function saveRotation(rotation: Rotation): void {
  localStorage.setItem(ROTATE_KEY, String(rotation));
}

const VIEWER_ID_KEY = 'babymon.viewerId';

/** Stable per-browser id so a rejoin evicts this browser's ghost connection. */
export function loadOrCreateViewerId(): string {
  const existing = localStorage.getItem(VIEWER_ID_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  localStorage.setItem(VIEWER_ID_KEY, id);
  return id;
}
