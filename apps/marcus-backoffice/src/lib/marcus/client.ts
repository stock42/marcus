"use client";

import type { ApiEnvelope } from "./types";

export class MarcusBffError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "MarcusBffError";
  }
}

export async function requestBff<T>(path: string, init: RequestInit = {}): Promise<T> {
  const csrf = sessionStorage.getItem("marcus.csrf") ?? "";
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(csrf === "" ? {} : { "X-Marcus-CSRF": csrf }),
      ...init.headers,
    },
  });
  const envelope = await response.json() as ApiEnvelope<T>;
  if (!response.ok || !envelope.ok) {
    const error = envelope.ok
      ? { code: `HTTP_${response.status}`, message: response.statusText }
      : envelope.error;
    throw new MarcusBffError(error.code, error.message);
  }
  return envelope.data;
}
