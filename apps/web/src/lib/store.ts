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
