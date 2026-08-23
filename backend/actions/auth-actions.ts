"use server";

import { getAuth } from "@/backend/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export type BackendUser = {
  id: string;
  externalId: string;
  email: string;
  fullName?: string;
  role: string;
};

export async function addNewUser(params: {
  userId: string;
  email: string;
  fullName?: string;
  role?: string;
}): Promise<{ success: boolean; user?: BackendUser; error?: string }> {
  try {
    const res = await fetch(`${APP_URL}/api/users`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        externalId: params.userId,
        email: params.email,
        fullName: params.fullName,
        role: params.role ?? "user",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("addNewUser failed:", text);
      return { success: false, error: text };
    }

    const data = await res.json();
    return { success: true, user: data.data };
  } catch (err) {
    console.error("addNewUser error:", err);
    return { success: false, error: "Failed to create user" };
  }
}

export async function findUser(
  userId: string
): Promise<BackendUser | null> {
  try {
    const res = await fetch(`${APP_URL}/api/users/${encodeURIComponent(userId)}`, {
      cache: "no-store",
    });

    if (res.status === 404) return null;
    if (!res.ok) return null;

    const data = await res.json();
    return data.data ?? null;
  } catch (err) {
    console.error("findUser error:", err);
    return null;
  }
}